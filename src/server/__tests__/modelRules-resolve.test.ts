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
import { buildModelsDevIndex, type ModelsDevModel } from '../services/modelsDev/catalog.js'
import { catalogModel, useTestModelsDevCatalog } from './fixtures/modelsDevCatalog.js'

useTestModelsDevCatalog()

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
    { match: { modelPrefix: 'gpt-5' }, source, rules: { contextWindow: 400_000, reasoning: { control: 'effort', levels: ['high'] } } },
    { match: { modelPrefix: 'gpt-5.2' }, source, rules: { contextWindow: 410_000 } },
    { match: { modelPrefix: 'gpt-5.4' }, source, rules: { contextWindow: 1_050_000 } },
    { match: { modelPrefix: 'gpt-4.1' }, source, rules: { reasoning: { control: 'none' } } },
    { match: { modelPrefix: 'glm-4.5' }, source, rules: { contextWindow: 128_000, reasoning: { control: 'toggle' } } },
    { match: { modelPrefix: 'glm-4.6' }, source, rules: { reasoning: { control: 'toggle' } } },
    { match: { modelPrefix: 'glm-5' }, source, rules: { reasoning: { control: 'toggle' } } },
    { match: { modelPrefix: 'deepseek-v4-pro' }, source, rules: { contextWindow: 1_048_576 } },
    { match: { modelPrefix: 'qwen3.5-plus' }, source, rules: { contextWindow: 1_000_000 } },
    { match: { modelPrefix: 'claude-opus-4-7' }, source, rules: { contextWindow: 1_000_000 } },
  ],
  corrections: [],
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

const noCatalog = buildModelsDevIndex({})

function resolveLocal(provider: ModelRulesProvider, modelId: string): ResolvedModelRules {
  return resolveModelRulesFromTable(table, noCatalog, provider, modelId)
}

function provider(baseUrl: string, apiFormat: ModelRulesProvider['apiFormat'], extra: Partial<ModelRulesProvider> = {}): ModelRulesProvider {
  return { baseUrl, apiFormat, ...extra }
}

