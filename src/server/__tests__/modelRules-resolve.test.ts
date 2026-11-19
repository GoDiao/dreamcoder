import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'

import {
  resolveFallbackModelRules,
  resolveModelRules,
  resolveModelRulesFromTable,
  type ModelRulesProvider,
} from '../services/modelRules/resolveModelRules.js'
import { BUILTIN_MODEL_RULES } from '../services/modelRules/builtinModelRules.js'
import type { ModelOverride, ResolvedModelRules } from '../types/modelRules.js'
import type { ModelRulesTable, RuleSource } from '../types/modelRulesTable.js'

const source: RuleSource = { url: 'https://example.com/docs', checkedAt: '2026-11-19', status: 'verified' }

const table: ModelRulesTable = {
  fallback: BUILTIN_MODEL_RULES.fallback,
  formats: BUILTIN_MODEL_RULES.formats,
  models: [
    {
      match: { modelPrefix: 'alpha' },
      source,
      rules: {
        contextWindow: 200_000,
        maxOutputTokens: 20_000,
        reasoning: { control: 'toggle' },
        input: { image: false },
        structuredOutput: true,
      },
    },
    { match: { modelPrefix: 'm-none' }, source, rules: { reasoning: { control: 'none' } } },
    { match: { modelPrefix: 'm-toggle' }, source, rules: { reasoning: { control: 'toggle' } } },
    { match: { modelPrefix: 'm-effort' }, source, rules: { reasoning: { control: 'effort', levels: ['high'] } } },
    { match: { modelPrefix: 'm-te' }, source, rules: { reasoning: { control: 'toggle_effort', levels: ['low', 'high'] } } },
    { match: { modelPrefix: 'm-always' }, source, rules: { reasoning: { control: 'always', levels: ['high'] } } },
    { match: { modelPrefix: 'm-native' }, source, rules: { reasoningDialect: 'anthropic_adaptive' } },
  ],
  sites: [
    {
      match: { host: 'example.com', apiFormat: 'openai_chat' },
      source,
      rules: { reasoningDialect: 'thinking_type', maxTokensField: 'max_completion_tokens' },
    },
    {
      match: { host: 'example.com', apiFormat: 'anthropic' },
      source,
      rules: { reasoningDialect: 'anthropic_disable_only' },
    },
    {
      match: { host: 'example.com', apiFormat: 'openai_chat', modelPrefix: 'alpha' },
      source,
      rules: { contextWindow: 300_000 },
    },
  ],
}

function provider(baseUrl: string, apiFormat: ModelRulesProvider['apiFormat'], extra: Partial<ModelRulesProvider> = {}): ModelRulesProvider {
  return { baseUrl, apiFormat, ...extra }
}

describe('layers', () => {
  test('the apiFormat layer overrides the fallback endpoint fields', () => {
    const rules = resolveModelRulesFromTable(table, provider('https://unknown.test/v1', 'openai_responses'), 'zeta')
    expect(rules.reasoningDialect).toBe('responses_reasoning')
    expect(rules.maxTokensField).toBe('max_output_tokens')
    expect(rules.contextWindow).toBe(131_072)
    expect(rules.sources.contextWindow).toBe('fallback')
  })

  test('the model layer overrides the fallback', () => {
    const rules = resolveModelRulesFromTable(table, provider('https://unknown.test/v1', 'openai_chat'), 'alpha')
    expect(rules.contextWindow).toBe(200_000)
    expect(rules.input.image).toBe(false)
    expect(rules.input.pdf).toBe(false)
    expect(rules.sources).toEqual({
      contextWindow: 'model',
      maxOutputTokens: 'model',
      reasoning: 'model',
      image: 'model',
      pdf: 'fallback',
      structuredOutput: 'model',
    })
  })

  test('the site host entry overrides the apiFormat layer', () => {
    const rules = resolveModelRulesFromTable(table, provider('https://example.com/v1', 'openai_chat'), 'zeta')
    expect(rules.reasoningDialect).toBe('thinking_type')
    expect(rules.maxTokensField).toBe('max_completion_tokens')
  })

  test('the site prefix entry overrides the model layer', () => {
    const rules = resolveModelRulesFromTable(table, provider('https://example.com/v1', 'openai_chat'), 'alpha-2')
    expect(rules.contextWindow).toBe(300_000)
    expect(rules.sources.contextWindow).toBe('site')
    expect(rules.reasoningDialect).toBe('thinking_type')
  })

  test('discovered values override the site layer', () => {
    const rules = resolveModelRulesFromTable(
      table,
      provider('https://example.com/v1', 'openai_chat', {
        discoveredModels: { 'alpha-2': { contextWindow: 400_000, maxOutputTokens: 40_000 } },
      }),
      'alpha-2',
    )
    expect(rules.contextWindow).toBe(400_000)
    expect(rules.maxOutputTokens).toBe(40_000)
    expect(rules.sources.contextWindow).toBe('discovered')
    expect(rules.sources.maxOutputTokens).toBe('discovered')
  })

  test('user overrides override discovered values', () => {
    const rules = resolveModelRulesFromTable(
      table,
      provider('https://example.com/v1', 'openai_chat', {
        discoveredModels: { 'alpha-2': { contextWindow: 400_000 } },
        modelOverrides: { 'alpha-2': { contextWindow: 500_000, maxOutputTokens: 50_000, image: true, pdf: true } },
      }),
      'alpha-2',
    )
    expect(rules.contextWindow).toBe(500_000)
    expect(rules.maxOutputTokens).toBe(50_000)
    expect(rules.input).toEqual({ image: true, pdf: true })
    expect(rules.sources.contextWindow).toBe('user')
    expect(rules.sources.image).toBe('user')
    expect(rules.sources.pdf).toBe('user')
  })

  test('user extraBody and a matching dialect apply', () => {
    const rules = resolveModelRulesFromTable(
      table,
      provider('https://example.com/v1', 'openai_chat', {
        modelOverrides: { zeta: { reasoningDialect: 'enable_thinking', extraBody: { top_k: 20 } } },
      }),
      'zeta',
    )
    expect(rules.reasoningDialect).toBe('enable_thinking')
    expect(rules.extraBody).toEqual({ top_k: 20 })
  })
})

