export interface ChatModel {
  id: string;
  name: string;
  description: string;
  hfRepo?: string; // Hugging Face repo if applicable
  isUncensored: boolean;
}

export const DEFAULT_MODELS: ChatModel[] = [
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Fast and efficient for general tasks.',
    isUncensored: false,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    description: 'Advanced reasoning and complex tasks.',
    isUncensored: false,
  },
  {
    id: 'dolphin-2.9.4-llama-3-8b',
    name: 'Dolphin 2.9.4 (Llama 3 8B)',
    description: 'Uncensored and highly capable model based on Llama 3.',
    hfRepo: 'cognitivecomputations/dolphin-2.9.4-llama-3-8b',
    isUncensored: true,
  },
  {
    id: 'nous-hermes-2-pro-llama-3-8b',
    name: 'Nous Hermes 2 Pro',
    description: 'Excellent for roleplay and creative writing.',
    hfRepo: 'NousResearch/Hermes-2-Pro-Llama-3-8B',
    isUncensored: true,
  }
];
