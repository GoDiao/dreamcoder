import type { ModelInfo } from '../types/settings'

export const PINSTRIPES_PROVIDER_ID = 'pinstripes'
export const PINSTRIPES_DEFAULT_MODEL_ID = 'deepseek-v4-flash'
export const PINSTRIPES_PROVIDER_NAME = 'Pinstripes'
export const PINSTRIPES_BASE_URL = 'https://api.pinstripes.io/v1'

export const PINSTRIPES_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'Fast and cost-effective coding model ($0.10/1M tokens)',
    context: '',
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5-Air',
    description: 'Efficient general-purpose model ($0.125/1M tokens)',
    context: '',
  },
  {
    id: 'qwen3-35b',
    name: 'Qwen3-35B',
    description: 'Strong reasoning model ($0.14/1M tokens)',
    context: '',
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    description: 'Long-context model with 192K ctx ($0.255/1M tokens)',
    context: '192k',
  },
]
