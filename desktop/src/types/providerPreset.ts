import type { ApiFormat, ProviderAuthStrategy, ProviderModel } from './provider'

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  defaultModels: ProviderModel[]
  defaultFastModel?: string
  needsApiKey: boolean
  websiteUrl: string
  apiKeyUrl?: string
  authStrategy?: ProviderAuthStrategy
  defaultEnv?: Record<string, string>
  modelContextWindows?: Record<string, number>
}
