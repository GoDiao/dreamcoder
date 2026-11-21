import { describe, expect, test } from 'bun:test'

import {
  buildModelsDevIndex,
  lookupModelsDevModel,
  parseModelsDevCatalog,
  parseModelsDevData,
  serializeModelsDevSnapshot,
  type ModelsDevCatalog,
  type ModelsDevModel,
} from '../services/modelsDev/catalog.js'
import { modelsDevRuleFields } from '../services/modelsDev/ruleFields.js'

function tagged(tag: number): ModelsDevModel {
  return { limit: { context: 100_000 + tag, output: tag } }
}

function found(catalog: ModelsDevCatalog, baseUrl: string, modelId: string): number | undefined {
  return lookupModelsDevModel(buildModelsDevIndex(catalog), baseUrl, modelId)?.model.limit?.output
}

describe('parseModelsDevCatalog', () => {
  test('keeps only the fields the rules read', () => {
    const catalog = parseModelsDevCatalog({
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek',
        env: ['DEEPSEEK_API_KEY'],
        api: 'https://api.deepseek.com',
        models: {
          'deepseek-v4-pro': {
            id: 'deepseek-v4-pro',
            name: 'DeepSeek V4 Pro',
            cost: { input: 1 },
            limit: { context: 1_048_576, output: 393_216, input: 900_000 },
            reasoning: true,
            reasoning_options: [{ type: 'budget_tokens', min: 1024 }],
            modalities: { input: ['text'], output: ['text'] },
            structured_output: null,
            tool_call: true,
            provider: { npm: '@ai-sdk/deepseek', api: 'https://api.deepseek.com/v1' },
          },
          'deepseek-chat': { id: 'deepseek-chat', provider: { npm: '@ai-sdk/deepseek' } },
        },
      },
    })
    expect(catalog).toEqual({
      deepseek: {
        api: 'https://api.deepseek.com',
        models: {
          'deepseek-v4-pro': {
            limit: { context: 1_048_576, output: 393_216 },
            reasoning: true,
            reasoning_options: [{ type: 'budget_tokens' }],
            modalities: { input: ['text'] },
            provider: { api: 'https://api.deepseek.com/v1' },
          },
          'deepseek-chat': {},
        },
      },
    })
  })

  test('skips a model or provider that does not parse and keeps the rest', () => {
    const catalog = parseModelsDevCatalog({
      good: { models: { ok: { reasoning: false }, broken: { limit: { context: 'big' } } } },
      bad: { api: 'https://bad.test' },
    })
    expect(catalog).toEqual({ good: { models: { ok: { reasoning: false } } } })
  })

  test('rejects a catalog with no providers', () => {
    expect(() => parseModelsDevCatalog({})).toThrow('no providers')
    expect(() => parseModelsDevCatalog([])).toThrow()
  })

  test('a written snapshot reads back the same and puts each model on its own line', () => {
    const catalog: ModelsDevCatalog = {
      a: { api: 'https://a.test/v1', models: { m1: tagged(1), m2: tagged(2) } },
      b: { models: { m3: tagged(3) } },
    }
    const text = serializeModelsDevSnapshot({ fetchedAt: '2026-11-20T00:00:00.000Z', catalog })
    expect(parseModelsDevData(JSON.parse(text))).toEqual({ fetchedAt: '2026-11-20T00:00:00.000Z', catalog })
    const lines = text.split('\n')
    expect(lines.filter(line => line.startsWith('"m'))).toHaveLength(3)
  })
})

