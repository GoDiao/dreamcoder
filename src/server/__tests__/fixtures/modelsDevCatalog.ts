import { afterEach, beforeEach } from 'bun:test'

import type { ModelsDevData, ModelsDevModel } from '../../services/modelsDev/catalog.js'
import { setModelsDevData } from '../../services/modelsDev/modelsDevStore.js'

type Thinking = 'none' | 'always' | 'toggle' | 'budget' | { effort: string[]; toggle?: boolean; budget?: boolean }

export function catalogModel(
  context: number,
  output: number,
  thinking: Thinking,
  input: string[] = ['text'],
): ModelsDevModel {
  const reasoning =
    thinking === 'none'
      ? { reasoning: false }
      : thinking === 'always'
        ? { reasoning: true, reasoning_options: [] }
        : thinking === 'toggle'
          ? { reasoning: true, reasoning_options: [{ type: 'toggle' }] }
          : thinking === 'budget'
            ? { reasoning: true, reasoning_options: [{ type: 'budget_tokens' }] }
            : {
                reasoning: true,
                reasoning_options: [
                  ...(thinking.toggle ? [{ type: 'toggle' }] : []),
                  { type: 'effort', values: thinking.effort },
                  ...(thinking.budget ? [{ type: 'budget_tokens' }] : []),
                ],
              }
  return {
    limit: { context, output },
    ...reasoning,
    modalities: { input },
  }
}

const FULL = ['text', 'image', 'pdf']
const IMAGE = ['text', 'image']
const CLAUDE_LEVELS = ['low', 'medium', 'high', 'max']
const CLAUDE_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max']

export const TEST_MODELS_DEV: ModelsDevData = {
  fetchedAt: '2026-11-20T00:00:00.000Z',
  catalog: {
    deepseek: {
      api: 'https://api.deepseek.com',
      models: {
        'deepseek-v4-pro': catalogModel(1_048_576, 393_216, { effort: ['low', 'high', 'max'], toggle: true }, ['text']),
        'deepseek-v4-flash': catalogModel(1_048_576, 393_216, { effort: ['low', 'high', 'max'], toggle: true }, IMAGE),
      },
    },
    openai: {
      api: 'https://api.openai.com/v1',
      models: {
        'gpt-5': catalogModel(400_000, 128_000, { effort: ['minimal', 'low', 'medium', 'high'] }, IMAGE),
        'gpt-5.1': catalogModel(400_000, 128_000, { effort: ['none', 'low', 'medium', 'high'] }, IMAGE),
        'gpt-5.4': catalogModel(1_050_000, 128_000, { effort: ['none', 'low', 'medium', 'high'] }, FULL),
        'gpt-6-luna': catalogModel(1_050_000, 128_000, { effort: ['none', 'low', 'medium', 'high', 'max'] }, FULL),
        'gpt-6.1-terra': catalogModel(1_050_000, 128_000, { effort: ['none', 'low', 'medium', 'high', 'max'] }, FULL),
        'gpt-6.1-sol': catalogModel(1_050_000, 128_000, { effort: ['low', 'medium', 'high', 'max'] }, FULL),
        'gpt-6.2-sol': catalogModel(1_050_000, 128_000, { effort: ['low', 'medium', 'high', 'max'] }, FULL),
        'gpt-6.2-astra': catalogModel(1_050_000, 128_000, { effort: ['low', 'medium', 'high', 'max'] }, FULL),
        'gpt-4.1': catalogModel(1_047_576, 32_768, 'none', FULL),
      },
    },
    anthropic: {
      api: 'https://api.anthropic.com/v1',
      models: {
        'claude-fable-5-2': catalogModel(1_000_000, 128_000, { effort: CLAUDE_LEVELS }, FULL),
        'claude-opus-5-5': catalogModel(1_000_000, 128_000, { effort: CLAUDE_LEVELS }, FULL),
        'claude-sonnet-5-5': catalogModel(1_000_000, 128_000, { effort: CLAUDE_LEVELS }, FULL),
        'claude-opus-4-8': catalogModel(1_000_000, 128_000, { effort: CLAUDE_EFFORT }, FULL),
        'claude-opus-4-7': catalogModel(1_000_000, 128_000, { effort: CLAUDE_EFFORT }, FULL),
        'claude-opus-4-6': catalogModel(1_000_000, 128_000, { effort: CLAUDE_LEVELS, budget: true }, FULL),
        'claude-sonnet-4-6': catalogModel(1_000_000, 128_000, { effort: CLAUDE_LEVELS, budget: true }, FULL),
        'claude-opus-4-5': catalogModel(200_000, 64_000, { effort: ['low', 'medium', 'high'], budget: true }, FULL),
        'claude-sonnet-4-5': catalogModel(200_000, 64_000, 'budget', FULL),
        'claude-sonnet-4-5-20250929': catalogModel(200_000, 64_000, 'budget', FULL),
        'claude-haiku-4-5': catalogModel(200_000, 64_000, 'budget', FULL),
      },
    },
    zai: {
      api: 'https://api.z.ai/api/paas/v4',
      models: {
        'glm-5.1': catalogModel(200_000, 131_072, 'toggle', ['text']),
        'glm-5.2': catalogModel(1_000_000, 128_000, { effort: ['high', 'max'], toggle: true }, ['text']),
        'glm-4.5': catalogModel(128_000, 96_000, 'toggle', ['text']),
        'glm-4.5-air': catalogModel(128_000, 96_000, 'toggle', ['text']),
      },
    },
    moonshotai: {
      api: 'https://api.moonshot.ai/v1',
      models: {
        'kimi-k3': catalogModel(1_048_576, 131_072, { effort: ['low', 'high', 'max'] }, IMAGE),
        'kimi-k2': catalogModel(262_144, 32_768, 'toggle', ['text']),
        'kimi-k2.6': catalogModel(262_144, 32_768, 'toggle', IMAGE),
        'kimi-k2.7-code': catalogModel(262_144, 32_768, 'always', ['text']),
      },
    },
    'alibaba-cn': {
      api: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: {
        'qwen3.5-plus': catalogModel(1_000_000, 65_536, 'toggle', IMAGE),
        'qwen-plus': catalogModel(1_000_000, 32_768, 'toggle', ['text']),
        'qwen-max': catalogModel(32_768, 8_192, 'none', ['text']),
      },
    },
    minimax: {
      api: 'https://api.minimax.io/v1',
      models: {
        'MiniMax-M3': catalogModel(1_000_000, 524_288, 'toggle', IMAGE),
        'MiniMax-M3.1-Flash': catalogModel(1_000_000, 524_288, { effort: CLAUDE_LEVELS }, IMAGE),
      },
    },
    openrouter: {
      api: 'https://openrouter.ai/api/v1',
      models: {
        'vendor/model': catalogModel(200_000, 32_000, { effort: ['none', 'medium', 'high'] }),
      },
    },
  },
}

export function useTestModelsDevCatalog(data: ModelsDevData = TEST_MODELS_DEV): void {
  beforeEach(() => setModelsDevData(data))
  afterEach(() => setModelsDevData(null))
}
