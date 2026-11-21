import { describe, expect, test } from 'bun:test'

import {
  buildCliModelRulesEnv,
  buildResolvedModelsView,
  toCliModelRules,
} from '../services/modelRules/cliModelRulesEnv.js'
import { BUILTIN_MODEL_RULES } from '../services/modelRules/builtinModelRules.js'
import { isOfficialAnthropicProvider } from '../services/modelRules/officialAnthropicProvider.js'
import { resolveModelRules } from '../services/modelRules/resolveModelRules.js'
import type { ReasoningControl, ReasoningDialect, ResolvedModelRules } from '../types/modelRules.js'
import type { ApiFormat } from '../types/provider.js'
import { CliModelRulesSchema, type CliModelRules } from '../../utils/model/modelRules.js'
import type { EffortLevel } from '../../utils/effort.js'
import { useTestModelsDevCatalog } from './fixtures/modelsDevCatalog.js'

useTestModelsDevCatalog()

function resolved(
  control: ReasoningControl,
  levels: EffortLevel[],
  reasoningDialect: ReasoningDialect,
  extra: Partial<ResolvedModelRules> = {},
): ResolvedModelRules {
  return {
    ...BUILTIN_MODEL_RULES.fallback.rules,
    reasoning: { control, levels },
    reasoningDialect,
    usedFallback: false,
    sources: {
      contextWindow: 'model',
      maxOutputTokens: 'model',
      reasoning: 'model',
      image: 'model',
      pdf: 'model',
      structuredOutput: 'model',
    },
    ...extra,
  }
}

type Row = [string, ReasoningControl, EffortLevel[], ReasoningDialect, ApiFormat, Pick<CliModelRules, 'thinkingWhenOn' | 'thinkingWhenOff' | 'effortLevels'>]

const rows: Row[] = [
  ['none via the proxy', 'none', [], 'thinking_type', 'openai_chat', { thinkingWhenOn: 'omit', thinkingWhenOff: 'omit', effortLevels: [] }],
  ['toggle via the proxy', 'toggle', [], 'thinking_type', 'openai_chat', { thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: [] }],
  ['toggle_effort via the proxy', 'toggle_effort', ['low', 'high'], 'openrouter', 'openai_chat', { thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: ['low', 'high'] }],
  ['effort via the proxy', 'effort', ['low', 'medium', 'high'], 'responses_reasoning', 'openai_responses', { thinkingWhenOn: 'adaptive', thinkingWhenOff: 'omit', effortLevels: ['low', 'medium', 'high'] }],
  ['always via the proxy', 'always', ['high'], 'reasoning_effort', 'openai_chat', { thinkingWhenOn: 'adaptive', thinkingWhenOff: 'omit', effortLevels: ['high'] }],
  ['anthropic_adaptive toggle_effort', 'toggle_effort', ['low', 'high', 'max'], 'anthropic_adaptive', 'anthropic', { thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: ['low', 'high', 'max'] }],
  ['anthropic_adaptive always', 'always', ['low', 'max'], 'anthropic_adaptive', 'anthropic', { thinkingWhenOn: 'adaptive', thinkingWhenOff: 'omit', effortLevels: ['low', 'max'] }],
  ['anthropic_budget toggle_effort', 'toggle_effort', ['low', 'high'], 'anthropic_budget', 'anthropic', { thinkingWhenOn: 'budget', thinkingWhenOff: 'disabled', effortLevels: [] }],
  ['anthropic_budget none', 'none', [], 'anthropic_budget', 'anthropic', { thinkingWhenOn: 'omit', thinkingWhenOff: 'omit', effortLevels: [] }],
  ['anthropic_disable_only toggle', 'toggle', [], 'anthropic_disable_only', 'anthropic', { thinkingWhenOn: 'omit', thinkingWhenOff: 'disabled', effortLevels: [] }],
  ['anthropic_disable_only always', 'always', ['low', 'high', 'max'], 'anthropic_disable_only', 'anthropic', { thinkingWhenOn: 'omit', thinkingWhenOff: 'omit', effortLevels: [] }],
  ['anthropic_disable_only none', 'none', [], 'anthropic_disable_only', 'anthropic', { thinkingWhenOn: 'omit', thinkingWhenOff: 'disabled', effortLevels: [] }],
]

