import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ModelSelector } from './ModelSelector'
import { useChatStore } from '../../stores/chatStore'
import { useProviderOAuthStore } from '../../stores/providerOAuthStore'
import { useProviderOpenAIOAuthStore } from '../../stores/providerOpenAIOAuthStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { OPENAI_OFFICIAL_PROVIDER_ID } from '../../constants/openaiOfficialProvider'
import type { ModelInfo } from '../../types/settings'

const MODELS: ModelInfo[] = [
  { id: 'alpha', name: 'Alpha', description: 'Fast model', context: '128k' },
  { id: 'beta', name: 'Beta', description: 'Careful model', context: '200k' },
]

async function clickByRole(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useProviderStore.setState(useProviderStore.getInitialState(), true)
  useSessionRuntimeStore.setState(useSessionRuntimeStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useProviderOAuthStore.setState(useProviderOAuthStore.getInitialState(), true)
  useProviderOpenAIOAuthStore.setState(useProviderOpenAIOAuthStore.getInitialState(), true)
})

// Prevent real API calls from fetchStatus on mount
beforeEach(() => {
  useProviderOAuthStore.setState({ fetchStatus: async () => {} })
  useProviderOpenAIOAuthStore.setState({ fetchStatus: async () => {} })
})

describe('ModelSelector', () => {
  it('uses controlled model selection without mutating settings directly', async () => {
    const onChange = vi.fn()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
    })

    render(<ModelSelector value="alpha" onChange={onChange} />)

    await clickByRole(/alpha/i)
    await clickByRole(/Beta/)

    expect(onChange).toHaveBeenCalledWith('beta')
  })

  it('routes uncontrolled model and effort changes through settings actions', async () => {
    const setModel = vi.fn(async () => {})
    const setEffort = vi.fn(async () => {})
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
      effortLevel: 'medium',
      setModel,
      setEffort,
    })

    render(<ModelSelector />)

    await clickByRole(/alpha/i)
    await clickByRole(/Beta/)
    expect(setModel).toHaveBeenCalledWith('beta')

    await clickByRole(/Alpha/)
    await clickByRole(/^High$/)
    expect(setEffort).toHaveBeenCalledWith('high')
  })

  it('selects provider-scoped runtime models and mirrors session selections', async () => {
    const setSessionRuntime = vi.fn()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
      activeProviderName: 'Provider A',
    })
    useProviderStore.setState({
      providers: [{
        id: 'provider-a',
        presetId: 'custom',
        name: 'Provider A',
        apiKey: '***',
        baseUrl: 'https://api.example.com',
        apiFormat: 'anthropic',
        models: {
          main: 'provider-main',
          haiku: 'provider-fast',
          sonnet: 'provider-main',
          opus: '',
        },
      }],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)

    await clickByRole(/alpha/i)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /provider-fast/ }))
      await Promise.resolve()
    })

    expect(useSessionRuntimeStore.getState().selections['session-1']).toEqual({
      providerId: 'provider-a',
      modelId: 'provider-fast',
    })
    expect(setSessionRuntime).toHaveBeenCalledWith('session-1', {
      providerId: 'provider-a',
      modelId: 'provider-fast',
    })
  })

  it('uses the ChatGPT Official catalog when that built-in provider is active', async () => {
    const openAIModels: ModelInfo[] = [
      {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        description: 'Best for coding and agentic work',
        context: '',
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        description: 'Latest general-purpose model',
        context: '',
      },
    ]
    const setSessionRuntime = vi.fn()
    useProviderOpenAIOAuthStore.setState({
      status: { loggedIn: true, expiresAt: null, email: null, accountId: null },
      fetchStatus: async () => {},
    })
    useSettingsStore.setState({
      locale: 'en',
      availableModels: openAIModels,
      currentModel: openAIModels[0],
      activeProviderName: 'ChatGPT Official',
    })
    useProviderStore.setState({
      providers: [],
      activeId: OPENAI_OFFICIAL_PROVIDER_ID,
      hasLoadedProviders: true,
      isLoading: true,
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-openai" />)

    await clickByRole(/GPT-5\.3 Codex/i)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /GPT-5\.5/ }))
      await Promise.resolve()
    })

    expect(useSessionRuntimeStore.getState().selections['session-openai']).toEqual({
      providerId: OPENAI_OFFICIAL_PROVIDER_ID,
      modelId: 'gpt-5.5',
    })
    expect(setSessionRuntime).toHaveBeenCalledWith('session-openai', {
      providerId: OPENAI_OFFICIAL_PROVIDER_ID,
      modelId: 'gpt-5.5',
    })
  })

  it('hides official provider sections when OAuth is not logged in', async () => {
    useProviderOAuthStore.setState({ status: { loggedIn: false }, fetchStatus: async () => {} })
    useProviderOpenAIOAuthStore.setState({ status: { loggedIn: false }, fetchStatus: async () => {} })
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
      activeProviderName: 'Provider A',
    })
    useProviderStore.setState({
      providers: [{
        id: 'provider-a',
        presetId: 'custom',
        name: 'Provider A',
        apiKey: '***',
        baseUrl: 'https://api.example.com',
        apiFormat: 'anthropic',
        models: {
          main: 'provider-main',
          haiku: '',
          sonnet: '',
          opus: '',
        },
      }],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })

    render(<ModelSelector runtimeKey="session-hide" />)

    await clickByRole(/alpha/i)

    const dropdown = screen.getByTestId('model-selector-dropdown')
    expect(dropdown.textContent).not.toContain('Claude Official')
    expect(dropdown.textContent).not.toContain('ChatGPT Official')
    expect(dropdown.textContent).toContain('Provider A')
  })

  it('portals the dropdown outside clipping containers and positions it below the trigger', async () => {
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
    })

    const { container } = render(
      <div data-testid="scroll-container" className="overflow-hidden">
        <ModelSelector value="alpha" onChange={vi.fn()} />
      </div>,
    )

    const trigger = screen.getByRole('button', { name: /alpha/i })
    Object.defineProperty(trigger.parentElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 120,
        right: 520,
        bottom: 150,
        left: 240,
        width: 280,
        height: 30,
        x: 240,
        y: 120,
        toJSON: () => {},
      }),
    })

    await act(async () => {
      fireEvent.click(trigger)
      await Promise.resolve()
    })

    const dropdown = screen.getByTestId('model-selector-dropdown')
    expect(container.contains(dropdown)).toBe(false)
    expect(document.body.contains(dropdown)).toBe(true)
    expect(dropdown.className).toContain('fixed')
    expect(dropdown.style.top).toBe('158px')
    expect(dropdown.style.left).toBe('160px')
    expect(dropdown.style.width).toBe('360px')
  })
})
