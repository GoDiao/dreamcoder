import { z } from 'zod'

export const ApiFormatSchema = z.enum([
  'anthropic',
  'openai_chat',
  'openai_responses',
])
export type ApiFormat = z.infer<typeof ApiFormatSchema>

export const ProviderAuthStrategySchema = z.enum([
  'api_key',
  'auth_token',
  'auth_token_empty_api_key',
  'dual_same_token',
  'dual_dummy',
])
export type ProviderAuthStrategy = z.infer<typeof ProviderAuthStrategySchema>

export const ProviderRuntimeKindSchema = z.enum(['anthropic_compatible'])
export type ProviderRuntimeKind = z.infer<typeof ProviderRuntimeKindSchema>

export const ProviderModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
})

export const ProviderModelsSchema = z.array(ProviderModelSchema).superRefine((models, ctx) => {
  const seen = new Set<string>()
  models.forEach((model, index) => {
    if (seen.has(model.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Model IDs must be unique',
        path: [index, 'id'],
      })
    }
    seen.add(model.id)
  })
})

export const DecisionProviderFormatSchema = z.enum([
  'openai_decisions',
  'openrouter_decisions',
  'openai_chat',
  'ollama_chat',
])
export type DecisionProviderFormat = z.infer<typeof DecisionProviderFormatSchema>

export const DecisionProviderPresetIdSchema = z.enum([
  'openai',
  'openrouter',
  'ollama',
  'custom',
])
export type DecisionProviderPresetId = z.infer<typeof DecisionProviderPresetIdSchema>

export const DecisionProviderDeploymentSchema = z.enum(['hosted', 'local'])
export type DecisionProviderDeployment = z.infer<typeof DecisionProviderDeploymentSchema>

export const SavedDecisionProviderSchema = z.object({
  id: z.string(),
  presetId: DecisionProviderPresetIdSchema,
  name: z.string().trim().min(1),
  deployment: DecisionProviderDeploymentSchema,
  apiFormat: DecisionProviderFormatSchema,
  baseUrl: z.string().url(),
  apiKey: z.string(),
  models: ProviderModelsSchema.min(1),
})

export const ModelContextWindowSchema = z.number().int().min(16000).max(10000000)
export const ModelContextWindowsSchema = z.record(
  z.string().min(1),
  ModelContextWindowSchema,
)

export const SavedProviderSchema = z.object({
  id: z.string(),
  presetId: z.string(),
  name: z.string().min(1),
  apiKey: z.string(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema.default('anthropic'),
  runtimeKind: ProviderRuntimeKindSchema.default('anthropic_compatible'),
  models: ProviderModelsSchema.min(1),
  fastModel: z.string().trim().min(1).optional(),
  modelContextWindows: ModelContextWindowsSchema.optional(),
  notes: z.string().optional(),
})

export const ProvidersIndexSchema = z.object({
  schemaVersion: z.number().int().positive().optional(),
  activeId: z.string().nullable(),
  providers: z.array(SavedProviderSchema),
  activeDecisionProviderId: z.string().nullable().default(null),
  decisionProviders: z.array(SavedDecisionProviderSchema).default([]),
})

export const CreateDecisionProviderSchema = z.object({
  presetId: DecisionProviderPresetIdSchema,
  name: z.string().trim().min(1),
  apiFormat: DecisionProviderFormatSchema,
  baseUrl: z.string().url(),
  apiKey: z.string(),
  models: ProviderModelsSchema.min(1),
})

export const UpdateDecisionProviderSchema = CreateDecisionProviderSchema.partial()

export const TestDecisionProviderSchema = CreateDecisionProviderSchema.pick({
  apiFormat: true,
  baseUrl: true,
  apiKey: true,
}).extend({
  modelId: z.string().trim().min(1),
})

export const DiscoverDecisionProviderModelsSchema = CreateDecisionProviderSchema.pick({
  presetId: true,
  apiFormat: true,
  baseUrl: true,
  apiKey: true,
})

export const CreateProviderSchema = z.object({
  presetId: z.string().min(1),
  name: z.string().min(1),
  apiKey: z.string(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema.default('anthropic'),
  runtimeKind: ProviderRuntimeKindSchema.default('anthropic_compatible'),
  models: ProviderModelsSchema.min(1),
  fastModel: z.string().trim().min(1).optional(),
  modelContextWindows: ModelContextWindowsSchema.optional(),
  notes: z.string().optional(),
})

export const UpdateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  baseUrl: z.string().optional(),
  apiFormat: ApiFormatSchema.optional(),
  runtimeKind: ProviderRuntimeKindSchema.optional(),
  models: ProviderModelsSchema.min(1).optional(),
  fastModel: z.string().trim().min(1).nullable().optional(),
  modelContextWindows: ModelContextWindowsSchema.nullable().optional(),
  notes: z.string().optional(),
})

export const TestProviderSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().min(1),
  authStrategy: ProviderAuthStrategySchema.optional(),
  apiFormat: ApiFormatSchema.default('anthropic'),
})

export const DiscoverProviderModelsSchema = z.object({
  presetId: z.string().optional(),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  apiFormat: ApiFormatSchema.default('anthropic'),
})

export type ProviderModel = z.infer<typeof ProviderModelSchema>
export type DiscoveredProviderModel = ProviderModel & { contextWindow?: number }
export type SavedProvider = z.infer<typeof SavedProviderSchema>
export type SavedDecisionProvider = z.infer<typeof SavedDecisionProviderSchema>
export type ProvidersIndex = z.infer<typeof ProvidersIndexSchema>
export type CreateProviderInput = z.infer<typeof CreateProviderSchema>
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>
export type TestProviderInput = z.infer<typeof TestProviderSchema>
export type DiscoverProviderModelsInput = z.infer<typeof DiscoverProviderModelsSchema>
export type CreateDecisionProviderInput = z.infer<typeof CreateDecisionProviderSchema>
export type UpdateDecisionProviderInput = z.infer<typeof UpdateDecisionProviderSchema>
export type TestDecisionProviderInput = z.infer<typeof TestDecisionProviderSchema>
export type DiscoverDecisionProviderModelsInput = z.infer<typeof DiscoverDecisionProviderModelsSchema>

export interface ProviderTestStepResult {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  httpStatus?: number
}

export interface ProviderTestResult {
  connectivity: ProviderTestStepResult
}