describe('model layer dialect', () => {
  test('applies when it fits the apiFormat', () => {
    const rules = resolveModelRulesFromTable(table, provider('https://unknown.test', 'anthropic'), 'm-native')
    expect(rules.reasoningDialect).toBe('anthropic_adaptive')
  })

  test('is ignored when it does not fit the apiFormat', () => {
    const rules = resolveModelRulesFromTable(table, provider('https://unknown.test/v1', 'openai_chat'), 'm-native')
    expect(rules.reasoningDialect).toBe('reasoning_effort')
  })

  test('gives way to a site entry', () => {
    const rules = resolveModelRulesFromTable(table, provider('https://example.com', 'anthropic'), 'm-native')
    expect(rules.reasoningDialect).toBe('anthropic_disable_only')
  })
})

describe('model matching', () => {
  const chat = provider('https://unknown.test/v1', 'openai_chat')

  test('takes the longest prefix', () => {
    expect(resolveModelRules(chat, 'gpt-5.4-mini').contextWindow).toBe(1_050_000)
    expect(resolveModelRules(chat, 'gpt-5-mini').contextWindow).toBe(400_000)
  })

  test('strips one vendor segment', () => {
    expect(resolveModelRules(chat, 'deepseek/deepseek-v4-pro').contextWindow).toBe(1_048_576)
    expect(resolveModelRules(chat, 'a/deepseek/deepseek-v4-pro').usedFallback).toBe(true)
  })

  test('drops the context suffix and treats dots and dashes alike', () => {
    expect(resolveModelRules(chat, 'claude-opus-4-7[1m]').sources.contextWindow).toBe('model')
    expect(resolveModelRules(chat, 'anthropic/claude-opus-4.7').contextWindow).toBe(1_000_000)
    expect(resolveModelRules(chat, 'qwen3-5-plus').contextWindow).toBe(1_000_000)
    expect(resolveModelRules(chat, 'Qwen3.5-Plus').contextWindow).toBe(1_000_000)
  })

  test('a prefix must end on a boundary', () => {
    const snapshot = resolveModelRules(chat, 'gpt-5-2025-08-07')
    expect(snapshot.reasoning.control).toBe('effort')
    expect(snapshot.sources.reasoning).toBe('model')
    expect(resolveModelRules(chat, 'gpt-4-1106-preview').usedFallback).toBe(true)
    for (const id of ['glm-4.5v', 'glm-4.6v', 'glm-5v-turbo']) {
      expect(resolveModelRules(chat, id).usedFallback).toBe(true)
    }
    expect(resolveModelRules(chat, 'glm-4.5-air').contextWindow).toBe(128_000)
  })
})

