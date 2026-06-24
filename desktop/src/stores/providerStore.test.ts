import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedProvider } from '../types/provider'

const {
  providersApiMock,
  chatStoreState,
  runtimeStoreState,
  setSessionRuntimeMock,
  setSelectionMock,
  settingsSetModelMock,
  settingsFetchAllMock,
} = vi.hoisted(() => ({
  providersApiMock: {
    list: vi.fn(),
    presets: vi.fn(),
    authStatus: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    activate: vi.fn(),
    activateOfficial: vi.fn(),
    test: vi.fn(),
    testConfig: vi.fn(),
  },
  chatStoreState: {
    sessions: {} as Record<string, { connectionState: string; chatState: string }>,
    setSessionRuntime: vi.fn(),
  },
  runtimeStoreState: {
    selections: {} as Record<string, { providerId: string | null; modelId: string }>,
    setSelection: vi.fn(),
  },
  setSessionRuntimeMock: vi.fn(),
  setSelectionMock: vi.fn(),
  settingsSetModelMock: vi.fn(),
  settingsFetchAllMock: vi.fn(),
}))

vi.mock('../api/providers', () => ({
  providersApi: providersApiMock,
}))

vi.mock('./chatStore', () => ({
  useChatStore: {
    getState: () => ({
      ...chatStoreState,
      setSessionRuntime: setSessionRuntimeMock,
    }),
  },
}))

vi.mock('./sessionRuntimeStore', () => ({
  useSessionRuntimeStore: {
    getState: () => ({
      ...runtimeStoreState,
      setSelection: setSelectionMock,
    }),
  },
}))

vi.mock('./settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      setModel: settingsSetModelMock,
      fetchAll: settingsFetchAllMock,
    }),
  },
}))

function makeProvider(overrides: Partial<SavedProvider> = {}): SavedProvider {
  return {
    id: 'provider-a',
    presetId: 'custom',
    name: 'Provider A',
    apiKey: 'key-a',
    baseUrl: 'https://example.invalid/api',
    apiFormat: 'anthropic',
    models: {
      main: 'model-main',
      haiku: 'model-haiku',
      sonnet: 'model-sonnet',
      opus: 'model-opus',
    },
    ...overrides,
  }
}

describe('providerStore runtime refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatStoreState.sessions = {}
    runtimeStoreState.selections = {}
    providersApiMock.list.mockResolvedValue({ providers: [], activeId: null })
  })

  it('reapplies an updated active provider to idle connected sessions using default runtime', async () => {
    const provider = makeProvider()
    providersApiMock.update.mockResolvedValue({ provider })
    providersApiMock.list.mockResolvedValue({ providers: [provider], activeId: provider.id })
    chatStoreState.sessions = {
      'session-a': { connectionState: 'connected', chatState: 'idle' },
    }

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().updateProvider(provider.id, { apiKey: 'new-key' })

    expect(setSelectionMock).toHaveBeenCalledWith('session-a', {
      providerId: provider.id,
      modelId: 'model-main',
    })
    expect(setSessionRuntimeMock).toHaveBeenCalledWith('session-a', {
      providerId: provider.id,
      modelId: 'model-main',
    })
  })

  it('keeps an explicit provider model selection when the model still exists', async () => {
    const provider = makeProvider()
    providersApiMock.update.mockResolvedValue({ provider })
    providersApiMock.list.mockResolvedValue({ providers: [provider], activeId: null })
    chatStoreState.sessions = {
      'session-a': { connectionState: 'connected', chatState: 'idle' },
    }
    runtimeStoreState.selections = {
      'session-a': { providerId: provider.id, modelId: 'model-opus' },
    }

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().updateProvider(provider.id, { apiKey: 'new-key' })

    expect(setSessionRuntimeMock).toHaveBeenCalledWith('session-a', {
      providerId: provider.id,
      modelId: 'model-opus',
    })
  })

  it('does not restart busy sessions while a provider update is saved', async () => {
    const provider = makeProvider()
    providersApiMock.update.mockResolvedValue({ provider })
    providersApiMock.list.mockResolvedValue({ providers: [provider], activeId: provider.id })
    chatStoreState.sessions = {
      'session-a': { connectionState: 'connected', chatState: 'streaming' },
      'session-b': { connectionState: 'disconnected', chatState: 'idle' },
    }

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().updateProvider(provider.id, { apiKey: 'new-key' })

    expect(setSelectionMock).not.toHaveBeenCalled()
    expect(setSessionRuntimeMock).not.toHaveBeenCalled()
  })

  it('sets the OpenAI default model when activating built-in ChatGPT Official', async () => {
    providersApiMock.activate.mockResolvedValue({ ok: true })
    providersApiMock.list.mockResolvedValue({
      providers: [],
      activeId: 'openai-official',
    })

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().activateProvider('openai-official')

    expect(settingsSetModelMock).toHaveBeenCalledWith('gpt-5.3-codex')
    expect(settingsFetchAllMock).toHaveBeenCalled()
  })

  it('sets the provider main model when activating a saved provider', async () => {
    const provider = makeProvider()
    providersApiMock.activate.mockResolvedValue({ ok: true })
    providersApiMock.list.mockResolvedValue({
      providers: [provider],
      activeId: provider.id,
    })

    const { useProviderStore } = await import('./providerStore')
    await useProviderStore.getState().activateProvider(provider.id)

    expect(settingsSetModelMock).toHaveBeenCalledWith('model-main')
    expect(settingsFetchAllMock).toHaveBeenCalled()
  })
})
