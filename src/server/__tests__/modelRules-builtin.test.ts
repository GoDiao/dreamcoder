import { describe, expect, test } from 'bun:test'

import modelRulesJson from '../config/modelRules.json'
import { BUILTIN_MODEL_RULES } from '../services/modelRules/builtinModelRules.js'
import { resolveModelRulesFromTable } from '../services/modelRules/resolveModelRules.js'
import { dialectFitsFormat, type ModelRuleFields } from '../types/modelRules.js'
import { ModelRulesTableSchema } from '../types/modelRulesTable.js'
import { ApiFormatSchema } from '../types/provider.js'
import { buildModelsDevIndex, lookupModelsDevModel, VENDOR_PROVIDER_IDS } from '../services/modelsDev/catalog.js'
import { bundledModelsDevData } from '../services/modelsDev/modelsDevStore.js'
import { modelsDevRuleFields } from '../services/modelsDev/ruleFields.js'
import { EFFORT_LEVELS } from '../../utils/effort.js'
import {
  MODEL_CONTEXT_WINDOW_MAX,
  MODEL_CONTEXT_WINDOW_MIN,
  normalizeModelId,
} from '../../utils/model/modelRules.js'

const CAPABILITY_FIELDS = ['contextWindow', 'maxOutputTokens', 'reasoning', 'input', 'structuredOutput'] as const
const MODELS_DEV_FIELDS = ['contextWindow', 'maxOutputTokens', 'reasoning', 'input'] as const
const ENDPOINT_FIELDS = [
  'reasoningDialect',
  'maxTokensField',
  'nativeWebSearch',
  'extraBody',
  'reasoningReplay',
  'unmarkedReasoningReplay',
  'thinkTagsInText',
] as const
const PROXY_ONLY_FIELDS = ['extraBody', 'maxTokensField', 'thinkTagsInText', 'reasoningReplay', 'unmarkedReasoningReplay'] as const

const { models, corrections, sites, formats } = BUILTIN_MODEL_RULES
const entries = [...models, ...corrections, ...sites]
const allRules: ModelRuleFields[] = [...entries.map(entry => entry.rules), ...Object.values(formats)]

const snapshotIndex = buildModelsDevIndex(bundledModelsDevData().catalog)

function snapshotModel(modelId: string) {
  return lookupModelsDevModel(snapshotIndex, '', modelId)?.model
}

function setFields<K extends keyof ModelRuleFields>(rules: ModelRuleFields, fields: readonly K[]): K[] {
  return fields.filter(field => rules[field] !== undefined)
}