describe('toCliModelRules', () => {
  test.each(rows)('%s', (_name, control, levels, dialect, apiFormat, expected) => {
    const cli = toCliModelRules(resolved(control, levels, dialect), apiFormat)
    expect({ thinkingWhenOn: cli.thinkingWhenOn, thinkingWhenOff: cli.thinkingWhenOff, effortLevels: cli.effortLevels }).toEqual(expected)
  })

  test('copies the capability fields', () => {
    const cli = toCliModelRules(
      resolved('none', [], 'reasoning_effort', {
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        input: { image: false, pdf: true },
        nativeWebSearch: true,
        structuredOutput: true,
      }),
      'openai_chat',
    )
    expect(CliModelRulesSchema.parse(cli)).toEqual({
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      thinkingWhenOn: 'omit',
      thinkingWhenOff: 'omit',
      effortLevels: [],
      pdf: true,
      image: false,
      nativeWebSearch: true,
      structuredOutput: true,
    })
  })

  test('leaves out an output limit that comes from the fallback', () => {
    const rules = resolved('none', [], 'reasoning_effort')
    const cli = toCliModelRules({ ...rules, sources: { ...rules.sources, maxOutputTokens: 'fallback' } }, 'openai_chat')
    expect('maxOutputTokens' in cli).toBe(false)
  })
})

