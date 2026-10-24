import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderPreset } from '../../types/providerPreset'
import type { ProviderModel, SavedProvider } from '../../types/provider'

const providersApiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  discoverModels: vi.fn(),
}))

vi.mock('../../api/providers.ts', () => ({
  providersApi: providersApiMock,
}))

import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ProviderFormModal } from './ProviderFormModal'

const deepseekPreset: ProviderPreset = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://example.invalid/anthropic',
  apiFormat: 'anthropic',
  defaultModels: [{ id: 'model-main' }],
  needsApiKey: true,
  websiteUrl: 'https://example.invalid',
}

const createdProvider: SavedProvider = {
  id: 'provider-1',
  presetId: 'deepseek',
  name: 'DeepSeek',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/anthropic',
  apiFormat: 'anthropic',
  models: [{ id: 'model-main' }],
}

const createProviderMock = vi.fn()
const updateProviderMock = vi.fn()
const discoverModelsMock = vi.fn()
const fetchAllMock = vi.fn()

describe('ProviderFormModal create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providersApiMock.getSettings.mockRejectedValue(new Error('no settings'))
    providersApiMock.updateSettings.mockResolvedValue(undefined)
    providersApiMock.discoverModels.mockResolvedValue({
      models: [{ id: 'model-new', name: 'New Model' }],
    })
    createProviderMock.mockResolvedValue(createdProvider)
    discoverModelsMock.mockResolvedValue([{ id: 'model-new', name: 'New Model' }])
    fetchAllMock.mockResolvedValue(undefined)
    useSettingsStore.setState({ locale: 'en', fetchAll: fetchAllMock })
    useProviderStore.setState(useProviderStore.getInitialState(), true)
    useProviderStore.setState({ createProvider: createProviderMock, discoverModels: discoverModelsMock })
  })

  async function fillAndSubmit() {
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: 'test-key' } })
    const addButtons = screen.getAllByRole('button', { name: 'Add' })
    const add = addButtons[addButtons.length - 1]!
    await waitFor(() => expect(add).toBeEnabled())
    await act(async () => {
      fireEvent.click(add)
    })
  }

  it('passes the created provider to onCreated before closing', async () => {
    const order: string[] = []
    const onCreated = vi.fn(async () => { order.push('created') })
    const onClose = vi.fn(() => { order.push('closed') })

    render(<ProviderFormModal open={true} onClose={onClose} mode="create" presets={[deepseekPreset]} onCreated={onCreated} />)
    await fillAndSubmit()

    expect(createProviderMock).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(createdProvider)
    expect(order).toEqual(['created', 'closed'])
  })

  it.each([
    { locale: 'en' as const, custom: 'Custom Provider' },
    { locale: 'zh' as const, custom: '自定义服务商' },
  ])('shows brand preset names as-is and localizes the custom entry in $locale', ({ locale, custom }) => {
    useSettingsStore.setState({ locale })
    const customPreset: ProviderPreset = { ...deepseekPreset, id: 'custom', name: 'Custom Provider', baseUrl: '' }

    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset, customPreset]} />)

    expect(screen.getByRole('button', { name: 'DeepSeek' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: custom }))
    expect(screen.getByDisplayValue(custom)).toBeInTheDocument()
  })

  it('shows a preset logo and a fallback icon on the preset buttons', () => {
    const customPreset: ProviderPreset = { ...deepseekPreset, id: 'custom', name: 'Custom Provider', baseUrl: '' }

    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset, customPreset]} />)

    const deepseekButton = screen.getByRole('button', { name: 'DeepSeek' })
    const customButton = screen.getByRole('button', { name: 'Custom Provider' })
    expect(deepseekButton.querySelector('[data-testid="provider-icon-deepseek"]')?.getAttribute('style'))
      .toContain('/icons/providers/deepseek.svg')
    expect(customButton.querySelector('[data-testid="provider-icon-fallback"]')).toBeInTheDocument()
  })

  it('still closes normally when no onCreated callback is given', async () => {
    const onClose = vi.fn()

    render(<ProviderFormModal open={true} onClose={onClose} mode="create" presets={[deepseekPreset]} />)
    await fillAndSubmit()

    expect(createProviderMock).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('filters discovered models by id or name without auto-selecting one', async () => {
    discoverModelsMock.mockResolvedValueOnce([
      { id: 'alpha-model', name: 'First Model' },
      { id: 'beta-model', name: 'Second Model' },
    ])
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    expect(input).toHaveValue('')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'SECOND' } })
    expect(screen.getByRole('option', { name: /Second Model/ })).toHaveTextContent('beta-model')
    expect(screen.queryByRole('option', { name: /First Model/ })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'ALPHA-MODEL' } })
    expect(screen.getByRole('option', { name: /First Model/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Second Model/ })).not.toBeInTheDocument()
  })

  it('picks a discovered model with the keyboard', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue('model-new')
    expect(screen.getByDisplayValue('New Model')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('saves a free-text model id exactly as typed', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Model ID' }), {
      target: { value: 'custom/model:v2' },
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!)
    await fillAndSubmit()

    expect(createProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      models: [{ id: 'model-main' }, { id: 'custom/model:v2' }],
    }))
  })

  it('keeps focus in the Model ID input when discovery finishes', async () => {
    let resolveDiscovery!: (models: ProviderModel[]) => void
    const pendingDiscovery = new Promise<ProviderModel[]>((resolve) => {
      resolveDiscovery = resolve
    })
    discoverModelsMock.mockReturnValueOnce(pendingDiscovery)
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    input.focus()
    expect(input).toHaveFocus()

    await act(async () => {
      resolveDiscovery([{ id: 'late-model' }])
      await pendingDiscovery
    })

    expect(input).toHaveFocus()
    expect(input).toHaveValue('')
  })
})

