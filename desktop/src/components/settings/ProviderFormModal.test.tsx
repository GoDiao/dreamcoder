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

  it('recommends the first fetched model in the styled picker and saves it', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: 'test-key' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    await waitFor(() => expect(screen.getByLabelText('Model ID')).toHaveValue('model-new'))
    await waitFor(() => expect(screen.getByDisplayValue('New Model')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Model ID'))
    expect(screen.getByRole('button', { name: /New Model/ })).toHaveTextContent('model-new')

    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!)
    await fillAndSubmit()

    expect(createProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      models: [{ id: 'model-main' }, { id: 'model-new', name: 'New Model' }],
    }))
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

  it('preserves all named model rows when an unrelated settings JSON key changes', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )
    const textarea = document.querySelector('textarea')
    expect(textarea).not.toBeNull()
    await waitFor(() => expect(textarea!.value).toContain('skipWebFetchPreflight'))

    const settings = JSON.parse(textarea!.value) as Record<string, unknown>
    settings.skipWebFetchPreflight = false
    fireEvent.change(textarea!, { target: { value: JSON.stringify(settings, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({ models }),
    ))
  })

  it('merges changed runtime model IDs without dropping existing named rows', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )
    const textarea = document.querySelector('textarea')
    expect(textarea).not.toBeNull()
    await waitFor(() => expect(textarea!.value).toContain('ANTHROPIC_MODEL'))

    const settings = JSON.parse(textarea!.value) as { env: Record<string, string> }
    settings.env.ANTHROPIC_MODEL = 'model-3'
    settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'model-4'
    settings.env.ANTHROPIC_SMALL_FAST_MODEL = 'model-4'
    fireEvent.change(textarea!, { target: { value: JSON.stringify(settings, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({
        models: [models[2], models[0], models[1], models[3], models[4]],
        fastModel: 'model-4',
      }),
    ))
  })

  it('merges progressive settings JSON model edits against the focus snapshot', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )
    const textarea = document.querySelector('textarea')
    expect(textarea).not.toBeNull()
    await waitFor(() => expect(textarea!.value).toContain('ANTHROPIC_MODEL'))

    fireEvent.focus(textarea!)
    for (const modelId of ['g', 'gp', 'gpt']) {
      const settings = JSON.parse(textarea!.value) as { env: Record<string, string> }
      settings.env.ANTHROPIC_MODEL = modelId
      fireEvent.change(textarea!, { target: { value: JSON.stringify(settings, null, 2) } })
    }
    fireEvent.blur(textarea!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({
        models: [{ id: 'gpt' }, ...models],
      }),
    ))
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
    expect(screen.getByLabelText('Model ID')).toHaveValue('discovered-1')
    fireEvent.click(screen.getByLabelText('Model ID'))
    expect(screen.getByRole('button', { name: /discovered-1/ })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue(provider.baseUrl), {
      target: { value: 'https://new.example/anthropic' },
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Model ID')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /discovered-1/ })).not.toBeInTheDocument()

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
    expect(screen.getByLabelText('Model ID')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /stale-model/ })).not.toBeInTheDocument()
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