describe('buildCliModelRulesEnv', () => {
  const deepseek = { baseUrl: 'https://api.deepseek.com/anthropic', apiFormat: 'anthropic' as const }

  test('keys models by normalized id without duplicates', () => {
    const env = buildCliModelRulesEnv(deepseek, ['deepseek-v4-pro', 'DeepSeek-V4-Pro', 'deepseek-v4-flash', 'Custom.Model'], undefined)
    expect(Object.keys(env.models)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash', 'custom-model'])
    expect(env.models['deepseek-v4-pro']).toEqual({
      contextWindow: 1_048_576,
      maxOutputTokens: 393_216,
      thinkingWhenOn: 'adaptive',
      thinkingWhenOff: 'disabled',
      effortLevels: ['low', 'high', 'max'],
      pdf: false,
      image: false,
      nativeWebSearch: false,
      structuredOutput: false,
    })
    expect(env.models['custom-model']).toEqual(env.fallback)
  })

  test('derives the fallback from the fallback, apiFormat and site host layers', () => {
    expect(buildCliModelRulesEnv(deepseek, [], undefined).fallback).toEqual({
      contextWindow: 131_072,
      thinkingWhenOn: 'omit',
      thinkingWhenOff: 'omit',
      effortLevels: [],
      pdf: false,
      image: true,
      nativeWebSearch: false,
      structuredOutput: false,
    })
    const kimi = buildCliModelRulesEnv({ baseUrl: 'https://api.kimi.com/coding', apiFormat: 'anthropic' }, ['kimi-for-coding'], 'low')
    expect(kimi.fallback.thinkingWhenOff).toBe('disabled')
    expect(kimi.models['kimi-for-coding']?.thinkingWhenOff).toBe('disabled')
  })

  test('normalizes the default effort', () => {
    expect(buildCliModelRulesEnv(deepseek, [], undefined).defaultEffort).toBe('medium')
    expect(buildCliModelRulesEnv(deepseek, [], 'max').defaultEffort).toBe('max')
    expect(buildCliModelRulesEnv(deepseek, [], 'extreme').defaultEffort).toBe('medium')
  })

  test('applies user overrides', () => {
    const env = buildCliModelRulesEnv(
      { baseUrl: 'https://unknown.test/v1', apiFormat: 'openai_chat', modelOverrides: { zeta: { maxOutputTokens: 8_000, reasoningLevels: ['high'] } } },
      ['zeta'],
      undefined,
    )
    expect(env.models.zeta).toMatchObject({ maxOutputTokens: 8_000, thinkingWhenOn: 'adaptive', effortLevels: ['high'] })
  })
})

describe('Claude models on an anthropic endpoint', () => {
  test('a relay without a site entry sends adaptive thinking with effort', () => {
    const env = buildCliModelRulesEnv({ baseUrl: 'https://relay.example.com', apiFormat: 'anthropic' }, ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'], undefined)
    expect(env.models['claude-opus-4-7']).toMatchObject({ thinkingWhenOn: 'adaptive', effortLevels: ['low', 'medium', 'high', 'max'] })
    expect(env.models['claude-sonnet-4-6']).toMatchObject({ thinkingWhenOn: 'adaptive', effortLevels: ['low', 'medium', 'high', 'max'] })
    expect(env.models['claude-haiku-4-5']).toMatchObject({ thinkingWhenOn: 'budget', effortLevels: [] })
  })

  test('a registered site entry still decides the dialect', () => {
    const env = buildCliModelRulesEnv({ baseUrl: 'https://api.kimi.com/coding', apiFormat: 'anthropic' }, ['claude-opus-4-7'], undefined)
    expect(env.models['claude-opus-4-7']).toMatchObject({ thinkingWhenOn: 'omit', effortLevels: [] })
  })

  test('an OpenRouter chat endpoint keeps its own dialect', () => {
    const rules = resolveModelRules({ baseUrl: 'https://openrouter.ai/api/v1', apiFormat: 'openai_chat' }, 'anthropic/claude-opus-4-7')
    expect(rules.reasoningDialect).toBe('openrouter')
  })
})

describe('Claude models the official model pages list', () => {
  const relay = { baseUrl: 'https://relay.example.com', apiFormat: 'anthropic' } as const

  test('claude-sonnet-4-5 on a relay can think, has a 200K window and reads PDFs', () => {
    const env = buildCliModelRulesEnv(relay, ['claude-sonnet-4-5-20250929'], undefined)
    expect(env.models['claude-sonnet-4-5-20250929']).toMatchObject({
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      thinkingWhenOn: 'budget',
      thinkingWhenOff: 'disabled',
      pdf: true,
    })
  })

  test('adaptive models get every effort level, and always-on models never send disabled', () => {
    const env = buildCliModelRulesEnv(relay, ['claude-opus-4-6', 'claude-opus-4-8', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'], undefined)
    const levels = ['low', 'medium', 'high', 'max']
    expect(env.models['claude-opus-4-6']).toMatchObject({ contextWindow: 1_000_000, thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: levels })
    expect(env.models['claude-opus-4-8']).toMatchObject({ thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: levels })
    for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']) {
      expect({ id, rules: env.models[id] }).toMatchObject({ id, rules: { thinkingWhenOn: 'adaptive', thinkingWhenOff: 'omit', effortLevels: levels } })
    }
  })

  test('budget-only Claude models send no effort', () => {
    const env = buildCliModelRulesEnv(relay, ['claude-opus-4-5', 'claude-opus-4-1'], undefined)
    expect(env.models['claude-opus-4-5']).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 64_000, thinkingWhenOn: 'budget', effortLevels: [] })
    expect(env.models['claude-opus-4-1']).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 32_000, thinkingWhenOn: 'budget', effortLevels: [] })
  })
})

