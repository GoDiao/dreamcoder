import { create } from 'zustand'
import { providersApi } from '../api/providers'
import type {
  CreateDecisionProviderInput,
  DecisionProviderPreset,
  DiscoverDecisionProviderModelsInput,
  DiscoveredProviderModel,
  ProviderTestResult,
  SavedDecisionProvider,
  TestDecisionProviderInput,
  UpdateDecisionProviderInput,
} from '../types/provider'

type DecisionProviderStore = {
  providers: SavedDecisionProvider[]
  presets: DecisionProviderPreset[]
  isLoading: boolean
  error: string | null
  fetchProviders: () => Promise<void>
  fetchPresets: () => Promise<void>
  createProvider: (input: CreateDecisionProviderInput) => Promise<SavedDecisionProvider>
  updateProvider: (id: string, input: UpdateDecisionProviderInput) => Promise<SavedDecisionProvider>
  deleteProvider: (id: string) => Promise<void>
  testProvider: (id: string, modelId?: string) => Promise<ProviderTestResult>
  testConfig: (input: TestDecisionProviderInput) => Promise<ProviderTestResult>
  discoverModels: (input: DiscoverDecisionProviderModelsInput) => Promise<DiscoveredProviderModel[]>
}

export const useDecisionProviderStore = create<DecisionProviderStore>((set, get) => ({
  providers: [],
  presets: [],
  isLoading: false,
  error: null,

  fetchProviders: async () => {
    set({ isLoading: true, error: null })
    try {
      const { providers } = await providersApi.listDecisions()
      set({ providers, isLoading: false })
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  fetchPresets: async () => {
    try {
      const { presets } = await providersApi.decisionPresets()
      set({ presets })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  createProvider: async (input) => {
    const { provider } = await providersApi.createDecision(input)
    await get().fetchProviders()
    return provider
  },

  updateProvider: async (id, input) => {
    const { provider } = await providersApi.updateDecision(id, input)
    await get().fetchProviders()
    return provider
  },

  deleteProvider: async (id) => {
    await providersApi.deleteDecision(id)
    await get().fetchProviders()
  },

  testProvider: async (id, modelId) => {
    const { result } = await providersApi.testDecision(id, modelId)
    return result
  },

  testConfig: async (input) => {
    const { result } = await providersApi.testDecisionConfig(input)
    return result
  },

  discoverModels: async (input) => {
    const { models } = await providersApi.discoverDecisionModels(input)
    return models
  },
}))
