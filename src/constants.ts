export interface ChatModel {
  id: string;
  name: string;
  description: string;
  hfRepo?: string;
  isUncensored: boolean;
  versions?: string[];
  supportsImage?: boolean;
}

export const DEFAULT_MODELS: ChatModel[] = [
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Fast and efficient for general tasks.',
    isUncensored: false,
    versions: ['latest', '2024-12', '2024-10'],
    supportsImage: true,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    description: 'Advanced reasoning and complex tasks.',
    isUncensored: false,
    versions: ['latest', '2024-12'],
    supportsImage: true,
  },
  {
    id: 'dolphin-2.9.4-llama-3-8b',
    name: 'Dolphin 2.9.4 (Llama 3 8B)',
    description: 'Uncensored and highly capable model based on Llama 3.',
    hfRepo: 'cognitivecomputations/dolphin-2.9.4-llama-3-8b',
    isUncensored: true,
    versions: ['v2.9.4', 'v2.9.1'],
  },
  {
    id: 'nous-hermes-2-pro-llama-3-8b',
    name: 'Nous Hermes 2 Pro',
    description: 'Excellent for roleplay and creative writing.',
    hfRepo: 'NousResearch/Hermes-2-Pro-Llama-3-8B',
    isUncensored: true,
    versions: ['v2.0', 'v1.5'],
  }
];
