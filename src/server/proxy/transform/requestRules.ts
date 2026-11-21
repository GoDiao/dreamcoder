import type { EffortLevel } from '../../../utils/effort.js'
import { EffortLevelSchema, resolveEffortForLevels } from '../../../utils/model/modelRules.js'
import type { ReasoningDialect, ResolvedModelRules } from '../../types/modelRules.js'
import type { AnthropicOutputFormat, AnthropicRequest, ReasoningFields } from './types.js'

export type RequestRulesOptions = { defaultEffort?: EffortLevel }

type ThinkingPlan = 'omit' | 'off' | 'on'

const DIALECT_KEYS = new Set(['thinking', 'reasoning', 'reasoning_effort', 'enable_thinking', 'output_config'])

function requestedEffort(request: AnthropicRequest): EffortLevel | undefined {
  const parsed = EffortLevelSchema.safeParse(request.output_config?.effort)
  return parsed.success ? parsed.data : undefined
}

function thinkingPlan(request: AnthropicRequest, rules: ResolvedModelRules): ThinkingPlan {
  const { control } = rules.reasoning
  if (control === 'none') return 'omit'
  const type = request.thinking?.type
  const effort = requestedEffort(request)
  const thinkingOn = type === 'adaptive' || type === 'enabled'
  if (type !== 'disabled' && !effort && !thinkingOn) return 'omit'
  const canDisable = control === 'toggle' || control === 'toggle_effort'
  if (type === 'disabled' && canDisable) return 'off'
  return 'on'
}

function dialectFields(dialect: ReasoningDialect, plan: ThinkingPlan, level: EffortLevel | undefined): ReasoningFields {
  if (plan === 'omit') return {}
  const off = plan === 'off'
  switch (dialect) {
    case 'reasoning_effort':
      if (off) return { reasoning_effort: 'none' }
      return level ? { reasoning_effort: level } : {}
    case 'responses_reasoning':
      if (off) return { reasoning: { effort: 'none' } }
      return level ? { reasoning: { effort: level, summary: 'auto' } } : {}
    case 'thinking_type':
      if (off) return { thinking: { type: 'disabled' } }
      return { thinking: { type: 'enabled' }, ...(level && { reasoning_effort: level }) }
    case 'thinking_adaptive':
      if (off) return { thinking: { type: 'disabled' } }
      return { thinking: { type: 'adaptive' }, ...(level && { reasoning_effort: level }) }
    case 'enable_thinking':
      if (off) return { enable_thinking: false }
      return { enable_thinking: true, ...(level && { reasoning_effort: level }) }
    case 'openrouter':
      if (off) return { reasoning: { effort: 'none' } }
      return level ? { reasoning: { effort: level } } : { reasoning: { enabled: true } }
    case 'anthropic_adaptive':
    case 'anthropic_budget':
    case 'anthropic_disable_only':
      return {}
  }
}

function reasoningFields(
  request: AnthropicRequest,
  rules: ResolvedModelRules,
  defaultEffort: EffortLevel,
): ReasoningFields {
  const plan = thinkingPlan(request, rules)
  const level = plan === 'on'
    ? resolveEffortForLevels(requestedEffort(request) ?? defaultEffort, rules.reasoning.levels)
    : undefined
  return dialectFields(rules.reasoningDialect, plan, level)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return structuredClone(patch)
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) merged[key] = deepMerge(base[key], value)
  return merged
}

export function outputFormatFor(request: AnthropicRequest, rules: ResolvedModelRules): AnthropicOutputFormat | undefined {
  const format = request.output_config?.format
  return rules.structuredOutput && format?.type === 'json_schema' ? format : undefined
}

export function applyRequestRules(
  body: Record<string, unknown>,
  request: AnthropicRequest,
  rules: ResolvedModelRules,
  { defaultEffort = 'medium' }: RequestRulesOptions,
): void {
  const fields = reasoningFields(request, rules, defaultEffort)
  Object.assign(body, fields)
  if (rules.sources.maxOutputTokens !== 'fallback') {
    body[rules.maxTokensField] = typeof request.max_tokens === 'number'
      ? Math.min(request.max_tokens, rules.maxOutputTokens)
      : rules.maxOutputTokens
  }
  const wroteThinking = Object.keys(fields).length > 0
  for (const [key, value] of Object.entries(rules.extraBody)) {
    if (!wroteThinking && DIALECT_KEYS.has(key)) continue
    body[key] = deepMerge(body[key], value)
  }
}
