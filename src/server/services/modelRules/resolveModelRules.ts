import { findLongestPrefix, normalizeModelId } from '../../../utils/model/modelRules.js'
import {
  dialectFitsFormat,
  type DiscoveredModel,
  type FieldSource,
  type ModelOverride,
  type ModelRuleFields,
  type ReasoningControl,
  type ResolvedModelRules,
} from '../../types/modelRules.js'
import type { CorrectionEntry, ModelRulesTable, SiteRuleEntry } from '../../types/modelRulesTable.js'
import type { ApiFormat } from '../../types/provider.js'
import { hostnameOf } from '../../upstream/baseUrl.js'
import { lookupModelsDevModel, modelsDevCandidateKeys, type ModelsDevIndex } from '../modelsDev/catalog.js'
import { currentModelsDevIndex } from '../modelsDev/modelsDevStore.js'
import { modelsDevRuleFields } from '../modelsDev/ruleFields.js'
import { BUILTIN_MODEL_RULES } from './builtinModelRules.js'

export type ModelRulesProvider = {
  baseUrl: string
  apiFormat: ApiFormat
  modelOverrides?: Record<string, ModelOverride>
  discoveredModels?: Record<string, DiscoveredModel>
}

function hostMatches(host: string, entryHost: string): boolean {
  return host === entryHost || host.endsWith(`.${entryHost}`)
}

function lookupByModelId<T>(map: Record<string, T> | undefined, normalizedId: string): T | undefined {
  if (!map) return undefined
  return Object.entries(map).find(([key]) => normalizeModelId(key) === normalizedId)?.[1]
}

function initialState(table: ModelRulesTable): ResolvedModelRules {
  const { rules } = table.fallback
  return {
    ...structuredClone(rules),
    usedFallback: true,
    sources: {
      contextWindow: 'fallback',
      maxOutputTokens: 'fallback',
      reasoning: 'fallback',
      image: 'fallback',
      pdf: 'fallback',
      structuredOutput: 'fallback',
    },
  }
}

function applyFields(state: ResolvedModelRules, fields: ModelRuleFields, source: FieldSource): void {
  if (fields.contextWindow !== undefined) {
    state.contextWindow = fields.contextWindow
    state.sources.contextWindow = source
  }
  if (fields.maxOutputTokens !== undefined) {
    state.maxOutputTokens = fields.maxOutputTokens
    state.sources.maxOutputTokens = source
  }
  if (fields.reasoning !== undefined) {
    state.reasoning = { control: fields.reasoning.control, levels: [...(fields.reasoning.levels ?? [])] }
    state.sources.reasoning = source
  }
  if (fields.input?.image !== undefined) {
    state.input.image = fields.input.image
    state.sources.image = source
  }
  if (fields.input?.pdf !== undefined) {
    state.input.pdf = fields.input.pdf
    state.sources.pdf = source
  }
  if (fields.structuredOutput !== undefined) {
    state.structuredOutput = fields.structuredOutput
    state.sources.structuredOutput = source
  }
  if (fields.thinkTagsInText !== undefined) state.thinkTagsInText = fields.thinkTagsInText
  if (fields.reasoningReplay !== undefined) state.reasoningReplay = fields.reasoningReplay
  if (fields.unmarkedReasoningReplay !== undefined) state.unmarkedReasoningReplay = fields.unmarkedReasoningReplay
  if (fields.reasoningDialect !== undefined) state.reasoningDialect = fields.reasoningDialect
  if (fields.maxTokensField !== undefined) state.maxTokensField = fields.maxTokensField
  if (fields.nativeWebSearch !== undefined) state.nativeWebSearch = fields.nativeWebSearch
  if (fields.extraBody !== undefined) state.extraBody = structuredClone(fields.extraBody)
}

function findHostEntry(table: ModelRulesTable, provider: ModelRulesProvider): SiteRuleEntry | undefined {
  const host = hostnameOf(provider.baseUrl)
  let best: SiteRuleEntry | undefined
  for (const entry of table.sites) {
    if (entry.match.modelPrefix || entry.match.apiFormat !== provider.apiFormat || !hostMatches(host, entry.match.host)) continue
    if (!best || entry.match.host.length > best.match.host.length) best = entry
  }
  return best
}

function findPrefixEntry(table: ModelRulesTable, hostEntry: SiteRuleEntry, modelId: string): SiteRuleEntry | undefined {
  const candidates = table.sites.filter(
    entry =>
      entry.match.modelPrefix !== undefined &&
      entry.match.host === hostEntry.match.host &&
      entry.match.apiFormat === hostEntry.match.apiFormat,
  )
  return findLongestPrefix(modelId, candidates, entry => entry.match.modelPrefix ?? '')
}

function findCorrection(table: ModelRulesTable, modelId: string): CorrectionEntry | undefined {
  for (const key of modelsDevCandidateKeys(modelId)) {
    const correction = table.corrections.find(entry => normalizeModelId(entry.match.modelId) === key)
    if (correction) return correction
  }
  return undefined
}

