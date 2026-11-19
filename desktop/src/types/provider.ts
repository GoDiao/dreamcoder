import type { EffortLevel } from './settings'

export type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

export type ProviderAuthStrategy =
  | 'api_key'
  | 'auth_token'
  | 'auth_token_empty_api_key'
  | 'dual_same_token'
  | 'dual_dummy'

export type ProviderRuntimeKind = 'anthropic_compatible'

export type ProviderModel = {
  id: string
  name?: string
}

export type ReasoningDialect =
  | 'anthropic_adaptive'
  | 'anthropic_budget'
  | 'anthropic_disable_only'
  | 'reasoning_effort'
  | 'responses_reasoning'
  | 'thinking_type'
  | 'thinking_adaptive'
  | 'enable_thinking'
  | 'openrouter'

export type ReasoningControl = 'none' | 'toggle' | 'effort' | 'toggle_effort' | 'always'

export type FieldSource = 'fallback' | 'format' | 'model' | 'site' | 'discovered' | 'user'

export type InheritedSource = Exclude<FieldSource, 'format' | 'user'>

export type CapabilityField =
  | 'contextWindow'
  | 'maxOutputTokens'
  | 'reasoning'
  | 'image'
  | 'pdf'
  | 'structuredOutput'

export type ResolvedRuleValues<Source extends FieldSource = FieldSource> = {
  contextWindow: number
  maxOutputTokens: number
  reasoning: { control: ReasoningControl }
  effortLevels: EffortLevel[]
  image: boolean
  pdf: boolean
  sources: Record<CapabilityField, Source>
}

export type ResolvedModelRulesView = ResolvedRuleValues & {
  appliedEffort?: Record<EffortLevel, EffortLevel>
  usedFallback: boolean
  inherited: ResolvedRuleValues<InheritedSource>
}

export type ModelOverride = {
  contextWindow?: number
  maxOutputTokens?: number
  reasoningLevels?: EffortLevel[] | 'off'
  image?: boolean
  pdf?: boolean
  reasoningDialect?: ReasoningDialect
  extraBody?: Record<string, unknown>
}

type ModelOverrides = Record<string, ModelOverride>

export type SavedProvider = {
  id: string
  presetId: string
  name: string
  apiKey: string
  authStrategy?: ProviderAuthStrategy
  baseUrl: string
  apiFormat: ApiFormat
  runtimeKind?: ProviderRuntimeKind
  models: ProviderModel[]
  fastModel?: string
  modelOverrides?: ModelOverrides
  resolvedModels?: Record<string, ResolvedModelRulesView>
  extraHeaders?: Record<string, string>
  queryParams?: Record<string, string>
  notes?: string
}

export type CreateProviderInput = {
  presetId: string
  name: string
  apiKey: string
  authStrategy?: ProviderAuthStrategy
  baseUrl: string
  apiFormat?: ApiFormat
  runtimeKind?: ProviderRuntimeKind
  models: ProviderModel[]
  fastModel?: string
  modelOverrides?: ModelOverrides
  extraHeaders?: Record<string, string>
  queryParams?: Record<string, string>
  notes?: string
}

export type UpdateProviderInput = {
  name?: string
  apiKey?: string
  authStrategy?: ProviderAuthStrategy
  baseUrl?: string
  apiFormat?: ApiFormat
  runtimeKind?: ProviderRuntimeKind
  models?: ProviderModel[]
  fastModel?: string | null
  modelOverrides?: ModelOverrides
  extraHeaders?: Record<string, string> | null
  queryParams?: Record<string, string> | null
  notes?: string
}

export type ProviderSaveResult = {
  provider: SavedProvider
  modelDiscovery?: { ok: false; error: string }
}

export type TestProviderConfigInput = {
  baseUrl: string
  apiKey: string
  modelId: string
  authStrategy?: ProviderAuthStrategy
  apiFormat?: ApiFormat
}

export type DiscoverProviderModelsInput = {
  presetId?: string
  baseUrl: string
  apiKey: string
  authStrategy?: ProviderAuthStrategy
  apiFormat?: ApiFormat
}

export type ProviderTestStepResult = {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  httpStatus?: number
}

export type ProviderTestResult = {
  connectivity: ProviderTestStepResult
}