describe('native web search for Claude models', () => {
  test('a custom anthropic relay uses it for Claude models', () => {
    const env = buildCliModelRulesEnv({ baseUrl: 'https://relay.example.com', apiFormat: 'anthropic' }, ['claude-opus-4-7', 'claude-sonnet-4-5'], undefined)
    expect(env.models['claude-opus-4-7']?.nativeWebSearch).toBe(true)
    expect(env.models['claude-sonnet-4-5']?.nativeWebSearch).toBe(true)
  })

  test('a registered anthropic site keeps it off for Claude model names', () => {
    for (const baseUrl of ['https://api.deepseek.com/anthropic', 'https://api.kimi.com/coding', 'https://open.bigmodel.cn/api/anthropic', 'https://api.minimax.io/anthropic']) {
      const rules = resolveModelRules({ baseUrl, apiFormat: 'anthropic' }, 'claude-opus-4-7')
      expect({ baseUrl, nativeWebSearch: rules.nativeWebSearch }).toEqual({ baseUrl, nativeWebSearch: false })
    }
  })

  test('OpenRouter chat does not use it for Claude models', () => {
    const rules = resolveModelRules({ baseUrl: 'https://openrouter.ai/api/v1', apiFormat: 'openai_chat' }, 'anthropic/claude-opus-4-7')
    expect(rules.nativeWebSearch).toBe(false)
  })

  test('models outside the web search list do not use it', () => {
    const env = buildCliModelRulesEnv({ baseUrl: 'https://relay.example.com', apiFormat: 'anthropic' }, ['claude-opus-4-1', 'deepseek-v4-pro'], undefined)
    expect(env.models['claude-opus-4-1']?.nativeWebSearch).toBe(false)
    expect(env.models['deepseek-v4-pro']?.nativeWebSearch).toBe(false)
  })
})

describe('GPT-6 models the official model pages list', () => {
  const gateway = { baseUrl: 'https://gateway.example.com/v1', apiFormat: 'openai_responses' } as const
  const levels = ['low', 'medium', 'high', 'max']

  test('gpt-6-luna and gpt-6.1-terra on a Responses relay have every level and can turn thinking off', () => {
    const env = buildCliModelRulesEnv(gateway, ['gpt-6-luna', 'gpt-6.1-terra'], undefined)
    for (const id of ['gpt-6-luna', 'gpt-6-1-terra']) {
      expect({ id, rules: env.models[id] }).toMatchObject({
        id,
        rules: { contextWindow: 1_050_000, maxOutputTokens: 128_000, thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: levels, image: true },
      })
    }
  })

  test('the Sol and Astra models never turn thinking off', () => {
    const env = buildCliModelRulesEnv(gateway, ['gpt-6.1-sol', 'gpt-6.2-sol', 'gpt-6.2-astra'], undefined)
    for (const id of ['gpt-6-1-sol', 'gpt-6-2-sol', 'gpt-6-2-astra']) {
      expect({ id, rules: env.models[id] }).toMatchObject({
        id,
        rules: { contextWindow: 1_050_000, thinkingWhenOn: 'adaptive', thinkingWhenOff: 'omit', effortLevels: levels },
      })
    }
  })
})

describe('reasoning that models.dev lists for OpenRouter', () => {
  const openrouter = { baseUrl: 'https://openrouter.ai/api', apiFormat: 'anthropic' } as const

  test('gives a model without a table entry adaptive thinking with an effort menu on the Messages endpoint', () => {
    const env = buildCliModelRulesEnv(openrouter, ['vendor/model'], undefined)
    expect(env.models['vendor/model']).toMatchObject({ thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: ['medium', 'high'] })
    const view = buildResolvedModelsView(openrouter, ['vendor/model'])?.['vendor/model']
    expect(view).toMatchObject({ effortLevels: ['medium', 'high'], usedFallback: false })
    expect(view?.sources.reasoning).toBe('modelsDev')
  })
})