describe('layers', () => {
  test('the apiFormat layer overrides the fallback endpoint fields', () => {
    const rules = resolveLocal(provider('https://unknown.test/v1', 'openai_responses'), 'zeta')
    expect(rules.reasoningDialect).toBe('responses_reasoning')
    expect(rules.maxTokensField).toBe('max_output_tokens')
    expect(rules.contextWindow).toBe(131_072)
    expect(rules.sources.contextWindow).toBe('fallback')
  })

  test('the model layer overrides the fallback', () => {
    const rules = resolveLocal(provider('https://unknown.test/v1', 'openai_chat'), 'alpha')
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
    const rules = resolveLocal(provider('https://example.com/v1', 'openai_chat'), 'zeta')
    expect(rules.reasoningDialect).toBe('thinking_type')
    expect(rules.maxTokensField).toBe('max_completion_tokens')
  })

  test('the site prefix entry overrides the model layer', () => {
    const rules = resolveLocal(provider('https://example.com/v1', 'openai_chat'), 'alpha-2')
    expect(rules.contextWindow).toBe(300_000)
    expect(rules.sources.contextWindow).toBe('site')
    expect(rules.reasoningDialect).toBe('thinking_type')
  })

  test('discovered values override the site layer', () => {
    const rules = resolveLocal(
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
    const rules = resolveLocal(
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
    const rules = resolveLocal(
      provider('https://example.com/v1', 'openai_chat', {
        modelOverrides: { zeta: { reasoningDialect: 'enable_thinking', extraBody: { top_k: 20 } } },
      }),
      'zeta',
    )
    expect(rules.reasoningDialect).toBe('enable_thinking')
    expect(rules.extraBody).toEqual({ top_k: 20 })
  })
})

describe('models.dev and correction layers', () => {
  const layered: ModelRulesTable = {
    ...table,
    sites: [
      ...table.sites,
      { match: { host: 'example.com', apiFormat: 'openai_chat', modelPrefix: 'corrected' }, source, rules: { reasoning: { control: 'none' } } },
    ],
    models: [
      { match: { modelPrefix: 'layered' }, source, rules: { contextWindow: 100_000, maxOutputTokens: 10_000, reasoning: { control: 'none' }, structuredOutput: true } },
      { match: { modelPrefix: 'claude-x' }, source, rules: { reasoningDialect: 'anthropic_adaptive', nativeWebSearch: true } },
    ],
    corrections: [
      {
        match: { modelId: 'corrected' },
        source: { url: 'https://example.com/vendor-docs', modelsDevPr: '', checkedAt: '2026-11-20' },
        rules: { reasoning: { control: 'toggle_effort', levels: ['low', 'high'] } },
      },
    ],
  }
  const catalog = buildModelsDevIndex({
    openai: {
      api: 'https://api.openai.com/v1',
      models: {
        layered: { ...catalogModel(200_000, 20_000, { effort: ['low', 'high'] }, ['text', 'image', 'pdf']), structured_output: false } as ModelsDevModel,
        corrected: catalogModel(300_000, 30_000, { effort: ['low', 'high'] }, ['text']),
        'corrected-20260101': catalogModel(300_000, 30_000, { effort: ['low', 'high'] }, ['text']),
        'corrected-mini': catalogModel(300_000, 30_000, { effort: ['low', 'high'] }, ['text']),
        'corrected-pro': catalogModel(400_000, 40_000, { effort: ['low', 'high'] }, ['text']),
        'claude-x': catalogModel(400_000, 40_000, 'toggle'),
        alpha: catalogModel(500_000, 50_000, 'always'),
        'dotted-v3': catalogModel(600_000, 60_000, 'always'),
      },
    },
  })
  const resolve = (baseUrl: string, apiFormat: ModelRulesProvider['apiFormat'], modelId: string, extra: Partial<ModelRulesProvider> = {}) =>
    resolveModelRulesFromTable(layered, catalog, provider(baseUrl, apiFormat, extra), modelId)

  test('models.dev overrides our model entry and marks its fields', () => {
    const rules = resolve('https://relay.test/v1', 'openai_chat', 'layered')
    expect(rules.contextWindow).toBe(200_000)
    expect(rules.maxOutputTokens).toBe(20_000)
    expect(rules.reasoning).toEqual({ control: 'effort', levels: ['low', 'high'] })
    expect(rules.input).toEqual({ image: true, pdf: true })
    expect(rules.usedFallback).toBe(false)
    const { structuredOutput, ...fromModelsDev } = rules.sources
    expect(Object.values(fromModelsDev).every(value => value === 'modelsDev')).toBe(true)
  })

  test('structured output comes from our table, never from models.dev', () => {
    const rules = resolve('https://relay.test/v1', 'openai_chat', 'layered')
    expect(rules.structuredOutput).toBe(true)
    expect(rules.sources.structuredOutput).toBe('model')
  })

  test('models.dev sets no endpoint fields, so a model entry dialect still applies', () => {
    const rules = resolve('https://relay.test', 'anthropic', 'claude-x')
    expect(rules.reasoningDialect).toBe('anthropic_adaptive')
    expect(rules.nativeWebSearch).toBe(true)
    expect(rules.reasoning).toEqual({ control: 'toggle', levels: [] })
    expect(rules.sources.reasoning).toBe('modelsDev')
  })

  test('a correction follows the models.dev model a suffixed id falls back to', () => {
    const suffixed = resolve('https://relay.test/v1', 'openai_chat', 'corrected-thinking')
    expect(suffixed.reasoning.control).toBe('toggle_effort')
    expect(suffixed.contextWindow).toBe(300_000)
    const longer = resolve('https://relay.test/v1', 'openai_chat', 'corrected-pro-thinking')
    expect(longer.reasoning.control).toBe('effort')
    expect(longer.contextWindow).toBe(400_000)
  })

  test('a dotted version does not fall back to the models.dev model without it', () => {
    expect(resolve('https://relay.test/v1', 'openai_chat', 'dotted-v3-thinking').sources.contextWindow).toBe('modelsDev')
    expect(resolve('https://relay.test/v1', 'openai_chat', 'dotted-v3.2').sources.contextWindow).toBe('fallback')
  })

  test('a correction matches the id with or without a date suffix, but not a longer name', () => {
    expect(resolve('https://relay.test/v1', 'openai_chat', 'Corrected-20260101').reasoning.control).toBe('toggle_effort')
    expect(resolve('https://relay.test/v1', 'openai_chat', 'vendor/corrected').reasoning.control).toBe('toggle_effort')
    expect(resolve('https://relay.test/v1', 'openai_chat', 'corrected-mini').reasoning.control).toBe('effort')
  })

  test('a correction overrides models.dev and shows as built-in', () => {
    const rules = resolve('https://relay.test/v1', 'openai_chat', 'corrected')
    expect(rules.reasoning).toEqual({ control: 'toggle_effort', levels: ['low', 'high'] })
    expect(rules.sources.reasoning).toBe('model')
    expect(rules.contextWindow).toBe(300_000)
    expect(rules.sources.contextWindow).toBe('modelsDev')
  })

  test('a site prefix entry overrides a correction', () => {
    const rules = resolve('https://example.com/v1', 'openai_chat', 'corrected')
    expect(rules.reasoning).toEqual({ control: 'none', levels: [] })
    expect(rules.sources.reasoning).toBe('site')
  })

  test('a site prefix entry, discovered values and user overrides override models.dev', () => {
    const site = resolve('https://example.com/v1', 'openai_chat', 'alpha')
    expect(site.contextWindow).toBe(300_000)
    expect(site.sources.contextWindow).toBe('site')
    expect(site.sources.reasoning).toBe('modelsDev')
    const discovered = resolve('https://relay.test/v1', 'openai_chat', 'layered', { discoveredModels: { layered: { maxOutputTokens: 25_000, image: false } } })
    expect(discovered.maxOutputTokens).toBe(25_000)
    expect(discovered.sources.maxOutputTokens).toBe('discovered')
    expect(discovered.input.image).toBe(true)
    const user = resolve('https://relay.test/v1', 'openai_chat', 'layered', { modelOverrides: { layered: { reasoningLevels: 'off' } } })
    expect(user.reasoning).toEqual({ control: 'none', levels: [] })
    expect(user.sources.reasoning).toBe('user')
  })
})

describe('model layer dialect', () => {
  test('applies when it fits the apiFormat', () => {
    const rules = resolveLocal(provider('https://unknown.test', 'anthropic'), 'm-native')
    expect(rules.reasoningDialect).toBe('anthropic_adaptive')
  })

  test('is ignored when it does not fit the apiFormat', () => {
    const rules = resolveLocal(provider('https://unknown.test/v1', 'openai_chat'), 'm-native')
    expect(rules.reasoningDialect).toBe('reasoning_effort')
  })

  test('gives way to a site entry', () => {
    const rules = resolveLocal(provider('https://example.com', 'anthropic'), 'm-native')
    expect(rules.reasoningDialect).toBe('anthropic_disable_only')
  })
})

describe('model matching', () => {
  const chat = provider('https://unknown.test/v1', 'openai_chat')

  test('takes the longest prefix', () => {
    expect(resolveLocal(chat, 'gpt-5.4-mini').contextWindow).toBe(1_050_000)
    expect(resolveLocal(chat, 'gpt-5-mini').contextWindow).toBe(400_000)
  })

  test('lets a family prefix cover dotted versions', () => {
    expect(resolveLocal(chat, 'gpt-5.3').contextWindow).toBe(400_000)
  })

  test('strips one vendor segment', () => {
    expect(resolveLocal(chat, 'deepseek/deepseek-v4-pro').contextWindow).toBe(1_048_576)
    expect(resolveLocal(chat, 'a/deepseek/deepseek-v4-pro').usedFallback).toBe(true)
  })

  test('drops the context suffix and treats dots and dashes alike', () => {
    expect(resolveLocal(chat, 'claude-opus-4-7[1m]').sources.contextWindow).toBe('model')
    expect(resolveLocal(chat, 'anthropic/claude-opus-4.7').contextWindow).toBe(1_000_000)
    expect(resolveLocal(chat, 'qwen3-5-plus').contextWindow).toBe(1_000_000)
    expect(resolveLocal(chat, 'Qwen3.5-Plus').contextWindow).toBe(1_000_000)
  })

  test('a prefix must end on a boundary', () => {
    const snapshot = resolveLocal(chat, 'gpt-5-2025-08-07')
    expect(snapshot.reasoning.control).toBe('effort')
    expect(snapshot.contextWindow).toBe(400_000)
    expect(resolveLocal(chat, 'gpt-4-1106-preview').usedFallback).toBe(true)
    for (const id of ['glm-4.5v', 'glm-4.6v', 'glm-5v-turbo']) {
      expect(resolveLocal(chat, id).usedFallback).toBe(true)
    }
    expect(resolveLocal(chat, 'glm-4.5-air').contextWindow).toBe(128_000)
  })
})

describe('site matching', () => {
  test('stacks the prefix entry on the host entry', () => {
    const rules = resolveModelRules(provider('https://open.bigmodel.cn/api/paas/v4', 'openai_chat'), 'glm-5.1')
    expect(rules.reasoningDialect).toBe('thinking_type')
    expect(rules.extraBody).toEqual({ thinking: { clear_thinking: false } })
    expect(rules.reasoning.control).toBe('toggle')
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
    const rules = resolveLocal(
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

  test('do not replace a models.dev value', () => {
    const rules = resolveModelRules(chat, 'gpt-4.1')
    expect(rules.input).toEqual({ image: true, pdf: true })
    expect(rules.sources.image).toBe('modelsDev')
  })
})

describe('discovered values saved before models.dev', () => {
  test('ignore the reasoning and dialect that OpenRouter discovery used to store', () => {
    const discoveredModels = {
      'vendor/other': { contextWindow: 300_000, reasoning: { control: 'toggle_effort', levels: ['high'] }, reasoningDialect: 'thinking_type' },
    } as unknown as ModelRulesProvider['discoveredModels']
    const rules = resolveModelRules(provider('https://unknown.test/v1', 'openai_chat', { discoveredModels }), 'vendor/other')
    expect(rules.contextWindow).toBe(300_000)
    expect(rules.reasoning).toEqual({ control: 'none', levels: [] })
    expect(rules.reasoningDialect).toBe('reasoning_effort')
    expect(rules.usedFallback).toBe(true)
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