describe('built-in model rules', () => {
  test('every entry names its source', () => {
    for (const entry of entries) {
      expect(entry.source.url).toStartWith('https://')
      expect(entry.source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  test('model prefixes are unique after normalization', () => {
    const prefixes = models.map(entry => normalizeModelId(entry.match.modelPrefix))
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  test('site keys are unique after normalization', () => {
    const keys = sites.map(entry =>
      [entry.match.host, entry.match.apiFormat, entry.match.modelPrefix ? normalizeModelId(entry.match.modelPrefix) : ''].join('|'),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('site hosts are bare lowercase host names', () => {
    for (const entry of sites) {
      expect(entry.match.host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
    }
  })

  test('context windows are in range and levels are CLI effort levels', () => {
    for (const rules of [...allRules, BUILTIN_MODEL_RULES.fallback.rules]) {
      if (rules.contextWindow !== undefined) {
        expect(rules.contextWindow).toBeGreaterThanOrEqual(MODEL_CONTEXT_WINDOW_MIN)
        expect(rules.contextWindow).toBeLessThanOrEqual(MODEL_CONTEXT_WINDOW_MAX)
      }
      for (const level of rules.reasoning?.levels ?? []) {
        expect(EFFORT_LEVELS).toContain(level)
      }
    }
  })

  test('effort and toggle_effort entries list their levels', () => {
    for (const rules of allRules) {
      const control = rules.reasoning?.control
      if (control === 'effort' || control === 'toggle_effort') {
        expect(rules.reasoning?.levels?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })

  test('model entries set no endpoint fields except an anthropic dialect and native web search on Claude entries', () => {
    for (const entry of models) {
      const { reasoningDialect, nativeWebSearch, ...rest } = entry.rules
      expect({ prefix: entry.match.modelPrefix, fields: setFields(rest, ENDPOINT_FIELDS) }).toEqual({
        prefix: entry.match.modelPrefix,
        fields: [],
      })
      if (reasoningDialect === undefined && nativeWebSearch === undefined) continue
      expect({ prefix: entry.match.modelPrefix, claude: entry.match.modelPrefix.startsWith('claude-') }).toEqual({
        prefix: entry.match.modelPrefix,
        claude: true,
      })
      if (reasoningDialect) expect(dialectFitsFormat(reasoningDialect, 'anthropic')).toBe(true)
    }
  })

  test('format entries and site host entries set no capability fields', () => {
    const hostRules = sites.filter(entry => !entry.match.modelPrefix).map(entry => entry.rules)
    for (const rules of [...Object.values(formats), ...hostRules]) {
      expect(setFields(rules, CAPABILITY_FIELDS)).toEqual([])
    }
  })

  test('anthropic site entries set no proxy-only fields', () => {
    for (const entry of sites.filter(site => site.match.apiFormat === 'anthropic')) {
      expect({ host: entry.match.host, fields: setFields(entry.rules, PROXY_ONLY_FIELDS) }).toEqual({
        host: entry.match.host,
        fields: [],
      })
    }
  })

  test('dialects fit the apiFormat they are used with', () => {
    for (const apiFormat of ApiFormatSchema.options) {
      const dialect = formats[apiFormat].reasoningDialect
      if (dialect) expect(dialectFitsFormat(dialect, apiFormat)).toBe(true)
    }
    for (const entry of sites) {
      if (entry.rules.reasoningDialect) {
        expect(dialectFitsFormat(entry.rules.reasoningDialect, entry.match.apiFormat)).toBe(true)
      }
    }
  })

  test('every prefix site entry has a host entry with the same host and apiFormat', () => {
    for (const entry of sites.filter(site => site.match.modelPrefix)) {
      const host = sites.find(
        site => !site.match.modelPrefix && site.match.host === entry.match.host && site.match.apiFormat === entry.match.apiFormat,
      )
      expect(host).toBeDefined()
    }
  })

  test('the schema rejects reserved extraBody keys', () => {
    const table = structuredClone(modelRulesJson) as { sites: Array<{ rules: Record<string, unknown> }> }
    table.sites[0]!.rules.extraBody = { messages: [] }
    expect(ModelRulesTableSchema.safeParse(table).success).toBe(false)
  })

  test('model entries only cover models models.dev lacks, or fields it does not have', () => {
    for (const entry of models) {
      if (!snapshotModel(entry.match.modelPrefix)) continue
      expect({ prefix: entry.match.modelPrefix, fields: setFields(entry.rules, MODELS_DEV_FIELDS) }).toEqual({
        prefix: entry.match.modelPrefix,
        fields: [],
      })
    }
  })

  test('every correction changes a value models.dev still lists', () => {
    for (const entry of corrections) {
      const id = entry.match.modelId
      const model = snapshotModel(id)
      expect({ id, found: model !== undefined }).toEqual({ id, found: true })
      const listed = modelsDevRuleFields(model!)
      const changed = setFields(entry.rules, MODELS_DEV_FIELDS).filter(
        field => JSON.stringify(entry.rules[field]) !== JSON.stringify(listed[field]),
      )
      expect({ id, changed: changed.length > 0 }).toEqual({ id, changed: true })
    }
  })

  test('corrections are unique after normalization', () => {
    const ids = corrections.map(entry => normalizeModelId(entry.match.modelId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the schema requires a vendor document link on a correction and allows an empty models.dev PR', () => {
    const correction = (source: Record<string, unknown>, rules: Record<string, unknown> = { reasoning: { control: 'toggle' } }) => ({
      ...structuredClone(modelRulesJson),
      corrections: [{ match: { modelId: 'x' }, source, rules }],
    })
    const valid = { url: 'https://vendor.test/docs', modelsDevPr: '', checkedAt: '2026-11-20' }
    expect(ModelRulesTableSchema.safeParse(correction(valid)).success).toBe(true)
    expect(ModelRulesTableSchema.safeParse(correction({ ...valid, modelsDevPr: 'https://github.com/anomalyco/models.dev/pull/1' })).success).toBe(true)
    const { url: _url, ...withoutUrl } = valid
    expect(ModelRulesTableSchema.safeParse(correction(withoutUrl)).success).toBe(false)
    const { modelsDevPr: _pr, ...withoutPr } = valid
    expect(ModelRulesTableSchema.safeParse(correction(withoutPr)).success).toBe(false)
    expect(ModelRulesTableSchema.safeParse(correction(valid, { reasoningDialect: 'anthropic_adaptive' })).success).toBe(false)
    expect(ModelRulesTableSchema.safeParse(correction(valid, { structuredOutput: true })).success).toBe(false)
  })

  test('the schema requires a complete fallback', () => {
    const table = structuredClone(modelRulesJson) as { fallback: { rules: Record<string, unknown> } }
    delete table.fallback.rules.maxTokensField
    expect(ModelRulesTableSchema.safeParse(table).success).toBe(false)
  })
})

describe('bundled models.dev snapshot', () => {
  test('parses and has a valid fetch time', () => {
    const { fetchedAt } = bundledModelsDevData()
    expect(Number.isNaN(Date.parse(fetchedAt))).toBe(false)
  })

  test('has every vendor provider and a full catalog', () => {
    const { catalog } = bundledModelsDevData()
    for (const id of VENDOR_PROVIDER_IDS) expect({ id, present: id in catalog }).toEqual({ id, present: true })
    const modelCount = Object.values(catalog).reduce((count, provider) => count + Object.keys(provider.models).length, 0)
    expect(modelCount).toBeGreaterThan(2_000)
  })
})

describe('Anthropic corrections on the bundled snapshot', () => {
  const relay = { baseUrl: 'https://relay.example.com', apiFormat: 'anthropic' } as const
  const resolve = (modelId: string) => resolveModelRulesFromTable(BUILTIN_MODEL_RULES, snapshotIndex, relay, modelId)

  test.each([
    ['claude-haiku-4-5', 'toggle'],
    ['claude-haiku-4-5-20251001', 'toggle'],
    ['claude-sonnet-4-5', 'toggle'],
    ['claude-sonnet-4-5-20250929', 'toggle'],
    ['claude-opus-4-5', 'toggle_effort'],
    ['claude-opus-4-5-20251101', 'toggle_effort'],
    ['claude-opus-4-6', 'toggle_effort'],
    ['claude-sonnet-4-6', 'toggle_effort'],
    ['claude-opus-4-7', 'toggle_effort'],
    ['claude-opus-4-8', 'toggle_effort'],
    ['claude-opus-5', 'toggle_effort'],
    ['anthropic/claude-opus-4.7', 'toggle_effort'],
    ['claude-opus-4-6-relay-thinking', 'toggle_effort'],
    ['claude-sonnet-4-5-20250929-relay-thinking', 'toggle'],
  ] as const)('%s can turn thinking off', (modelId, control) => {
    const rules = resolve(modelId)
    expect(rules.reasoning.control).toBe(control)
    expect(rules.sources.reasoning).toBe('model')
  })

  test.each(['claude-opus-5-5', 'claude-opus-5-5-relay-thinking', 'claude-sonnet-5-5', 'claude-fable-5-2'])('%s keeps the models.dev thinking mode', modelId => {
    const rules = resolve(modelId)
    expect(rules.reasoning.control).toBe('effort')
    expect(rules.sources.reasoning).toBe('modelsDev')
  })
})
