import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ModelSelector } from './ModelSelector'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ModelInfo } from '../../types/settings'
import type { RuntimeSelection } from '../../types/runtime'

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

function mirrorRuntime(sessionId: string, selection: RuntimeSelection) {
  useChatStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [sessionId]: {
        ...state.getSession(sessionId),
        mirror: {
          id: sessionId,
          version: 1,
          permission: { desired: 'default', effective: 'default' },
          runtime: { desired: selection, effective: null },
          title: { text: null, source: null },
          workspace: { workDir: '/workspace/project', projectRoot: null, workDirExists: true },
          process: { phase: 'running', generation: 1 },
          turn: { phase: 'idle' },
          pendingPermissions: [],
          slashCommands: [],
          activeGoal: null,
          backgroundTasks: [],
          team: null,
          clientCount: 1,
        },
      },
    },
  }))
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useProviderStore.setState(useProviderStore.getInitialState(), true)
  useSessionRuntimeStore.setState(useSessionRuntimeStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
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
      availableModels: [
        { id: 'provider-main', name: 'provider-main', description: 'Main model', context: '' },
        { id: 'provider-fast', name: 'provider-fast', description: 'Haiku model', context: '' },
      ],
      currentModel: { id: 'provider-main', name: 'provider-main', description: '', context: '' },
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
        models: [{ id: 'provider-main' }, { id: 'provider-fast', name: 'Fast Display' }],
        fastModel: 'provider-fast',
      }],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)

    await clickByRole(/provider-main/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /provider-fast/ }))
      await Promise.resolve()
    })

    expect(useSessionRuntimeStore.getState().selections['session-1']).toBeUndefined()
    expect(setSessionRuntime).toHaveBeenCalledWith('session-1', {
      providerId: 'provider-a',
      modelId: 'provider-fast',
    })
  })

  it('sets the effort per session from the composer menu and shows it in the trigger', async () => {
    const setSessionRuntime = vi.fn((sessionId: string, selection: RuntimeSelection) => {
      mirrorRuntime(sessionId, selection)
    })
    const setEffort = vi.fn(async () => {})
    useSettingsStore.setState({
      locale: 'en',
      availableModels: [
        { id: 'provider-main', name: 'provider-main', description: 'Main model', context: '' },
      ],
      currentModel: { id: 'provider-main', name: 'provider-main', description: '', context: '' },
      activeProviderName: 'Provider A',
      effortLevel: 'medium',
      setEffort,
    })
    useProviderStore.setState({
      providers: [{
        id: 'provider-a',
        presetId: 'custom',
        name: 'Provider A',
        apiKey: '***',
        baseUrl: 'https://api.example.com',
        apiFormat: 'anthropic',
        models: [{ id: 'provider-main' }],
      }],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)

    expect(screen.getByRole('button', { name: 'provider-main · Medium' })).toBeInTheDocument()
    expect(screen.queryByText('Model Configuration')).not.toBeInTheDocument()

    await clickByRole('provider-main · Medium')
    expect(screen.queryByText('Model Configuration')).not.toBeInTheDocument()
    await clickByRole(/^High$/)

    expect(setEffort).not.toHaveBeenCalled()
    expect(useSessionRuntimeStore.getState().selections['session-1']).toBeUndefined()
    expect(setSessionRuntime).toHaveBeenCalledWith('session-1', {
      providerId: null,
      modelId: '',
      effort: 'high',
    })
    expect(screen.getByRole('button', { name: 'provider-main · High' })).toBeInTheDocument()
  })

  it('keeps an explicit model choice when only the effort changes', async () => {
    const setSessionRuntime = vi.fn()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: [
        { id: 'provider-main', name: 'provider-main', description: 'Main model', context: '' },
      ],
      currentModel: { id: 'provider-main', name: 'provider-main', description: '', context: '' },
      activeProviderName: 'Provider A',
      effortLevel: 'medium',
    })
    useProviderStore.setState({
      providers: [{
        id: 'provider-a',
        presetId: 'custom',
        name: 'Provider A',
        apiKey: '***',
        baseUrl: 'https://api.example.com',
        apiFormat: 'anthropic',
        models: [{ id: 'provider-main' }, { id: 'provider-fast' }],
      }],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    mirrorRuntime('session-2', { providerId: 'provider-a', modelId: 'provider-fast' })

    render(<ModelSelector runtimeKey="session-2" />)
    await clickByRole('provider-fast · Medium')
    await clickByRole(/^Max$/)

    expect(setSessionRuntime).toHaveBeenCalledWith('session-2', {
      providerId: 'provider-a',
      modelId: 'provider-fast',
      effort: 'max',
    })
  })

  it('lists models from every provider and marks the active provider as default', async () => {
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
      activeProviderName: 'Provider A',
    })
    useProviderStore.setState({
      providers: [
        {
          id: 'provider-a',
          presetId: 'custom',
          name: 'Provider A',
          apiKey: '***',
          baseUrl: 'https://api.example.com',
          apiFormat: 'anthropic',
          models: [{ id: 'provider-main', name: 'Main Display' }],
        },
        {
          id: 'provider-b',
          presetId: 'custom',
          name: 'Provider B',
          apiKey: '***',
          baseUrl: 'https://other.example.com',
          apiFormat: 'anthropic',
          models: [{ id: 'other-model', name: 'Other Display' }],
        },
      ],
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
    expect(dropdown.textContent).toContain('Provider B')
    expect(dropdown.textContent).toContain('Main Display')
    expect(dropdown.textContent).toContain('provider-main')
    expect(dropdown.textContent).toContain('Other Display')
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
