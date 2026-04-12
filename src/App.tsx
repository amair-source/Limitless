import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './lib/AuthContext';
import { signInWithGoogle, logout, db } from './lib/firebase';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { MessageSquare, Plus, LogOut, Send, User as UserIcon, Bot, Settings, Trash2, Menu, X, ChevronRight, Github, Search, Download, Image as ImageIcon, Sliders, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { DEFAULT_MODELS, ChatModel } from './constants';
import { chatWithGemini, chatWithUncensored, imageToImageUncensored } from './lib/ai';
import { handleFirestoreError, OperationType } from './lib/firestore-errors';

export default function App() {
  const { user, loading, isAuthReady } = useAuth();
  const [chats, setChats] = useState<any[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Chat settings
  const [selectedModel, setSelectedModel] = useState<ChatModel>(DEFAULT_MODELS[0]);
  const [selectedVersion, setSelectedVersion] = useState<string>(DEFAULT_MODELS[0].versions?.[0] || 'latest');
  const [systemMessage, setSystemMessage] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);

  // Image to Image
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch chats
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'chats'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChats(chatList);
      if (chatList.length > 0 && !currentChatId) {
        setCurrentChatId(chatList[0].id);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });
    return () => unsubscribe();
  }, [user]);

  // Fetch messages
  useEffect(() => {
    if (!currentChatId) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, `chats/${currentChatId}/messages`),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `chats/${currentChatId}/messages`);
    });

    // Update local settings based on current chat
    const chat = chats.find(c => c.id === currentChatId);
    if (chat) {
      const model = DEFAULT_MODELS.find(m => m.id === chat.modelId) || DEFAULT_MODELS[0];
      setSelectedModel(model);
      setSelectedVersion(chat.version || model.versions?.[0] || 'latest');
      setSystemMessage(chat.systemMessage || '');
      setTemperature(chat.temperature || 0.7);
      setMaxTokens(chat.maxTokens || 2048);
    }

    return () => unsubscribe();
  }, [currentChatId, chats]);

  const createNewChat = async () => {
    if (!user) return;
    const newChat = {
      userId: user.uid,
      title: 'New Chat',
      modelId: selectedModel.id,
      version: selectedVersion,
      systemMessage: systemMessage,
      temperature: temperature,
      maxTokens: maxTokens,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      const docRef = await addDoc(collection(db, 'chats'), newChat);
      setCurrentChatId(docRef.id);
      setShowSettings(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chats');
    }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this chat?')) {
      try {
        await deleteDoc(doc(db, 'chats', id));
        if (currentChatId === id) {
          setCurrentChatId(chats.find(c => c.id !== id)?.id || null);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `chats/${id}`);
      }
    }
  };

  const filteredChats = chats.filter(chat => 
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const exportChat = (format: 'txt' | 'json') => {
    if (messages.length === 0) return;
    
    let content = '';
    const filename = `chat-export-${currentChatId}.${format}`;
    
    if (format === 'json') {
      content = JSON.stringify(messages, null, 2);
    } else {
      content = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user || !currentChatId || isSending) return;

    const userMessage = input.trim();
    const imageToProcess = selectedImage;
    setInput('');
    setSelectedImage(null);
    setIsSending(true);

    try {
      // 1. Add user message to Firestore
      await addDoc(collection(db, `chats/${currentChatId}/messages`), {
        chatId: currentChatId,
        role: 'user',
        content: userMessage,
        image: imageToProcess,
        createdAt: serverTimestamp(),
      });

      // Update chat title if it's the first message
      if (messages.length === 0) {
        await updateDoc(doc(db, 'chats', currentChatId), {
          title: userMessage.slice(0, 30) + (userMessage.length > 30 ? '...' : ''),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'chats', currentChatId), {
          updatedAt: serverTimestamp(),
        });
      }

      // 2. Get AI response
      const chatHistory = [...messages, { role: 'user', content: userMessage, image: imageToProcess }];
      let aiResponse = '';
      
      const config = { temperature, maxOutputTokens: maxTokens };

      if (imageToProcess && selectedModel.isUncensored) {
        aiResponse = await imageToImageUncensored(imageToProcess, userMessage);
      } else if (selectedModel.isUncensored) {
        aiResponse = await chatWithUncensored(selectedModel.id, chatHistory, systemMessage, config);
      } else {
        aiResponse = await chatWithGemini(selectedModel.id, chatHistory, systemMessage, config);
      }

      // 3. Add AI message to Firestore
      await addDoc(collection(db, `chats/${currentChatId}/messages`), {
        chatId: currentChatId,
        role: 'assistant',
        content: aiResponse,
        createdAt: serverTimestamp(),
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `chats/${currentChatId}`);
    } finally {
      setIsSending(false);
    }
  };
export default function App() {
  return <h1>App is working 🚀</h1>;
}
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-100">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-zinc-500 border-t-zinc-100 rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-100 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-5xl font-bold tracking-tighter bg-gradient-to-r from-zinc-100 to-zinc-500 bg-clip-text text-transparent">
              limitlessAssistant
            </h1>
            <p className="text-zinc-400 text-lg">Uncensored AI at your fingertips.</p>
          </div>
          
          <div className="p-8 bg-zinc-900/50 border border-zinc-800 rounded-3xl backdrop-blur-xl">
            <button 
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-zinc-100 text-zinc-950 py-4 px-6 rounded-2xl font-semibold hover:bg-zinc-200 transition-all active:scale-95"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
              Sign in with Google
            </button>
            <p className="mt-4 text-xs text-zinc-500">
              By signing in, you agree to our terms of service and privacy policy.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 300 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-zinc-900 border-r border-zinc-800 flex flex-col relative z-20"
      >
        <div className="p-4 flex items-center justify-between border-b border-zinc-800">
          <h2 className="font-bold text-lg truncate">limitlessAssistant</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-zinc-800 rounded-lg lg:hidden">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-zinc-700 transition-all"
            />
          </div>
          <button 
            onClick={createNewChat}
            className="w-full flex items-center gap-2 bg-zinc-100 text-zinc-950 py-3 px-4 rounded-xl font-medium hover:bg-zinc-200 transition-all active:scale-95"
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {filteredChats.map(chat => (
            <button
              key={chat.id}
              onClick={() => setCurrentChatId(chat.id)}
              className={cn(
                "w-full flex items-center justify-between gap-3 p-3 rounded-xl text-left transition-all group",
                currentChatId === chat.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              )}
            >
              <div className="flex items-center gap-3 truncate">
                <MessageSquare size={18} className="shrink-0" />
                <span className="truncate text-sm font-medium">{chat.title}</span>
              </div>
              <Trash2 
                size={16} 
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                onClick={(e) => deleteChat(chat.id, e)}
              />
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 space-y-4">
          <div className="flex items-center gap-3 p-2">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-zinc-700" alt="User" />
            <div className="flex-1 truncate">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-zinc-500 truncate">{user.email}</p>
            </div>
            <button onClick={logout} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-100">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-950/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-zinc-800 rounded-lg">
                <Menu size={20} />
              </button>
            )}
            {currentChatId ? (
              <div className="flex items-center gap-2">
                <span className="font-medium truncate max-w-[200px] sm:max-w-md">
                  {chats.find(c => c.id === currentChatId)?.title || 'Chat'}
                </span>
                <span className="px-2 py-0.5 bg-zinc-800 text-[10px] uppercase tracking-wider font-bold rounded-md text-zinc-400">
                  {selectedModel.name}
                </span>
              </div>
            ) : (
              <span className="font-medium">Select or create a chat</span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-zinc-900 rounded-lg p-1">
              <button 
                onClick={() => exportChat('txt')}
                disabled={messages.length === 0}
                className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                title="Export as TXT"
              >
                <Download size={16} />
              </button>
              <button 
                onClick={() => exportChat('json')}
                disabled={messages.length === 0}
                className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                title="Export as JSON"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                showSettings ? "bg-zinc-100 text-zinc-950" : "hover:bg-zinc-800 text-zinc-400"
              )}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
          {messages.length === 0 && currentChatId && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
              <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center border border-zinc-800">
                <Bot size={32} className="text-zinc-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Start a conversation</h3>
                <p className="text-zinc-500 text-sm">
                  You're chatting with <span className="text-zinc-300 font-medium">{selectedModel.name}</span>. 
                  {selectedModel.isUncensored ? " This model is uncensored and will follow your instructions without restrictions." : " This is a standard model with safety guidelines."}
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <motion.div 
              key={msg.id || idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex gap-4 max-w-4xl mx-auto group",
                msg.role === 'user' ? "flex-row-reverse" : ""
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
                msg.role === 'user' ? "bg-zinc-100 border-zinc-200 text-zinc-950" : "bg-zinc-900 border-zinc-800 text-zinc-400"
              )}>
                {msg.role === 'user' ? <UserIcon size={16} /> : <Bot size={16} />}
              </div>
              <div className={cn(
                "flex flex-col space-y-1 min-w-0",
                msg.role === 'user' ? "items-end" : "items-start"
              )}>
                <div className={cn(
                  "p-4 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user' ? "bg-zinc-800 text-zinc-100" : "bg-zinc-900/50 text-zinc-300 border border-zinc-800/50"
                )}>
                  {msg.image && (
                    <img src={msg.image} className="max-w-xs rounded-lg mb-3 border border-zinc-700" alt="Uploaded" />
                  )}
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-600 px-1">
                  {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                </span>
              </div>
            </motion.div>
          ))}
          {isSending && (
            <div className="flex gap-4 max-w-4xl mx-auto">
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                <Bot size={16} />
              </div>
              <div className="flex items-center gap-1 p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800/50">
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-zinc-950">
          <form 
            onSubmit={handleSendMessage}
            className="max-w-4xl mx-auto relative"
          >
            {selectedImage && (
              <div className="absolute bottom-full left-0 mb-2 p-2 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center gap-2">
                <img src={selectedImage} className="w-12 h-12 object-cover rounded-lg" alt="Preview" />
                <button 
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  className="p-1 hover:bg-zinc-800 rounded-full text-zinc-400"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <input 
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-zinc-700 transition-all">
              <button 
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!currentChatId || isSending}
                className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-400 transition-colors disabled:opacity-50"
              >
                <ImageIcon size={20} />
              </button>
              <input 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={currentChatId ? "Type a message..." : "Select a chat to start typing"}
                disabled={!currentChatId || isSending}
                className="flex-1 bg-transparent py-2 focus:outline-none disabled:opacity-50"
              />
              <button 
                type="submit"
                disabled={!input.trim() || isSending || !currentChatId}
                className="w-10 h-10 bg-zinc-100 text-zinc-950 rounded-xl flex items-center justify-center hover:bg-zinc-200 transition-all active:scale-90 disabled:opacity-50 disabled:scale-100"
              >
                <Send size={18} />
              </button>
            </div>
          </form>
          <p className="text-center text-[10px] text-zinc-600 mt-2">
            limitlessAssistant can make mistakes. Check important info.
          </p>
        </div>

        {/* Settings Overlay */}
        <AnimatePresence>
          {showSettings && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSettings(false)}
                className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm z-30"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="absolute top-20 right-4 left-4 sm:left-auto sm:right-4 sm:w-[400px] bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl z-40 overflow-hidden"
              >
                <div className="p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Chat Settings</h3>
                    <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-zinc-800 rounded-md">
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Model Selection</label>
                      <div className="grid grid-cols-1 gap-2">
                        {DEFAULT_MODELS.map(model => (
                          <div key={model.id} className="space-y-1">
                            <button
                              onClick={() => {
                                setSelectedModel(model);
                                setSelectedVersion(model.versions?.[0] || 'latest');
                              }}
                              className={cn(
                                "w-full flex flex-col p-3 rounded-xl border text-left transition-all",
                                selectedModel.id === model.id 
                                  ? "bg-zinc-100 border-zinc-100 text-zinc-950" 
                                  : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-sm">{model.name}</span>
                                {model.isUncensored && (
                                  <span className={cn(
                                    "text-[8px] px-1.5 py-0.5 rounded font-black uppercase",
                                    selectedModel.id === model.id ? "bg-zinc-950 text-zinc-100" : "bg-red-500/10 text-red-500"
                                  )}>
                                    Uncensored
                                  </span>
                                )}
                              </div>
                              <span className="text-xs opacity-70 mt-1">{model.description}</span>
                            </button>
                            
                            {selectedModel.id === model.id && model.versions && (
                              <div className="flex flex-wrap gap-1 p-1 bg-zinc-800/50 rounded-lg">
                                {model.versions.map(v => (
                                  <button
                                    key={v}
                                    onClick={() => setSelectedVersion(v)}
                                    className={cn(
                                      "px-2 py-1 rounded text-[10px] font-bold transition-all",
                                      selectedVersion === v 
                                        ? "bg-zinc-100 text-zinc-950" 
                                        : "text-zinc-500 hover:text-zinc-300"
                                    )}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4 p-4 bg-zinc-950 rounded-2xl border border-zinc-800">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Sliders size={14} />
                        <span className="text-xs font-bold uppercase tracking-wider">Advanced Settings</span>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold uppercase text-zinc-500">
                            <span>Temperature</span>
                            <span>{temperature}</span>
                          </div>
                          <input 
                            type="range" min="0" max="2" step="0.1"
                            value={temperature}
                            onChange={(e) => setTemperature(parseFloat(e.target.value))}
                            className="w-full accent-zinc-100"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold uppercase text-zinc-500">
                            <span>Max Tokens</span>
                            <span>{maxTokens}</span>
                          </div>
                          <input 
                            type="range" min="256" max="8192" step="256"
                            value={maxTokens}
                            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                            className="w-full accent-zinc-100"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">System Message</label>
                      <textarea 
                        value={systemMessage}
                        onChange={(e) => setSystemMessage(e.target.value)}
                        placeholder="e.g. You are a helpful assistant that speaks like a pirate."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm h-24 focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-zinc-800">
                    <button 
                      onClick={createNewChat}
                      className="w-full bg-zinc-100 text-zinc-950 py-3 rounded-xl font-bold hover:bg-zinc-200 transition-all"
                    >
                      Apply & Start New Chat
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
