import { api } from './client'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
  ProviderModel,
  ProviderSaveResult,
  DiscoverProviderModelsInput,
} from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'

type ProvidersResponse = { providers: SavedProvider[]; activeId: string | null }
type PresetsResponse = { presets: ProviderPreset[] }
type TestResultResponse = { result: ProviderTestResult }
type ModelsResponse = { models: ProviderModel[] }
type AuthStatusResponse = {
  hasAuth: boolean
  source: 'dreamcoder-provider' | 'original-settings' | 'env' | 'none'
  activeProvider?: string
}

export const providersApi = {
  list() {
    return api.get<ProvidersResponse>('/api/providers')
  },

  presets() {
    return api.get<PresetsResponse>('/api/providers/presets')
  },

  authStatus() {
    return api.get<AuthStatusResponse>('/api/providers/auth-status')
  },

  create(input: CreateProviderInput) {
    return api.post<ProviderSaveResult>('/api/providers', input)
  },

  update(id: string, input: UpdateProviderInput) {
    return api.put<ProviderSaveResult>(`/api/providers/${id}`, input)
  },

  delete(id: string) {
    return api.delete<{ ok: true }>(`/api/providers/${id}`)
  },

  refreshModels(id: string) {
    return api.post<ProviderSaveResult>(`/api/providers/${id}/refresh-models`)
  },

  activate(id: string) {
    return api.post<{ ok: true }>(`/api/providers/${id}/activate`)
  },

  test(id: string, overrides?: { baseUrl?: string; modelId?: string; apiFormat?: string; authStrategy?: string }) {
    return api.post<TestResultResponse>(`/api/providers/${id}/test`, overrides)
  },

  testConfig(input: TestProviderConfigInput) {
    return api.post<TestResultResponse>('/api/providers/test', input)
  },

  discoverModels(input: DiscoverProviderModelsInput) {
    return api.post<ModelsResponse>('/api/providers/models', input)
  },
}
