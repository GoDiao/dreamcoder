import { z } from 'zod/v4'
import { logError } from '../log.js'

export const MODEL_RULES_ENV_KEY = 'DREAMCODER_MODEL_RULES'
export const MODEL_CONTEXT_WINDOW_MIN = 16_000
export const MODEL_CONTEXT_WINDOW_MAX = 10_000_000

export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'max',
] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const ModelContextWindowSchema = z
  .number()
  .int()
  .min(MODEL_CONTEXT_WINDOW_MIN)
  .max(MODEL_CONTEXT_WINDOW_MAX)

export const EffortLevelSchema = z.enum(EFFORT_LEVELS)

export const CliModelRulesSchema = z.object({
  contextWindow: ModelContextWindowSchema,
  maxOutputTokens: z.number().int().positive().optional(),
  thinkingWhenOn: z.enum(['omit', 'adaptive', 'budget']),
  thinkingWhenOff: z.enum(['omit', 'disabled']),
  effortLevels: z.array(EffortLevelSchema),
  pdf: z.boolean(),
  image: z.boolean(),
  nativeWebSearch: z.boolean(),
  structuredOutput: z.boolean(),
})

export type CliModelRules = z.infer<typeof CliModelRulesSchema>

const CliModelRulesEnvSchema = z.object({
  models: z.record(z.string(), CliModelRulesSchema),
  fallback: CliModelRulesSchema,
  defaultEffort: EffortLevelSchema,
})

export type CliModelRulesEnv = z.infer<typeof CliModelRulesEnvSchema>

const FIXED_FALLBACK_CLI_MODEL_RULES: CliModelRules = {
  contextWindow: 131_072,
  thinkingWhenOn: 'omit',
  thinkingWhenOff: 'omit',
  effortLevels: [],
  pdf: false,
  image: true,
  nativeWebSearch: false,
  structuredOutput: false,
}

function cleanModelId(modelId: string): string {
  return modelId
    .trim()
    .replace(/\[[12]m\]$/i, '')
    .replace(/:1m$/i, '')
    .toLowerCase()
}

export function normalizeModelId(modelId: string): string {
  return cleanModelId(modelId).replaceAll('.', '-')
}

const MODEL_ID_SEPARATORS = new Set(['-', ':', '/', '@', '_'])

function modelIdPrefixMatches(normalized: string, boundary: string, prefix: string): boolean {
  if (!normalized.startsWith(prefix)) return false
  if (normalized.length === prefix.length) return true
  return MODEL_ID_SEPARATORS.has(prefix.at(-1)!) || MODEL_ID_SEPARATORS.has(boundary[prefix.length]!)
}

export function findLongestPrefix<T>(
  modelId: string,
  entries: Iterable<T>,
  prefixOf: (entry: T) => string,
  splitsAtDot = true,
): T | undefined {
  const name = cleanModelId(modelId)
  const find = (candidate: string) => {
    const normalized = candidate.replaceAll('.', '-')
    const boundary = splitsAtDot ? normalized : candidate
    let best: { entry: T; length: number } | undefined
    for (const entry of entries) {
      const prefix = normalizeModelId(prefixOf(entry))
      if (modelIdPrefixMatches(normalized, boundary, prefix) && prefix.length > (best?.length ?? -1)) {
        best = { entry, length: prefix.length }
      }
    }
    return best?.entry
  }
  const slash = name.indexOf('/')
  return find(name) ?? (slash >= 0 ? find(name.slice(slash + 1)) : undefined)
}

function sortLevels(levels: readonly EffortLevel[]): EffortLevel[] {
  return EFFORT_LEVELS.filter(level => levels.includes(level))
}

export function resolveEffortForLevels(
  level: EffortLevel,
  levels: readonly EffortLevel[],
): EffortLevel | undefined {
  const sorted = sortLevels(levels)
  if (sorted.length === 0) return undefined
  const rank = EFFORT_LEVELS.indexOf(level)
  return sorted.find(candidate => EFFORT_LEVELS.indexOf(candidate) >= rank) ?? sorted.at(-1)
}

type AuxiliaryThinking = {
  thinking: 'on' | 'off' | 'omit'
  effort?: EffortLevel
}

export function auxiliaryThinking(
  rules: CliModelRules,
  explicitThinking: boolean,
): AuxiliaryThinking {
  const weakest = sortLevels(rules.effortLevels)[0]
  if (explicitThinking) {
    return weakest ? { thinking: 'on', effort: weakest } : { thinking: 'on' }
  }
  if (rules.thinkingWhenOff === 'disabled') return { thinking: 'off' }
  if (weakest) return { thinking: 'omit', effort: weakest }
  return { thinking: 'omit' }
}

let cache: { raw: string; env: CliModelRulesEnv } | undefined

function parseEnv(raw: string): CliModelRulesEnv {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    logError(new Error(`${MODEL_RULES_ENV_KEY} is not valid JSON: ${String(error)}`))
    return { models: {}, fallback: FIXED_FALLBACK_CLI_MODEL_RULES, defaultEffort: 'medium' }
  }
  const parsed = CliModelRulesEnvSchema.safeParse(json)
  if (parsed.success) return parsed.data
  logError(new Error(`${MODEL_RULES_ENV_KEY} is invalid: ${parsed.error.message}`))
  const record = typeof json === 'object' && json !== null ? json as Record<string, unknown> : {}
  const fallback = CliModelRulesSchema.safeParse(record.fallback)
  const defaultEffort = EffortLevelSchema.safeParse(record.defaultEffort)
  return {
    models: {},
    fallback: fallback.success ? fallback.data : FIXED_FALLBACK_CLI_MODEL_RULES,
    defaultEffort: defaultEffort.success ? defaultEffort.data : 'medium',
  }
}

export function getCliModelRulesEnv(): CliModelRulesEnv | undefined {
  const raw = process.env[MODEL_RULES_ENV_KEY]
  if (raw === undefined) return undefined
  if (cache?.raw !== raw) cache = { raw, env: parseEnv(raw) }
  return cache.env
}

export function modelSupportsStructuredOutput(modelId: string): boolean {
  return getCliModelRules(modelId)?.structuredOutput !== false
}

export function getCliModelRules(modelId: string): CliModelRules | undefined {
  const env = getCliModelRulesEnv()
  if (!env) return undefined
  return env.models[normalizeModelId(modelId)] ?? env.fallback
}
