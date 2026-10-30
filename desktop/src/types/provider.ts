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

export type DiscoveredProviderModel = ProviderModel & { contextWindow?: number }

export type ModelContextWindows = Record<string, number>

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
  modelContextWindows?: ModelContextWindows
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
  modelContextWindows?: ModelContextWindows
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
  modelContextWindows?: ModelContextWindows | null
  notes?: string
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
