import { EFFORT_LEVELS, normalizeEffortLevel, type EffortLevel } from '../../../utils/effort.js'
import {
  normalizeModelId,
  resolveEffortForLevels,
  type CliModelRules,
  type CliModelRulesEnv,
} from '../../../utils/model/modelRules.js'
import type { ResolvedModelRules, ResolvedModelRulesView, ResolvedRuleValues } from '../../types/modelRules.js'
import type { ApiFormat } from '../../types/provider.js'
import { isOfficialAnthropicProvider } from './officialAnthropicProvider.js'
import {
  resolveFallbackModelRules,
  resolveModelRules,
  type ModelRulesProvider,
} from './resolveModelRules.js'

function thinkingWhenOn(rules: ResolvedModelRules, apiFormat: ApiFormat): CliModelRules['thinkingWhenOn'] {
  if (rules.reasoning.control === 'none') return 'omit'
  if (apiFormat !== 'anthropic') return 'adaptive'
  switch (rules.reasoningDialect) {
    case 'anthropic_adaptive':
      return 'adaptive'
    case 'anthropic_disable_only':
      return 'omit'
    default:
      return 'budget'
  }
}

function thinkingWhenOff(rules: ResolvedModelRules): CliModelRules['thinkingWhenOff'] {
  switch (rules.reasoning.control) {
    case 'effort':
    case 'always':
      return 'omit'
    case 'toggle':
    case 'toggle_effort':
      return 'disabled'
    case 'none':
      return rules.reasoningDialect === 'anthropic_disable_only' ? 'disabled' : 'omit'
  }
}

function effortLevels(rules: ResolvedModelRules, apiFormat: ApiFormat): EffortLevel[] {
  const { control, levels } = rules.reasoning
  if (control === 'none' || control === 'toggle') return []
  const sendsNoEffort = rules.reasoningDialect === 'anthropic_budget' || rules.reasoningDialect === 'anthropic_disable_only'
  if (apiFormat === 'anthropic' && sendsNoEffort) return []
  return [...levels]
}

export function toCliModelRules(rules: ResolvedModelRules, apiFormat: ApiFormat): CliModelRules {
  return {
    contextWindow: rules.contextWindow,
    ...(rules.sources.maxOutputTokens === 'fallback' ? {} : { maxOutputTokens: rules.maxOutputTokens }),
    thinkingWhenOn: thinkingWhenOn(rules, apiFormat),
    thinkingWhenOff: thinkingWhenOff(rules),
    effortLevels: effortLevels(rules, apiFormat),
    pdf: rules.input.pdf,
    image: rules.input.image,
    nativeWebSearch: rules.nativeWebSearch,
    structuredOutput: rules.structuredOutput,
  }
}

export function buildCliModelRulesEnv(
  provider: ModelRulesProvider,
  modelIds: readonly string[],
  effort: unknown,
): CliModelRulesEnv {
  const models: Record<string, CliModelRules> = {}
  for (const modelId of modelIds) {
    const key = normalizeModelId(modelId)
    if (key in models) continue
    models[key] = toCliModelRules(resolveModelRules(provider, modelId), provider.apiFormat)
  }
  return {
    models,
    fallback: toCliModelRules(resolveFallbackModelRules(provider), provider.apiFormat),
    defaultEffort: normalizeEffortLevel(effort),
  }
}

function appliedEffort(levels: readonly EffortLevel[]): Record<EffortLevel, EffortLevel> | undefined {
  if (levels.length === 0) return undefined
  const entries = EFFORT_LEVELS.map(level => [level, resolveEffortForLevels(level, levels) ?? level] as const)
  return Object.fromEntries(entries) as Record<EffortLevel, EffortLevel>
}

export function buildResolvedModelsView(
  provider: ModelRulesProvider,
  modelIds: readonly string[],
): Record<string, ResolvedModelRulesView> | undefined {
  if (isOfficialAnthropicProvider(provider)) return undefined
  const { modelOverrides: _overrides, ...withoutOverrides } = provider
  const view: Record<string, ResolvedModelRulesView> = {}
  for (const modelId of modelIds) {
    const rules = resolveModelRules(provider, modelId)
    const values = ruleValues(rules, provider.apiFormat)
    const applied = appliedEffort(values.effortLevels)
    view[modelId] = {
      ...values,
      ...(applied ? { appliedEffort: applied } : {}),
      usedFallback: rules.usedFallback,
      inherited: ruleValues(resolveModelRules(withoutOverrides, modelId), provider.apiFormat),
    }
  }
  return view
}

function ruleValues(rules: ResolvedModelRules, apiFormat: ApiFormat): ResolvedRuleValues {
  return {
    contextWindow: rules.contextWindow,
    maxOutputTokens: rules.maxOutputTokens,
    reasoning: { control: rules.reasoning.control },
    effortLevels: effortLevels(rules, apiFormat),
    image: rules.input.image,
    pdf: rules.input.pdf,
    sources: rules.sources,
  }
}