describe('ProviderFormModal edit mode', () => {
  const models = Array.from({ length: 5 }, (_, index) => ({
    id: `model-${index + 1}`,
    name: `Model ${index + 1}`,
  }))
  const provider: SavedProvider = {
    ...createdProvider,
    models,
    fastModel: 'model-5',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    providersApiMock.getSettings.mockResolvedValue({ skipWebFetchPreflight: true })
    providersApiMock.updateSettings.mockResolvedValue(undefined)
    updateProviderMock.mockResolvedValue(provider)
    discoverModelsMock.mockResolvedValue([
      { id: 'discovered-1' },
      { id: 'discovered-2' },
    ])
    fetchAllMock.mockResolvedValue(undefined)
    useSettingsStore.setState({ locale: 'en', fetchAll: fetchAllMock })
    useProviderStore.setState(useProviderStore.getInitialState(), true)
    useProviderStore.setState({
      updateProvider: updateProviderMock,
      discoverModels: discoverModelsMock,
    })
  })

  it('keeps generated model settings read-only while preserving unrelated JSON edits', async () => {
    const providerWithContext = {
      ...provider,
      modelContextWindows: { 'model-1': 32768 },
    }
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={providerWithContext} presets={[deepseekPreset]} />,
    )
    const textarea = document.querySelector('textarea')
    expect(textarea).not.toBeNull()
    await waitFor(() => expect(textarea!.value).toContain('ANTHROPIC_MODEL'))

    const settings = JSON.parse(textarea!.value) as { skipWebFetchPreflight: boolean; env: Record<string, string> }
    settings.skipWebFetchPreflight = false
    settings.env.ANTHROPIC_MODEL = 'changed-model'
    settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'changed-fast'
    settings.env.ANTHROPIC_SMALL_FAST_MODEL = 'changed-fast'
    settings.env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS = JSON.stringify({ 'model-1': 999999 })
    fireEvent.change(textarea!, { target: { value: JSON.stringify(settings, null, 2) } })
    const rewritten = JSON.parse(textarea!.value) as { skipWebFetchPreflight: boolean; env: Record<string, string> }
    expect(rewritten.skipWebFetchPreflight).toBe(false)
    expect(rewritten.env.ANTHROPIC_MODEL).toBe('model-1')
    expect(rewritten.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('model-5')
    expect(rewritten.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('model-5')
    expect(JSON.parse(rewritten.env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS!)).toEqual({ 'model-1': 32768 })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({
        models,
        fastModel: 'model-5',
        modelContextWindows: { 'model-1': 32768 },
      }),
    ))
    expect(providersApiMock.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      skipWebFetchPreflight: false,
    }))
  })

  it('fetches with the current edit form values and announces the result count', async () => {
    const localProvider = { ...provider, apiKey: '' }
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={localProvider} presets={[deepseekPreset]} />,
    )
    fireEvent.change(screen.getByDisplayValue(provider.baseUrl), {
      target: { value: 'http://127.0.0.1:11434' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })

    expect(discoverModelsMock).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://127.0.0.1:11434',
      apiKey: '',
    }))
    expect(screen.getByRole('status')).toHaveTextContent('2 models found')
  })

  it('clears discovered models when the connection changes and ignores stale responses', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('2 models found')
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    expect(input).toHaveValue('')
    fireEvent.focus(input)
    expect(screen.getByRole('option', { name: /discovered-1/ })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue(provider.baseUrl), {
      target: { value: 'https://new.example/anthropic' },
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(screen.queryByRole('option', { name: /discovered-1/ })).not.toBeInTheDocument()

    let resolveDiscovery!: (models: ProviderModel[]) => void
    const pendingDiscovery = new Promise<ProviderModel[]>((resolve) => {
      resolveDiscovery = resolve
    })
    discoverModelsMock.mockReturnValueOnce(pendingDiscovery)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    fireEvent.change(screen.getByDisplayValue('https://new.example/anthropic'), {
      target: { value: 'https://latest.example/anthropic' },
    })
    await act(async () => {
      resolveDiscovery([{ id: 'stale-model' }])
      await pendingDiscovery
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(screen.queryByRole('option', { name: /stale-model/ })).not.toBeInTheDocument()
  })

  it('resets discovery when a connection value changes in settings JSON', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('2 models found')
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    fireEvent.focus(input)
    expect(screen.getByRole('option', { name: /discovered-1/ })).toBeInTheDocument()

    let resolveDiscovery!: (models: ProviderModel[]) => void
    const pendingDiscovery = new Promise<ProviderModel[]>((resolve) => {
      resolveDiscovery = resolve
    })
    discoverModelsMock.mockReturnValueOnce(pendingDiscovery)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))

    const textarea = document.querySelector('textarea')
    expect(textarea).not.toBeNull()
    const settings = JSON.parse(textarea!.value) as { env: Record<string, string> }
    settings.env.ANTHROPIC_BASE_URL = 'https://json.example/anthropic'
    fireEvent.change(textarea!, { target: { value: JSON.stringify(settings, null, 2) } })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /discovered-1/ })).not.toBeInTheDocument()
    await act(async () => {
      resolveDiscovery([{ id: 'stale-json-model' }])
      await pendingDiscovery
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /stale-json-model/ })).not.toBeInTheDocument()
  })

  it('announces empty discovery results and exposes discovery errors as alerts', async () => {
    discoverModelsMock.mockResolvedValueOnce([])
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('No models returned')

    discoverModelsMock.mockRejectedValueOnce(new Error('discovery failed'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('discovery failed')
  })
})
