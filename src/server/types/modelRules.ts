import { z } from 'zod'

import type { EffortLevel } from '../../utils/effort.js'
import {
  EffortLevelSchema,
  ModelContextWindowSchema,
} from '../../utils/model/modelRules.js'
import type { ApiFormat } from './provider.js'

const ReasoningControlSchema = z.enum([
  'none',
  'toggle',
  'effort',
  'toggle_effort',
  'always',
])
export type ReasoningControl = z.infer<typeof ReasoningControlSchema>

const ReasoningDialectSchema = z.enum([
  'anthropic_adaptive',
  'anthropic_budget',
  'anthropic_disable_only',
  'reasoning_effort',
  'responses_reasoning',
  'thinking_type',
  'thinking_adaptive',
  'enable_thinking',
  'openrouter',
])
export type ReasoningDialect = z.infer<typeof ReasoningDialectSchema>

const REASONING_DIALECT_API_FORMAT: Record<ReasoningDialect, ApiFormat> = {
  anthropic_adaptive: 'anthropic',
  anthropic_budget: 'anthropic',
  anthropic_disable_only: 'anthropic',
  reasoning_effort: 'openai_chat',
  responses_reasoning: 'openai_responses',
  thinking_type: 'openai_chat',
  thinking_adaptive: 'openai_chat',
  enable_thinking: 'openai_chat',
  openrouter: 'openai_chat',
}

export function dialectFitsFormat(dialect: ReasoningDialect, apiFormat: ApiFormat): boolean {
  return REASONING_DIALECT_API_FORMAT[dialect] === apiFormat
}

const RESERVED_EXTRA_BODY_KEYS = [
  'model',
  'messages',
  'stream',
  'tools',
  'tool_choice',
  'input',
] as const

const ExtraBodySchema = z
  .record(z.string(), z.unknown())
  .superRefine((body, ctx) => {
    for (const key of RESERVED_EXTRA_BODY_KEYS) {
      if (Object.hasOwn(body, key)) {
        ctx.addIssue({
          code: 'custom',
          message: `extraBody cannot set ${key}`,
          path: [key],
        })
      }
    }
  })

const MaxOutputTokensSchema = z.number().int().positive()
const EffortLevelsSchema = z.array(EffortLevelSchema)
const ReasoningReplaySchema = z.enum(['same_as_received', 'off'])
const UnmarkedReasoningReplaySchema = z.enum(['reasoning_content', 'none'])
const MaxTokensFieldSchema = z.enum([
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
])

export const ModelRuleFieldsSchema = z
  .object({
    contextWindow: ModelContextWindowSchema.optional(),
    maxOutputTokens: MaxOutputTokensSchema.optional(),
    reasoning: z
      .object({
        control: ReasoningControlSchema,
        levels: EffortLevelsSchema.optional(),
      })
      .strict()
      .optional(),
    input: z
      .object({ image: z.boolean().optional(), pdf: z.boolean().optional() })
      .strict()
      .optional(),
    structuredOutput: z.boolean().optional(),
    thinkTagsInText: z.boolean().optional(),
    reasoningReplay: ReasoningReplaySchema.optional(),
    unmarkedReasoningReplay: UnmarkedReasoningReplaySchema.optional(),
    reasoningDialect: ReasoningDialectSchema.optional(),
    maxTokensField: MaxTokensFieldSchema.optional(),
    nativeWebSearch: z.boolean().optional(),
    extraBody: ExtraBodySchema.optional(),
  })
  .strict()
export type ModelRuleFields = z.infer<typeof ModelRuleFieldsSchema>

export const CompleteModelRuleFieldsSchema = z
  .object({
    contextWindow: ModelContextWindowSchema,
    maxOutputTokens: MaxOutputTokensSchema,
    reasoning: z
      .object({ control: ReasoningControlSchema, levels: EffortLevelsSchema })
      .strict(),
    input: z.object({ image: z.boolean(), pdf: z.boolean() }).strict(),
    structuredOutput: z.boolean(),
    thinkTagsInText: z.boolean(),
    reasoningReplay: ReasoningReplaySchema,
    unmarkedReasoningReplay: UnmarkedReasoningReplaySchema,
    reasoningDialect: ReasoningDialectSchema,
    maxTokensField: MaxTokensFieldSchema,
    nativeWebSearch: z.boolean(),
    extraBody: ExtraBodySchema,
  })
  .strict()
type CompleteModelRuleFields = z.infer<typeof CompleteModelRuleFieldsSchema>

const FieldSourceSchema = z.enum([
  'fallback',
  'format',
  'model',
  'modelsDev',
  'site',
  'discovered',
  'user',
])
export type FieldSource = z.infer<typeof FieldSourceSchema>

type CapabilityField =
  | 'contextWindow'
  | 'maxOutputTokens'
  | 'reasoning'
  | 'image'
  | 'pdf'
  | 'structuredOutput'

export type ResolvedModelRules = CompleteModelRuleFields & {
  usedFallback: boolean
  sources: Record<CapabilityField, FieldSource>
}

export const ModelOverrideSchema = z.object({
  contextWindow: ModelContextWindowSchema.optional(),
  maxOutputTokens: MaxOutputTokensSchema.optional(),
  reasoningLevels: z.union([EffortLevelsSchema, z.literal('off')]).optional(),
  image: z.boolean().optional(),
  pdf: z.boolean().optional(),
  reasoningDialect: ReasoningDialectSchema.optional(),
  extraBody: ExtraBodySchema.optional(),
})
export type ModelOverride = z.infer<typeof ModelOverrideSchema>

export const DiscoveredModelSchema = z.object({
  contextWindow: ModelContextWindowSchema.optional(),
  maxOutputTokens: MaxOutputTokensSchema.optional(),
  image: z.boolean().optional(),
  pdf: z.boolean().optional(),
})
export type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>

export type ResolvedRuleValues = {
  contextWindow: number
  maxOutputTokens: number
  reasoning: { control: ReasoningControl }
  effortLevels: EffortLevel[]
  image: boolean
  pdf: boolean
  sources: Record<CapabilityField, FieldSource>
}

export type ResolvedModelRulesView = ResolvedRuleValues & {
  appliedEffort?: Record<EffortLevel, EffortLevel>
  usedFallback: boolean
  inherited: ResolvedRuleValues
}