describe('lookupModelsDevModel ids', () => {
  const catalog: ModelsDevCatalog = {
    anthropic: {
      api: 'https://api.anthropic.com/v1',
      models: {
        'claude-opus-4-5': tagged(1),
        'claude-opus-4-5-20251101': tagged(2),
        'claude-sonnet-4-5': tagged(3),
        'MiniMax-M3': tagged(4),
        'gpt-5.4': tagged(5),
        'model-0528': tagged(6),
        'deepseek-v3': tagged(7),
      },
    },
  }

  test('ignores case, treats dots and dashes alike and drops the context suffix', () => {
    expect(found(catalog, '', 'minimax-m3')).toBe(4)
    expect(found(catalog, '', 'gpt-5-4')).toBe(5)
    expect(found(catalog, '', 'claude-sonnet-4-5[1m]')).toBe(3)
  })

  test('falls back to the id without a date suffix and prefers the exact id', () => {
    expect(found(catalog, '', 'claude-opus-4-5-20251101')).toBe(2)
    expect(found(catalog, '', 'claude-sonnet-4-5-20250929')).toBe(3)
    expect(found(catalog, '', 'claude-sonnet-4-5@20250929')).toBe(3)
    expect(found(catalog, '', 'claude-sonnet-4-5-2025-09-29')).toBe(3)
    expect(found(catalog, '', 'model')).toBeUndefined()
    expect(found(catalog, '', 'model-0528')).toBe(6)
  })

  test('falls back to the longest models.dev id that ends at a separator', () => {
    expect(found(catalog, '', 'claude-sonnet-4-5-thinking')).toBe(3)
    expect(found(catalog, '', 'claude-opus-4-5-20251101-thinking')).toBe(2)
    expect(found(catalog, '', 'anthropic/claude-sonnet-4.5-thinking')).toBe(3)
    expect(found(catalog, '', 'claude-sonnet-4-5-0929')).toBe(3)
    expect(found(catalog, '', 'claude-sonnet-4-5x')).toBeUndefined()
    expect(found(catalog, '', 'claude-opus')).toBeUndefined()
  })

  test('does not split a dotted version number', () => {
    expect(found(catalog, '', 'deepseek-v3.2')).toBeUndefined()
    expect(found(catalog, '', 'deepseek-v3.2-thinking')).toBeUndefined()
    expect(found(catalog, '', 'deepseek-v3-0324')).toBe(7)
    expect(found(catalog, '', 'deepseek-v3-thinking')).toBe(7)
  })

  test('reports the matched id', () => {
    const index = buildModelsDevIndex(catalog)
    expect(lookupModelsDevModel(index, '', 'Claude-Sonnet-4.5-Thinking')?.id).toBe('claude-sonnet-4-5')
    expect(lookupModelsDevModel(index, '', 'claude-sonnet-4-5-20250929')?.id).toBe('claude-sonnet-4-5')
  })

  test('strips one vendor segment', () => {
    expect(found(catalog, '', 'anthropic/claude-sonnet-4.5')).toBe(3)
    expect(found(catalog, '', 'anthropic/claude-sonnet-4-5-20250929')).toBe(3)
    expect(found(catalog, '', 'a/b/claude-sonnet-4-5')).toBeUndefined()
  })
})

describe('lookupModelsDevModel providers', () => {
  const catalog: ModelsDevCatalog = {
    deepseek: { api: 'https://api.deepseek.com', models: { 'deepseek-v4-pro': tagged(1) } },
    openrouter: { api: 'https://openrouter.ai/api/v1', models: { 'deepseek/deepseek-v4-pro': tagged(2), 'vendor/only': tagged(3), 'deepseek-v4': tagged(17) } },
    'kimi-code': { api: 'https://api.kimi.com/coding/v1', models: { 'kimi-for-coding': tagged(4) } },
    zai: { api: 'https://api.z.ai/api/paas/v4', models: { 'glm-5.2': tagged(5) } },
    'zai-coding': { api: 'https://api.z.ai/api/coding/paas/v4', models: { 'glm-5.2': tagged(6) } },
    zhipuai: { api: 'https://open.bigmodel.cn/api/paas/v4', models: { 'glm-5.2': tagged(7) } },
    'zhipuai-coding': { api: 'https://open.bigmodel.cn/api/coding/paas/v4', models: { 'glm-5.2': tagged(8) } },
    'minimax-a': { api: 'https://api.minimax.io/anthropic/v1', models: { 'only-a': tagged(9) } },
    'minimax-b': { api: 'https://api.minimax.io/anthropic/v1', models: { 'only-b': tagged(10) } },
    mistral: { api: 'https://api.mistral.ai/v1', models: { 'glm-5-2': tagged(11) } },
    'alibaba-cn': { api: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: { 'glm-5.2': tagged(12), 'deepseek-v4-pro': tagged(13) } },
    templated: { api: 'https://${REGION}.example.test/v1', models: { 'only-templated': tagged(14) } },
    solo: { api: 'https://solo.test/v1', models: { 'solo-model': tagged(15) } },
    'model-level': { models: { 'via-model-url': { ...tagged(16), provider: { api: 'https://model-level.test/v2' } } } },
  }

  test('maps a base URL to the provider whose path is a prefix in either direction', () => {
    expect(found(catalog, 'https://api.deepseek.com/anthropic', 'deepseek-v4-pro')).toBe(1)
    expect(found(catalog, 'https://openrouter.ai/api', 'deepseek/deepseek-v4-pro')).toBe(2)
    expect(found(catalog, 'https://api.kimi.com/coding', 'kimi-for-coding')).toBe(4)
    expect(found(catalog, 'https://model-level.test/v2', 'via-model-url')).toBe(16)
  })

  test('picks the provider with the longest shared path on a shared host', () => {
    expect(found(catalog, 'https://api.z.ai/api/coding/paas/v4', 'glm-5.2')).toBe(6)
    expect(found(catalog, 'https://api.z.ai/api/paas/v4/', 'glm-5.2')).toBe(5)
  })

  test('takes no provider when a shared host has no compatible path, then uses the vendor list', () => {
    expect(found(catalog, 'https://open.bigmodel.cn/api/anthropic', 'glm-5.2')).toBe(5)
  })

  test('takes the only provider on a host even when the path differs', () => {
    expect(found(catalog, 'https://solo.test/other', 'solo-model')).toBe(15)
  })

  test('searches every provider that shares the same address', () => {
    expect(found(catalog, 'https://api.minimax.io/anthropic', 'only-a')).toBe(9)
    expect(found(catalog, 'https://api.minimax.io/anthropic', 'only-b')).toBe(10)
  })

  test('skips templated addresses', () => {
    expect(found(catalog, 'https://${REGION}.example.test/v1', 'only-templated')).toBeUndefined()
  })

  test('prefers an exact match in any provider over a prefix match', () => {
    expect(found(catalog, 'https://openrouter.ai/api/v1', 'deepseek-v4-pro')).toBe(1)
    expect(found(catalog, 'https://openrouter.ai/api/v1', 'deepseek/deepseek-v4-pro-thinking')).toBe(2)
    expect(found(catalog, 'https://openrouter.ai/api/v1', 'deepseek-v4-flash')).toBe(17)
  })

  test('continues with the vendor list when the mapped provider lacks the model, vendors first', () => {
    expect(found(catalog, 'https://relay.test/v1', 'glm-5.2')).toBe(5)
    expect(found(catalog, 'https://relay.test/v1', 'vendor/only')).toBeUndefined()
  })
})