describe('built-in entries added after review', () => {
  test('kimi-k2.7-code never turns thinking off', () => {
    const env = buildCliModelRulesEnv({ baseUrl: 'https://api.kimi.com/coding', apiFormat: 'anthropic' }, ['kimi-k2.7-code', 'kimi-k2.6'], undefined)
    expect(env.models['kimi-k2-7-code']).toMatchObject({ thinkingWhenOn: 'omit', thinkingWhenOff: 'omit', contextWindow: 262_144 })
    expect(env.models['kimi-k2-6']?.thinkingWhenOff).toBe('disabled')
  })

  test('the overseas Kimi Code and DashScope hosts use their domestic dialects', () => {
    expect(resolveModelRules({ baseUrl: 'https://api.kimi.ai/coding/', apiFormat: 'anthropic' }, 'kimi-for-coding').reasoningDialect).toBe('anthropic_disable_only')
    const intl = resolveModelRules({ baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', apiFormat: 'openai_chat' }, 'qwen-plus')
    expect({ dialect: intl.reasoningDialect, field: intl.maxTokensField }).toEqual({ dialect: 'enable_thinking', field: 'max_completion_tokens' })
  })

  test('glm-5.2 has its own window and maps low and medium to high', () => {
    const provider = { baseUrl: 'https://api.z.ai/api/paas/v4', apiFormat: 'openai_chat' } as const
    const env = buildCliModelRulesEnv(provider, ['glm-5.2'], undefined)
    expect(env.models['glm-5-2']).toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: 128_000, thinkingWhenOff: 'disabled', effortLevels: ['high', 'max'] })
    expect(buildResolvedModelsView(provider, ['glm-5.2'])?.['glm-5.2']?.appliedEffort).toEqual({ low: 'high', medium: 'high', high: 'high', max: 'max' })
  })
})

describe('buildResolvedModelsView', () => {
  test('maps every effort level through the model levels', () => {
    const view = buildResolvedModelsView({ baseUrl: 'https://api.deepseek.com/anthropic', apiFormat: 'anthropic' }, ['deepseek-v4-pro', 'zeta'])
    expect(view?.['deepseek-v4-pro']).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 393_216,
      reasoning: { control: 'toggle_effort' },
      effortLevels: ['low', 'high', 'max'],
      appliedEffort: { low: 'low', medium: 'high', high: 'high', max: 'max' },
      image: false,
      pdf: false,
      usedFallback: false,
      sources: {
        contextWindow: 'modelsDev',
        maxOutputTokens: 'modelsDev',
        reasoning: 'modelsDev',
        image: 'modelsDev',
        pdf: 'modelsDev',
        structuredOutput: 'model',
      },
    })
    expect(view?.zeta?.usedFallback).toBe(true)
    expect(view?.zeta && 'appliedEffort' in view.zeta).toBe(false)
  })

  test('shows no levels where the CLI sends no effort', () => {
    const view = buildResolvedModelsView({ baseUrl: 'https://api.kimi.com/coding', apiFormat: 'anthropic' }, ['kimi-k3'])
    expect(view?.['kimi-k3']?.reasoning.control).toBe('effort')
    expect(view?.['kimi-k3']?.effortLevels).toEqual([])
    expect(view?.['kimi-k3'] && 'appliedEffort' in view['kimi-k3']).toBe(false)
  })

  test('gives the values a user override replaces, with their sources', () => {
    const view = buildResolvedModelsView(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiFormat: 'openai_chat',
        modelOverrides: { 'gpt-5': { reasoningLevels: [], contextWindow: 200_000 } },
      },
      ['gpt-5'],
    )
    expect(view?.['gpt-5']).toMatchObject({
      contextWindow: 200_000,
      reasoning: { control: 'always' },
      sources: { reasoning: 'user', contextWindow: 'user' },
      inherited: {
        contextWindow: 400_000,
        reasoning: { control: 'effort' },
        effortLevels: ['low', 'medium', 'high'],
        sources: { reasoning: 'modelsDev', contextWindow: 'modelsDev' },
      },
    })
  })

  test('is undefined for an official Anthropic provider', () => {
    expect(buildResolvedModelsView({ baseUrl: 'https://api.anthropic.com', apiFormat: 'anthropic' }, ['claude-opus-4-7'])).toBeUndefined()
  })
})

describe('isOfficialAnthropicProvider', () => {
  test('needs the anthropic format on an official host', () => {
    expect(isOfficialAnthropicProvider({ baseUrl: 'https://api.anthropic.com', apiFormat: 'anthropic' })).toBe(true)
    expect(isOfficialAnthropicProvider({ baseUrl: 'https://api.anthropic.com/v1', apiFormat: 'openai_chat' })).toBe(false)
    expect(isOfficialAnthropicProvider({ baseUrl: 'https://api.deepseek.com/anthropic', apiFormat: 'anthropic' })).toBe(false)
  })
})
