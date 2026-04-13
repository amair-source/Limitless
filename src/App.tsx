import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './lib/AuthContext';
import { signInWithGoogle, logout, db } from './lib/firebase';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { MessageSquare, Plus, LogOut, Send, User as UserIcon, Bot, Settings, Trash2, Menu, X, ChevronRight, Github, Search, Copy, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { DEFAULT_MODELS, ChatModel } from './constants';
import { chatWithGemini, chatWithUncensored } from './lib/ai';
import { handleFirestoreError, OperationType } from './lib/firestore-errors';

export default function App() {
  const { user, loading, isAuthReady } = useAuth();
  const [chats, setChats] = useState<any[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customModels, setCustomModels] = useState<ChatModel[]>([]);
  const [newModelRepo, setNewModelRepo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Chat settings
  const [selectedModel, setSelectedModel] = useState<ChatModel>(DEFAULT_MODELS[0]);
  const [systemMessage, setSystemMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-save settings and draft
  useEffect(() => {
    if (!user || !currentChatId || loading) return;

    const saveTimeout = setTimeout(async () => {
      setIsSaving(true);
      try {
        await updateDoc(doc(db, 'chats', currentChatId), {
          modelId: selectedModel.id,
          systemMessage: systemMessage,
          draft: input,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.error("Auto-save failed:", error);
      } finally {
        setIsSaving(false);
      }
    }, 1500); // Save after 1.5s of inactivity

    return () => clearTimeout(saveTimeout);
  }, [selectedModel, systemMessage, input, currentChatId, user]);

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
      setSystemMessage(chat.systemMessage || '');
      setInput(chat.draft || '');
    }

    return () => unsubscribe();
  }, [currentChatId, chats]);

  const createNewChat = async () => {
    if (!user) return;
    const newChat = {
      userId: user.uid,
      title: 'New Chat',
      modelId: selectedModel.id,
      systemMessage: systemMessage,
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user || !currentChatId || isSending) return;

    const userMessage = input.trim();
    const currentHistory = [...messages]; // Capture current state before addDoc
    setInput('');
    setIsSending(true);

    try {
      // 1. Add user message to Firestore
      await addDoc(collection(db, `chats/${currentChatId}/messages`), {
        chatId: currentChatId,
        role: 'user',
        content: userMessage,
        createdAt: serverTimestamp(),
      });

      // Update chat title if it's the first message
      if (currentHistory.length === 0) {
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
      // Construct history carefully to avoid race conditions with onSnapshot
      const chatHistory = [...currentHistory, { role: 'user', content: userMessage }];
      let aiResponse = '';
      
      if (selectedModel.isUncensored) {
        aiResponse = await chatWithUncensored(selectedModel.id, chatHistory, systemMessage);
      } else {
        aiResponse = await chatWithGemini(selectedModel.id, chatHistory, systemMessage);
      }

      // 3. Add AI message to Firestore
      await addDoc(collection(db, `chats/${currentChatId}/messages`), {
        chatId: currentChatId,
        role: 'assistant',
        content: aiResponse,
        createdAt: serverTimestamp(),
        feedback: null, // Initial feedback state
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `chats/${currentChatId}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleFeedback = async (messageId: string, type: 'up' | 'down') => {
    if (!currentChatId) return;
    try {
      await updateDoc(doc(db, `chats/${currentChatId}/messages`, messageId), {
        feedback: type,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chats/${currentChatId}/messages/${messageId}`);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const addCustomModel = () => {
    if (!newModelRepo.trim()) return;
    const repoName = newModelRepo.split('/').pop() || newModelRepo;
    const newModel: ChatModel = {
      id: newModelRepo.trim(),
      name: repoName,
      description: `Custom model from ${newModelRepo}`,
      hfRepo: newModelRepo.trim(),
      isUncensored: true,
    };
    setCustomModels([...customModels, newModel]);
    setNewModelRepo('');
  };

  const allModels = [...DEFAULT_MODELS, ...customModels];

  const filteredChats = chats.filter(chat => 
    chat.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-100 p-4 relative overflow-hidden">
        <div className="atmosphere" />
        <motion.div 
          initial={{ opacity: 0, y: 40, filter: "blur(20px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-md w-full text-center space-y-12 relative z-10"
        >
          <div className="space-y-4">
            <motion.div 
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="w-24 h-24 glass rounded-[40px] mx-auto flex items-center justify-center border-white/10 shadow-2xl"
            >
              <Bot size={48} className="text-white" />
            </motion.div>
            <div className="space-y-2">
              <h1 className="text-6xl font-black tracking-tighter bg-gradient-to-br from-white via-white to-zinc-600 bg-clip-text text-transparent">
                limitless
              </h1>
              <p className="text-zinc-500 font-medium tracking-widest uppercase text-[10px]">Uncensored Intelligence</p>
            </div>
          </div>
          
          <div className="p-10 glass rounded-[40px] border-white/5 shadow-2xl space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-bold">Welcome Back</h2>
              <p className="text-sm text-zinc-500">Sign in to access your private conversations and custom models.</p>
            </div>
            <button 
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white text-black py-5 px-6 rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95 shadow-xl shadow-white/5"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
              Continue with Google
            </button>
            <div className="flex items-center gap-4 py-2">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700">Secure Access</span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
            <p className="text-[10px] text-zinc-600 font-medium leading-relaxed">
              Your data is encrypted and stored securely in our private cloud infrastructure.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden relative">
      <div className="atmosphere" />
      
      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isSidebarOpen ? 300 : 0,
          x: isSidebarOpen ? 0 : -300,
          opacity: isSidebarOpen ? 1 : 0 
        }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={cn(
          "fixed lg:relative h-full glass-darker flex flex-col z-40 overflow-hidden",
          !isSidebarOpen && "pointer-events-none"
        )}
      >
        <div className="p-6 flex items-center justify-between border-b border-white/5">
          <h2 className="font-bold text-xl tracking-tight bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">
            limitless
          </h2>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-white/5 rounded-xl transition-colors lg:hidden">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <button 
            onClick={createNewChat}
            className="w-full flex items-center justify-center gap-2 bg-white text-black py-3 px-4 rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95 shadow-lg shadow-white/5"
          >
            <Plus size={18} />
            New Chat
          </button>

          <div className="relative group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-white transition-colors" />
            <input 
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-xs focus:outline-none focus:border-white/20 transition-all placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 space-y-1 custom-scrollbar">
          {filteredChats.map(chat => (
            <motion.button
              layout
              key={chat.id}
              onClick={() => {
                setCurrentChatId(chat.id);
                if (window.innerWidth < 1024) setIsSidebarOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between gap-3 p-3 rounded-2xl text-left transition-all group relative",
                currentChatId === chat.id ? "bg-white/10 text-white" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
              )}
            >
              <div className="flex items-center gap-3 truncate">
                <MessageSquare size={18} className={cn("shrink-0", currentChatId === chat.id ? "text-white" : "text-zinc-600")} />
                <span className="truncate text-sm font-medium">{chat.title}</span>
              </div>
              <Trash2 
                size={14} 
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                onClick={(e) => deleteChat(chat.id, e)}
              />
              {currentChatId === chat.id && (
                <motion.div layoutId="active-chat" className="absolute left-0 w-1 h-6 bg-white rounded-r-full" />
              )}
            </motion.button>
          ))}
        </div>

        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 p-3 glass rounded-2xl border-white/10">
            <img src={user.photoURL || ''} className="w-9 h-9 rounded-xl border border-white/10" alt="User" />
            <div className="flex-1 truncate">
              <p className="text-sm font-semibold truncate">{user.displayName}</p>
              <p className="text-[10px] text-zinc-500 truncate uppercase tracking-wider">{user.email}</p>
            </div>
            <button onClick={logout} className="p-2 hover:bg-white/10 rounded-xl text-zinc-500 hover:text-white transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative min-w-0 bg-transparent">
        {/* Header */}
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-6 glass z-20">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2.5 hover:bg-white/5 rounded-xl transition-colors border border-white/5">
                <Menu size={20} />
              </button>
            )}
            {currentChatId ? (
              <div className="flex flex-col">
                <span className="font-bold text-sm truncate max-w-[150px] sm:max-w-md">
                  {chats.find(c => c.id === currentChatId)?.title || 'Chat'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] uppercase tracking-widest font-black text-zinc-500">
                    {selectedModel.name}
                  </span>
                </div>
              </div>
            ) : (
              <span className="font-bold text-zinc-500 uppercase tracking-widest text-xs">Select a conversation</span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {isSaving && (
              <motion.div 
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-3 py-1.5 glass rounded-full border-white/5"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] uppercase tracking-widest font-bold text-zinc-500">Auto-saving</span>
              </motion.div>
            )}
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "p-2.5 rounded-xl transition-all border",
                showSettings ? "bg-white text-black border-white" : "hover:bg-white/5 text-zinc-400 border-white/5"
              )}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 no-scrollbar scroll-smooth">
          <AnimatePresence mode="popLayout">
            {messages.length === 0 && currentChatId && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
                className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-lg mx-auto"
              >
                <div className="w-20 h-20 glass rounded-3xl flex items-center justify-center border-white/10 shadow-2xl">
                  <Bot size={40} className="text-zinc-400" />
                </div>
                <div className="space-y-3">
                  <h3 className="text-3xl font-bold tracking-tight">Limitless Potential</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed">
                    You're chatting with <span className="text-white font-semibold">{selectedModel.name}</span>. 
                    {selectedModel.isUncensored 
                      ? " This model is uncensored and will follow your instructions without restrictions." 
                      : " This is a standard model with safety guidelines."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full">
                  {['Write a story', 'Explain quantum physics', 'Code a snake game', 'Roleplay as a pirate'].map(suggestion => (
                    <button 
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="p-4 glass rounded-2xl text-xs font-medium text-zinc-400 hover:text-white hover:border-white/20 transition-all text-left"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {messages.map((msg, idx) => (
              <motion.div 
                key={msg.id || idx}
                initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                className={cn(
                  "flex gap-4 sm:gap-6 max-w-5xl mx-auto group",
                  msg.role === 'user' ? "flex-row-reverse" : ""
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border shadow-lg",
                  msg.role === 'user' ? "bg-white border-white text-black" : "glass border-white/10 text-zinc-400"
                )}>
                  {msg.role === 'user' ? <UserIcon size={20} /> : <Bot size={20} />}
                </div>
                <div className={cn(
                  "flex flex-col space-y-2 min-w-0 max-w-[85%] sm:max-w-[75%]",
                  msg.role === 'user' ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "p-5 rounded-3xl text-sm leading-relaxed shadow-xl relative group/msg",
                    msg.role === 'user' 
                      ? "bg-zinc-800 text-zinc-100 rounded-tr-none" 
                      : "glass text-zinc-300 rounded-tl-none"
                  )}>
                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/5">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    
                    {/* Message Actions */}
                    <div className={cn(
                      "absolute top-2 opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-1 bg-zinc-900/80 backdrop-blur-md p-1 rounded-lg border border-white/10",
                      msg.role === 'user' ? "right-full mr-2" : "left-full ml-2"
                    )}>
                      <button 
                        onClick={() => copyToClipboard(msg.content, msg.id)}
                        className="p-1.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedId === msg.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      </button>
                      {msg.role === 'assistant' && (
                        <>
                          <button 
                            onClick={() => handleFeedback(msg.id, 'up')}
                            className={cn(
                              "p-1.5 hover:bg-white/10 rounded-md transition-colors",
                              msg.feedback === 'up' ? "text-emerald-500" : "text-zinc-400 hover:text-white"
                            )}
                            title="Helpful"
                          >
                            <ThumbsUp size={14} />
                          </button>
                          <button 
                            onClick={() => handleFeedback(msg.id, 'down')}
                            className={cn(
                              "p-1.5 hover:bg-white/10 rounded-md transition-colors",
                              msg.feedback === 'down' ? "text-red-500" : "text-zinc-400 hover:text-white"
                            )}
                            title="Not helpful"
                          >
                            <ThumbsDown size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-600 px-2">
                    {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isSending && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4 sm:gap-6 max-w-5xl mx-auto"
            >
              <div className="w-10 h-10 rounded-2xl glass border border-white/10 flex items-center justify-center text-zinc-400 relative overflow-hidden">
                <Bot size={20} />
                <motion.div 
                  animate={{ 
                    top: ["100%", "-100%"],
                    left: ["-100%", "100%"]
                  }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="absolute w-full h-full bg-white/10 rotate-45"
                />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 p-6 glass rounded-3xl rounded-tl-none border-white/5 relative overflow-hidden group">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{ 
                          scale: [1, 1.4, 1],
                          opacity: [0.3, 1, 0.3],
                          backgroundColor: ["#ffffff", "#a1a1aa", "#ffffff"]
                        }}
                        transition={{ 
                          repeat: Infinity, 
                          duration: 1.2, 
                          delay: i * 0.2,
                          ease: "easeInOut"
                        }}
                        className="w-2.5 h-2.5 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                      />
                    ))}
                  </div>
                  
                  {/* Dynamic pulse effect */}
                  <motion.div 
                    animate={{ opacity: [0, 0.1, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent -skew-x-12"
                  />
                </div>
                <span className="text-[10px] uppercase tracking-[0.3em] font-black text-zinc-600 px-2 flex items-center gap-2">
                  <motion.span 
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  >
                    Neural processing
                  </motion.span>
                  <motion.span
                    animate={{ x: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                  >
                    ...
                  </motion.span>
                </span>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* Input Area */}
        <div className="p-4 sm:p-8 bg-transparent">
          <form 
            onSubmit={handleSendMessage}
            className="max-w-4xl mx-auto relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-white/20 to-zinc-500/20 rounded-[28px] blur opacity-25 group-focus-within:opacity-100 transition duration-1000 group-focus-within:duration-200" />
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={currentChatId ? "Ask anything..." : "Select a chat to begin"}
              disabled={!currentChatId || isSending}
              className="relative w-full glass border-white/10 rounded-[24px] py-5 pl-6 pr-16 focus:outline-none focus:border-white/20 transition-all disabled:opacity-50 text-sm placeholder:text-zinc-600"
            />
            <button 
              type="submit"
              disabled={!input.trim() || isSending || !currentChatId}
              className="absolute right-3 top-3 bottom-3 w-12 bg-white text-black rounded-2xl flex items-center justify-center hover:bg-zinc-200 transition-all active:scale-90 disabled:opacity-50 disabled:scale-100 shadow-xl"
            >
              <Send size={20} />
            </button>
          </form>
          <p className="text-center text-[10px] font-bold uppercase tracking-widest text-zinc-700 mt-4">
            limitlessAssistant • Uncensored Intelligence
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
                className="absolute inset-0 bg-black/60 backdrop-blur-md z-30"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 40 }}
                className="absolute bottom-4 sm:bottom-auto sm:top-24 right-4 left-4 sm:left-auto sm:right-8 sm:w-[450px] glass border-white/10 rounded-[32px] shadow-2xl z-40 overflow-hidden"
              >
                <div className="p-8 space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="text-2xl font-bold tracking-tight">Settings</h3>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Configure your assistant</p>
                    </div>
                    <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Model Engine</label>
                      <div className="grid grid-cols-1 gap-2 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
                        {allModels.map(model => (
                          <button
                            key={model.id}
                            onClick={() => setSelectedModel(model)}
                            className={cn(
                              "flex flex-col p-4 rounded-2xl border text-left transition-all relative overflow-hidden group",
                              selectedModel.id === model.id 
                                ? "bg-white border-white text-black" 
                                : "glass border-white/5 text-zinc-400 hover:border-white/20"
                            )}
                          >
                            <div className="flex items-center justify-between relative z-10">
                              <span className="font-bold text-sm">{model.name}</span>
                              {model.isUncensored && (
                                <span className={cn(
                                  "text-[8px] px-2 py-0.5 rounded-full font-black uppercase tracking-tighter",
                                  selectedModel.id === model.id ? "bg-black text-white" : "bg-red-500/20 text-red-400"
                                )}>
                                  Uncensored
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] opacity-70 mt-1 relative z-10 leading-relaxed">{model.description}</span>
                            {selectedModel.id === model.id && (
                              <motion.div layoutId="active-model" className="absolute inset-0 bg-white" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Import HF Repo</label>
                      <div className="flex gap-2">
                        <input 
                          value={newModelRepo}
                          onChange={(e) => setNewModelRepo(e.target.value)}
                          placeholder="NousResearch/Hermes-3-Llama-3.1-8B"
                          className="flex-1 glass border-white/10 rounded-xl p-3 text-xs focus:outline-none focus:border-white/20 transition-all"
                        />
                        <button 
                          onClick={addCustomModel}
                          className="bg-white text-black px-4 rounded-xl text-xs font-bold hover:bg-zinc-200 transition-all active:scale-95"
                        >
                          Import
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">System Instruction</label>
                      <textarea 
                        value={systemMessage}
                        onChange={(e) => setSystemMessage(e.target.value)}
                        placeholder="Define the AI's persona..."
                        className="w-full glass border-white/10 rounded-2xl p-4 text-xs h-28 focus:outline-none focus:border-white/20 transition-all resize-none"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button 
                      onClick={createNewChat}
                      className="w-full bg-white text-black py-4 rounded-2xl font-bold hover:bg-zinc-200 transition-all shadow-xl active:scale-[0.98]"
                    >
                      Initialize New Session
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
