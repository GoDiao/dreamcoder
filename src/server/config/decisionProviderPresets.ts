import type {
  DecisionProviderFormat,
  DecisionProviderPresetId,
  ProviderModel,
} from '../types/provider.js'

export type DecisionProviderPreset = {
  id: DecisionProviderPresetId
  name: string
  baseUrl: string
  apiFormat: DecisionProviderFormat
  models: ProviderModel[]
}

export const DECISION_PROVIDER_PRESETS: DecisionProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai_decisions',
    models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/alpha',
    apiFormat: 'openrouter_decisions',
    models: [
      { id: 'liquid/d1-ultra', name: 'd1-ultra' },
      { id: 'typesafe/jev-1.14', name: 'Jev 1.14' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434',
    apiFormat: 'ollama_chat',
    models: [],
  },
  {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    apiFormat: 'openai_decisions',
    models: [],
  },
]
