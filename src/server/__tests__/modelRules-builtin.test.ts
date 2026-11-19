import { describe, expect, test } from 'bun:test'

import modelRulesJson from '../config/modelRules.json'
import { BUILTIN_MODEL_RULES } from '../services/modelRules/builtinModelRules.js'
import { dialectFitsFormat, type ModelRuleFields } from '../types/modelRules.js'
import { ModelRulesTableSchema } from '../types/modelRulesTable.js'
import { ApiFormatSchema } from '../types/provider.js'
import { EFFORT_LEVELS } from '../../utils/effort.js'
import {
  MODEL_CONTEXT_WINDOW_MAX,
  MODEL_CONTEXT_WINDOW_MIN,
  normalizeModelId,
} from '../../utils/model/modelRules.js'

const CAPABILITY_FIELDS = ['contextWindow', 'maxOutputTokens', 'reasoning', 'input', 'structuredOutput'] as const
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

const { models, sites, formats } = BUILTIN_MODEL_RULES
const entries = [...models, ...sites]
const allRules: ModelRuleFields[] = [...entries.map(entry => entry.rules), ...Object.values(formats)]

function setFields(rules: ModelRuleFields, fields: readonly (keyof ModelRuleFields)[]): string[] {
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

  test('the schema requires a complete fallback', () => {
    const table = structuredClone(modelRulesJson) as { fallback: { rules: Record<string, unknown> } }
    delete table.fallback.rules.maxTokensField
    expect(ModelRulesTableSchema.safeParse(table).success).toBe(false)
  })
})
