import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

async function chooseOption(combobox: HTMLElement, option: RegExp | string) {
  act(() => combobox.focus())
  fireEvent.keyDown(combobox, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
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
          pendingBrowserGrants: [],
          browserActivity: null,
          slashCommands: [],
          activeGoal: null,
          backgroundTasks: [],
          uiPages: [],
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

function seedProviders(models = [{ id: 'provider-main' }, { id: 'provider-fast', name: 'Fast Display' }]) {
  useSettingsStore.setState({
    locale: 'en',
    availableModels: MODELS,
    currentModel: { id: 'provider-main', name: 'provider-main', description: '', context: '' },
    activeProviderName: 'Provider A',
    effortLevel: 'medium',
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
        models,
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
}

describe('ModelSelector', () => {
  it('reports model and effort changes through onRuntimeSelectionChange without a runtime key', async () => {
    const onRuntimeSelectionChange = vi.fn()
    seedProviders()

    render(<ModelSelector onRuntimeSelectionChange={onRuntimeSelectionChange} />)

    await chooseOption(screen.getByRole('combobox', { name: /^Select model/ }), 'Fast Display')
    expect(onRuntimeSelectionChange).toHaveBeenLastCalledWith({ providerId: 'provider-a', modelId: 'provider-fast' })

    await chooseOption(screen.getByRole('combobox', { name: 'Effort: Medium' }), 'High')
    expect(onRuntimeSelectionChange).toHaveBeenLastCalledWith({ providerId: null, modelId: '', effort: 'high' })
  })

  it('names the model trigger after the selected model', () => {
    seedProviders()
    mirrorRuntime('session-name', { providerId: 'provider-a', modelId: 'provider-fast' })

    render(<ModelSelector runtimeKey="session-name" />)

    expect(screen.getByRole('combobox', { name: 'Select model: Fast Display' })).toBeInTheDocument()
  })

  it('selects provider-scoped runtime models and mirrors session selections', async () => {
    const setSessionRuntime = vi.fn()
    seedProviders()
    useChatStore.setState({ setSessionRuntime } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)

    await chooseOption(screen.getByRole('combobox', { name: /^Select model/ }), 'Fast Display')

    expect(useSessionRuntimeStore.getState().selections['session-1']).toBeUndefined()
    expect(setSessionRuntime).toHaveBeenCalledWith('session-1', {
      providerId: 'provider-a',
      modelId: 'provider-fast',
    })
  })

  it('picks the same model id under the provider that was clicked', async () => {
    const setSessionRuntime = vi.fn()
    seedProviders([{ id: 'shared' }])
    useProviderStore.setState((state) => ({
      providers: state.providers.map((provider) =>
        provider.id === 'provider-b' ? { ...provider, models: [{ id: 'shared' }] } : provider),
    }))
    useChatStore.setState({ setSessionRuntime } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)
    const combobox = screen.getByRole('combobox', { name: /^Select model/ })
    act(() => combobox.focus())
    fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    const group = await screen.findByRole('group', { name: /Provider B/ })
    fireEvent.click(within(group).getByRole('option', { name: 'shared' }))

    expect(setSessionRuntime).toHaveBeenCalledWith('session-1', { providerId: 'provider-b', modelId: 'shared' })
  })

  it('sets the effort per session from its own select and shows it in the trigger', async () => {
    const setSessionRuntime = vi.fn((sessionId: string, selection: RuntimeSelection) => {
      mirrorRuntime(sessionId, selection)
    })
    const setEffort = vi.fn(async () => {})
    seedProviders()
    useSettingsStore.setState({ setEffort })
    useChatStore.setState({ setSessionRuntime } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)

    expect(screen.getByRole('combobox', { name: /^Select model/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Effort: Medium' })).toHaveTextContent('Effort Medium')

    await chooseOption(screen.getByRole('combobox', { name: 'Effort: Medium' }), 'High')

    expect(setEffort).not.toHaveBeenCalled()
    expect(useSessionRuntimeStore.getState().selections['session-1']).toBeUndefined()
    expect(setSessionRuntime).toHaveBeenCalledWith('session-1', {
      providerId: null,
      modelId: '',
      effort: 'high',
    })
    expect(screen.getByRole('combobox', { name: 'Effort: High' })).toHaveTextContent('Effort High')
  })

  it('shortens the effort trigger in compact mode', () => {
    seedProviders()

    render(<ModelSelector runtimeKey="session-1" compact />)

    expect(screen.getByRole('combobox', { name: 'Effort: Medium' })).toHaveTextContent(/^Medium$/)
  })

  it('keeps an explicit model choice when only the effort changes', async () => {
    const setSessionRuntime = vi.fn()
    seedProviders()
    useChatStore.setState({ setSessionRuntime } as Partial<ReturnType<typeof useChatStore.getState>>)
    mirrorRuntime('session-2', { providerId: 'provider-a', modelId: 'provider-fast' })

    render(<ModelSelector runtimeKey="session-2" />)
    await chooseOption(screen.getByRole('combobox', { name: 'Effort: Medium' }), 'Max')

    expect(setSessionRuntime).toHaveBeenCalledWith('session-2', {
      providerId: 'provider-a',
      modelId: 'provider-fast',
      effort: 'max',
    })
  })

  it('keeps the effort when the model changes', async () => {
    const setSessionRuntime = vi.fn()
    seedProviders()
    useChatStore.setState({ setSessionRuntime } as Partial<ReturnType<typeof useChatStore.getState>>)
    mirrorRuntime('session-3', { providerId: 'provider-a', modelId: 'provider-main', effort: 'high' })

    render(<ModelSelector runtimeKey="session-3" />)
    await chooseOption(screen.getByRole('combobox', { name: /^Select model/ }), 'Fast Display')

    expect(setSessionRuntime).toHaveBeenCalledWith('session-3', {
      providerId: 'provider-a',
      modelId: 'provider-fast',
      effort: 'high',
    })
  })

  it('shows a selected model that is missing from its provider in the trigger', () => {
    seedProviders()
    mirrorRuntime('session-4', { providerId: 'provider-a', modelId: 'retired-model' })

    render(<ModelSelector runtimeKey="session-4" />)

    expect(screen.getByRole('combobox', { name: /^Select model/ })).toHaveTextContent('retired-model')
  })

  it('groups models by provider, labels the groups and marks the default provider', async () => {
    seedProviders()

    render(<ModelSelector runtimeKey="session-hide" />)
    const combobox = screen.getByRole('combobox', { name: /^Select model/ })
    act(() => combobox.focus())
    fireEvent.keyDown(combobox, { key: 'ArrowDown' })

    const groupA = await screen.findByRole('group', { name: /Provider A/ })
    const groupB = screen.getByRole('group', { name: /Provider B/ })
    expect(groupA).toHaveTextContent('Default')
    expect(groupB).not.toHaveTextContent('Default')
    expect(within(groupA).getAllByRole('option').map((option) => option.textContent)).toEqual(['provider-main', 'Fast Display'])
    expect(within(groupB).getAllByRole('option').map((option) => option.textContent)).toEqual(['Other Display'])
    expect(screen.queryByText('Claude Official')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'provider-main' })).toHaveAttribute('aria-selected', 'true')
  })

  it('disables both selects together', () => {
    seedProviders()

    render(<ModelSelector runtimeKey="session-1" disabled />)

    expect(screen.getByRole('combobox', { name: /^Select model/ })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Effort: Medium' })).toBeDisabled()
  })
})