function mergeReasoningLevels(
  current: ResolvedModelRules['reasoning'],
  levels: NonNullable<ModelOverride['reasoningLevels']>,
): ResolvedModelRules['reasoning'] {
  if (levels === 'off') return { control: 'none', levels: [] }
  const toggles: readonly ReasoningControl[] = ['none', 'toggle']
  if (levels.length > 0) {
    return { control: toggles.includes(current.control) ? 'toggle_effort' : current.control, levels: [...levels] }
  }
  const alwaysOn: readonly ReasoningControl[] = ['effort', 'always']
  return { control: alwaysOn.includes(current.control) ? 'always' : 'toggle', levels: [] }
}

function applyDiscovered(state: ResolvedModelRules, discovered: DiscoveredModel): void {
  applyFields(
    state,
    {
      contextWindow: discovered.contextWindow,
      maxOutputTokens: discovered.maxOutputTokens,
      input: {
        image: state.sources.image === 'fallback' ? discovered.image : undefined,
        pdf: state.sources.pdf === 'fallback' ? discovered.pdf : undefined,
      },
    },
    'discovered',
  )
}

function applyOverride(
  state: ResolvedModelRules,
  override: ModelOverride,
  provider: ModelRulesProvider,
  modelId: string,
): void {
  const { reasoningLevels, image, pdf, ...rest } = override
  const fields = fittingEndpointFields({ ...rest, input: { image, pdf } }, provider.apiFormat)
  applyFields(state, fields, 'user')
  if (reasoningLevels !== undefined) {
    state.reasoning = mergeReasoningLevels(state.reasoning, reasoningLevels)
    state.sources.reasoning = 'user'
  }
  if (rest.reasoningDialect && !fields.reasoningDialect) {
    console.warn(
      `[ModelRules] Ignoring the reasoningDialect override ${rest.reasoningDialect} for model ${modelId} on ${hostnameOf(provider.baseUrl) || provider.baseUrl}: it does not fit apiFormat ${provider.apiFormat}`,
    )
  }
}

function fittingEndpointFields(fields: ModelRuleFields, apiFormat: ApiFormat): ModelRuleFields {
  const { reasoningDialect, nativeWebSearch, ...rest } = fields
  return {
    ...rest,
    ...(reasoningDialect && dialectFitsFormat(reasoningDialect, apiFormat) && { reasoningDialect }),
    ...(nativeWebSearch !== undefined && apiFormat === 'anthropic' && { nativeWebSearch }),
  }
}

function finish(state: ResolvedModelRules): ResolvedModelRules {
  state.usedFallback = state.sources.reasoning === 'fallback'
  return state
}

export function resolveModelRulesFromTable(
  table: ModelRulesTable,
  modelsDev: ModelsDevIndex,
  provider: ModelRulesProvider,
  modelId: string,
): ResolvedModelRules {
  const state = initialState(table)
  const name = normalizeModelId(modelId)
  applyFields(state, table.formats[provider.apiFormat], 'format')
  const modelEntry = findLongestPrefix(modelId, table.models, entry => entry.match.modelPrefix)
  if (modelEntry) applyFields(state, fittingEndpointFields(modelEntry.rules, provider.apiFormat), 'model')
  const catalogMatch = lookupModelsDevModel(modelsDev, provider.baseUrl, modelId)
  if (catalogMatch) applyFields(state, modelsDevRuleFields(catalogMatch.model), 'modelsDev')
  const correction = findCorrection(table, catalogMatch?.id ?? modelId)
  if (correction) applyFields(state, correction.rules, 'model')
  const hostEntry = findHostEntry(table, provider)
  if (hostEntry) {
    applyFields(state, hostEntry.rules, 'site')
    const prefixEntry = findPrefixEntry(table, hostEntry, modelId)
    if (prefixEntry) applyFields(state, prefixEntry.rules, 'site')
  }
  const discovered = lookupByModelId(provider.discoveredModels, name)
  if (discovered) applyDiscovered(state, discovered)
  const override = lookupByModelId(provider.modelOverrides, name)
  if (override) applyOverride(state, override, provider, modelId)
  return finish(state)
}

export function resolveModelRules(provider: ModelRulesProvider, modelId: string): ResolvedModelRules {
  return resolveModelRulesFromTable(BUILTIN_MODEL_RULES, currentModelsDevIndex(), provider, modelId)
}

export function resolveFallbackModelRules(provider: ModelRulesProvider): ResolvedModelRules {
  const table = BUILTIN_MODEL_RULES
  const state = initialState(table)
  applyFields(state, table.formats[provider.apiFormat], 'format')
  const hostEntry = findHostEntry(table, provider)
  if (hostEntry) applyFields(state, hostEntry.rules, 'site')
  return finish(state)
}