describe('modelsDevRuleFields', () => {
  const thinking = (model: ModelsDevModel) => modelsDevRuleFields(model).reasoning

  test.each([
    ['no reasoning', { reasoning: false }, { control: 'none', levels: [] }],
    ['reasoning without options', { reasoning: true }, { control: 'always', levels: [] }],
    ['toggle', { reasoning: true, reasoning_options: [{ type: 'toggle' }] }, { control: 'toggle', levels: [] }],
    ['effort without none', { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }] }, { control: 'effort', levels: ['low', 'medium', 'high', 'max'] }],
    ['effort with none', { reasoning: true, reasoning_options: [{ type: 'effort', values: ['none', 'minimal', 'high'] }] }, { control: 'toggle_effort', levels: ['high'] }],
    ['effort and toggle', { reasoning: true, reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high'] }] }, { control: 'toggle_effort', levels: ['low', 'high'] }],
    ['budget only', { reasoning: true, reasoning_options: [{ type: 'budget_tokens' }] }, { control: 'always', levels: [] }],
    ['budget and toggle', { reasoning: true, reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens' }] }, { control: 'toggle', levels: [] }],
    ['budget and effort', { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }, { type: 'budget_tokens' }] }, { control: 'effort', levels: ['low', 'high'] }],
    ['effort with only unknown levels', { reasoning: true, reasoning_options: [{ type: 'effort', values: ['xhigh'] }] }, { control: 'always', levels: [] }],
  ] as const)('%s', (_name, model, expected) => {
    expect(thinking(model as ModelsDevModel)).toEqual(expected)
  })

  test('sets no reasoning when models.dev does not say', () => {
    expect(thinking({})).toBeUndefined()
  })

  test('maps limits and modalities, and never structured output', () => {
    const model = { limit: { context: 200_000, output: 64_000 }, modalities: { input: ['text', 'image'] }, structured_output: true } as ModelsDevModel
    expect(modelsDevRuleFields(model)).toEqual({
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      input: { image: true, pdf: false },
    })
  })

  test('leaves out values outside the rules range and fields models.dev leaves empty', () => {
    expect(modelsDevRuleFields({ limit: { context: 8_000, output: 0 } })).toEqual({})
    expect(modelsDevRuleFields({ limit: { context: 20_000_000, output: 1.5 } })).toEqual({})
  })
})
