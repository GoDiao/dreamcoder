import { api } from './client'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
  DiscoveredProviderModel,
  DiscoverProviderModelsInput,
  SavedDecisionProvider,
  DecisionProviderPreset,
  CreateDecisionProviderInput,
  UpdateDecisionProviderInput,
  TestDecisionProviderInput,
  DiscoverDecisionProviderModelsInput,
} from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'

type ProvidersResponse = { providers: SavedProvider[]; activeId: string | null }
type ProviderResponse = { provider: SavedProvider }
type PresetsResponse = { presets: ProviderPreset[] }
type TestResultResponse = { result: ProviderTestResult }
type ModelsResponse = { models: DiscoveredProviderModel[] }
type AuthStatusResponse = {
  hasAuth: boolean
  source: 'dreamcoder-provider' | 'original-settings' | 'env' | 'none'
  activeProvider?: string
}
type DecisionProvidersResponse = { providers: SavedDecisionProvider[]; activeId: string | null }
type DecisionProviderResponse = { provider: SavedDecisionProvider }
type DecisionPresetsResponse = { presets: DecisionProviderPreset[] }

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

  getSettings() {
    return api.get<Record<string, unknown>>('/api/providers/settings')
  },

  updateSettings(settings: Record<string, unknown>) {
    return api.put<{ ok: true }>('/api/providers/settings', settings)
  },

  create(input: CreateProviderInput) {
    return api.post<ProviderResponse>('/api/providers', input)
  },

  update(id: string, input: UpdateProviderInput) {
    return api.put<ProviderResponse>(`/api/providers/${id}`, input)
  },

  delete(id: string) {
    return api.delete<{ ok: true }>(`/api/providers/${id}`)
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

  listDecisions() {
    return api.get<DecisionProvidersResponse>('/api/providers/decisions')
  },

  decisionPresets() {
    return api.get<DecisionPresetsResponse>('/api/providers/decisions/presets')
  },

  createDecision(input: CreateDecisionProviderInput) {
    return api.post<DecisionProviderResponse>('/api/providers/decisions', input)
  },

  updateDecision(id: string, input: UpdateDecisionProviderInput) {
    return api.put<DecisionProviderResponse>(`/api/providers/decisions/${id}`, input)
  },

  deleteDecision(id: string) {
    return api.delete<{ ok: true }>(`/api/providers/decisions/${id}`)
  },

  activateDecision(id: string) {
    return api.post<{ ok: true }>(`/api/providers/decisions/${id}/activate`)
  },

  testDecision(id: string, modelId?: string) {
    return api.post<TestResultResponse>(`/api/providers/decisions/${id}/test`, { modelId })
  },

  testDecisionConfig(input: TestDecisionProviderInput) {
    return api.post<TestResultResponse>('/api/providers/decisions/test', input)
  },

  discoverDecisionModels(input: DiscoverDecisionProviderModelsInput) {
    return api.post<ModelsResponse>('/api/providers/decisions/models', input)
  },
}
