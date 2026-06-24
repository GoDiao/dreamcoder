import type { ApiFormat, ProviderAuthStrategy } from './provider'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  defaultModels: ModelMapping
  needsApiKey: boolean
  websiteUrl: string
  apiKeyUrl?: string
  promoText?: string
  featured?: boolean
  authStrategy?: ProviderAuthStrategy
  defaultEnv?: Record<string, string>
  modelContextWindows?: Record<string, number>
}