describe('site matching', () => {
  test('stacks the prefix entry on the host entry', () => {
    const rules = resolveModelRules(provider('https://open.bigmodel.cn/api/paas/v4', 'openai_chat'), 'glm-5.1')
    expect(rules.reasoningDialect).toBe('thinking_type')
    expect(rules.extraBody).toEqual({ thinking: { clear_thinking: false } })
    expect(rules.reasoning.control).toBe('toggle_effort')
  })

  test('the prefix entry also strips one vendor segment', () => {
    const rules = resolveModelRules(provider('https://api.moonshot.ai/v1', 'openai_chat'), 'moonshotai/kimi-k3')
    expect(rules.reasoningDialect).toBe('reasoning_effort')
  })

  test('picks the entry for the provider apiFormat on a shared host', () => {
    expect(resolveModelRules(provider('https://api.deepseek.com', 'openai_chat'), 'deepseek-v4-pro').reasoningDialect).toBe('thinking_type')
    expect(resolveModelRules(provider('https://api.deepseek.com/anthropic', 'anthropic'), 'deepseek-v4-pro').reasoningDialect).toBe('anthropic_adaptive')
  })

  test('matches host suffixes on a dot boundary, ignoring case and port', () => {
    expect(resolveModelRules(provider('https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'openai_chat'), 'qwen-plus').reasoningDialect).toBe('enable_thinking')
    expect(resolveModelRules(provider('https://evilopenrouter.ai/api/v1', 'openai_chat'), 'x').reasoningDialect).toBe('reasoning_effort')
    expect(resolveModelRules(provider('https://OpenRouter.ai:8443/api/v1', 'openai_chat'), 'x').reasoningDialect).toBe('openrouter')
  })

  test('an endpoint-only prefix entry keeps the fallback mark', () => {
    const rules = resolveModelRules(provider('https://open.bigmodel.cn/api/paas/v4', 'openai_chat'), 'glm-4-plus')
    expect(rules.extraBody).toEqual({ thinking: { clear_thinking: false } })
    expect(rules.usedFallback).toBe(true)
    expect(rules.sources.reasoning).toBe('fallback')
  })

  test('an unparsable base URL matches no site', () => {
    expect(resolveModelRules(provider('', 'openai_chat'), 'x').reasoningDialect).toBe('reasoning_effort')
  })
})

describe('reasoningLevels override', () => {
  const rows: Array<[string, ModelOverride['reasoningLevels'], ResolvedModelRules['reasoning']]> = [
    ['m-te', undefined, { control: 'toggle_effort', levels: ['low', 'high'] }],
    ['m-te', 'off', { control: 'none', levels: [] }],
    ['m-always', 'off', { control: 'none', levels: [] }],
    ['m-none', ['low', 'max'], { control: 'toggle_effort', levels: ['low', 'max'] }],
    ['m-toggle', ['high'], { control: 'toggle_effort', levels: ['high'] }],
    ['m-effort', ['low'], { control: 'effort', levels: ['low'] }],
    ['m-te', ['max'], { control: 'toggle_effort', levels: ['max'] }],
    ['m-always', ['medium'], { control: 'always', levels: ['medium'] }],
    ['m-none', [], { control: 'toggle', levels: [] }],
    ['m-toggle', [], { control: 'toggle', levels: [] }],
    ['m-te', [], { control: 'toggle', levels: [] }],
    ['m-effort', [], { control: 'always', levels: [] }],
    ['m-always', [], { control: 'always', levels: [] }],
  ]

  test.each(rows)('%s with %p', (model, reasoningLevels, expected) => {
    const rules = resolveModelRulesFromTable(
      table,
      provider('https://unknown.test/v1', 'openai_chat', { modelOverrides: { [model]: { reasoningLevels } } }),
      model,
    )
    expect(rules.reasoning).toEqual(expected)
    expect(rules.sources.reasoning).toBe(reasoningLevels === undefined ? 'model' : 'user')
  })

  test('levels on the fallback none model clear the fallback mark', () => {
    const rules = resolveModelRules(
      provider('https://unknown.test/v1', 'openai_chat', { modelOverrides: { zeta: { reasoningLevels: ['high'] } } }),
      'zeta',
    )
    expect(rules.reasoning).toEqual({ control: 'toggle_effort', levels: ['high'] })
    expect(rules.usedFallback).toBe(false)
  })
})

describe('discovered modalities', () => {
  const chat = provider('https://unknown.test/v1', 'openai_chat', {
    discoveredModels: {
      zeta: { image: false, pdf: true },
      'gpt-4.1': { image: false, pdf: false },
    },
  })

  test('apply when the lower layers are the fallback', () => {
    const rules = resolveModelRules(chat, 'zeta')
    expect(rules.input).toEqual({ image: false, pdf: true })
    expect(rules.sources.image).toBe('discovered')
    expect(rules.sources.pdf).toBe('discovered')
  })

  test('do not replace a table value', () => {
    const rules = resolveModelRules(chat, 'gpt-4.1')
    expect(rules.input).toEqual({ image: true, pdf: true })
    expect(rules.sources.image).toBe('model')
  })
})

describe('discovered reasoning', () => {
  const discoveredModels = {
    'nvidia/nemotron-3-ultra-550b-a55b': { reasoning: { control: 'toggle_effort' as const, levels: ['medium' as const, 'high' as const] }, reasoningDialect: 'anthropic_adaptive' as const },
    'anthropic/claude-opus-4.5': { reasoning: { control: 'toggle_effort' as const, levels: ['low' as const, 'medium' as const, 'high' as const, 'max' as const] }, reasoningDialect: 'anthropic_adaptive' as const },
  }

  test('gives a model without a table entry its levels on OpenRouter chat and keeps the site dialect', () => {
    const rules = resolveModelRules(provider('https://openrouter.ai/api/v1', 'openai_chat', { discoveredModels }), 'nvidia/nemotron-3-ultra-550b-a55b')
    expect(rules.reasoning).toEqual({ control: 'toggle_effort', levels: ['medium', 'high'] })
    expect(rules.sources.reasoning).toBe('discovered')
    expect(rules.reasoningDialect).toBe('openrouter')
  })

  test('uses adaptive thinking with effort on the OpenRouter Messages endpoint', () => {
    const rules = resolveModelRules(provider('https://openrouter.ai/api', 'anthropic', { discoveredModels }), 'nvidia/nemotron-3-ultra-550b-a55b')
    expect(rules.reasoning).toEqual({ control: 'toggle_effort', levels: ['medium', 'high'] })
    expect(rules.reasoningDialect).toBe('anthropic_adaptive')
  })

  test('does not replace a table entry', () => {
    const rules = resolveModelRules(provider('https://openrouter.ai/api', 'anthropic', { discoveredModels }), 'anthropic/claude-opus-4.5')
    expect(rules.reasoning).toEqual({ control: 'toggle', levels: [] })
    expect(rules.sources.reasoning).toBe('model')
    expect(rules.reasoningDialect).toBe('anthropic_budget')
  })
})

describe('override and discovered keys', () => {
  test('match after normalization', () => {
    const rules = resolveModelRules(
      provider('https://unknown.test/v1', 'openai_chat', { modelOverrides: { 'Zeta.1[1m]': { contextWindow: 64_000 } } }),
      'zeta-1',
    )
    expect(rules.contextWindow).toBe(64_000)
  })

  test('the first of two keys that normalize alike wins', () => {
    const rules = resolveModelRules(
      provider('https://unknown.test/v1', 'openai_chat', {
        modelOverrides: { 'GLM-5.1': { contextWindow: 100_000 }, 'glm-5-1': { contextWindow: 150_000 } },
      }),
      'glm-5.1',
    )
    expect(rules.contextWindow).toBe(100_000)
    const discovered = resolveModelRules(
      provider('https://unknown.test/v1', 'openai_chat', {
        discoveredModels: { 'zeta.2': { contextWindow: 70_000 }, 'ZETA-2': { contextWindow: 80_000 } },
      }),
      'zeta-2',
    )
    expect(discovered.contextWindow).toBe(70_000)
  })
})

describe('override dialect compatibility', () => {
  let warn: Mock<typeof console.warn>

  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  test('drops a dialect that does not fit the apiFormat and logs it', () => {
    const rules = resolveModelRules(
      provider('https://api.deepseek.com/anthropic', 'anthropic', {
        modelOverrides: { 'deepseek-v4-pro': { reasoningDialect: 'thinking_type', contextWindow: 500_000 } },
      }),
      'deepseek-v4-pro',
    )
    expect(rules.reasoningDialect).toBe('anthropic_adaptive')
    expect(rules.contextWindow).toBe(500_000)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('api.deepseek.com')
    expect(message).toContain('deepseek-v4-pro')
    expect(message).toContain('reasoningDialect')
  })

  test('keeps a dialect that fits', () => {
    const rules = resolveModelRules(
      provider('https://api.deepseek.com/anthropic', 'anthropic', {
        modelOverrides: { 'deepseek-v4-pro': { reasoningDialect: 'anthropic_budget' } },
      }),
      'deepseek-v4-pro',
    )
    expect(rules.reasoningDialect).toBe('anthropic_budget')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('resolveFallbackModelRules', () => {
  test('applies the fallback, the apiFormat layer and the site host entry only', () => {
    const rules = resolveFallbackModelRules(
      provider('https://openrouter.ai/api/v1', 'openai_chat', {
        modelOverrides: { zeta: { contextWindow: 64_000 } },
      }),
    )
    expect(rules.reasoningDialect).toBe('openrouter')
    expect(rules.contextWindow).toBe(131_072)
    expect(rules.reasoning).toEqual({ control: 'none', levels: [] })
    expect(rules.usedFallback).toBe(true)
    expect(Object.values(rules.sources).every(value => value === 'fallback')).toBe(true)
  })

  test('uses the site host entry of an anthropic endpoint', () => {
    expect(resolveFallbackModelRules(provider('https://api.kimi.com/coding', 'anthropic')).reasoningDialect).toBe('anthropic_disable_only')
  })
})
