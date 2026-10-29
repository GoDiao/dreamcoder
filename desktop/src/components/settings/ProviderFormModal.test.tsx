import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderPreset } from '../../types/providerPreset'
import type { ProviderModel, DiscoveredProviderModel, SavedProvider } from '../../types/provider'

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

const deepseekPresetWithFast: ProviderPreset = {
  ...deepseekPreset,
  defaultModels: [{ id: 'model-main' }, { id: 'model-fast' }],
  defaultFastModel: 'model-fast',
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

const originalProviderState = useProviderStore.getState()
const originalSettingsState = useSettingsStore.getState()

afterEach(() => {
  useProviderStore.setState(originalProviderState, true)
  useSettingsStore.setState(originalSettingsState, true)
})

describe('ProviderFormModal create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providersApiMock.getSettings.mockResolvedValue({})
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

  it('ignores settings responses from a previously selected preset', async () => {
    let resolvePrevious!: (settings: Record<string, unknown>) => void
    providersApiMock.getSettings.mockReturnValueOnce(new Promise((resolve) => { resolvePrevious = resolve }))
    providersApiMock.getSettings.mockResolvedValueOnce({ env: { CUSTOM_SETTING: 'current' } })
    const other: ProviderPreset = { ...deepseekPreset, id: 'other', name: 'Other', baseUrl: 'https://other.invalid' }
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset, other]} />)
    await waitFor(() => expect(providersApiMock.getSettings).toHaveBeenCalledTimes(1))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Other' })) })
    await waitFor(() => expect(document.querySelector('textarea')?.value).toContain('current'))
    await act(async () => { resolvePrevious({ env: { CUSTOM_SETTING: 'stale' } }) })
    const settings = JSON.parse(document.querySelector('textarea')!.value)
    expect(settings.env.CUSTOM_SETTING).toBe('current')
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://other.invalid')
  })

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
    discoverModelsMock.mockResolvedValueOnce([
      { id: 'model-old', name: 'Old Model' },
      { id: 'model-new', name: 'New Model' },
    ])
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
    expect(screen.queryByRole('listbox', { name: 'Model ID' })).not.toBeInTheDocument()
  })

  it('keeps typed text that prefixes a listed model when Enter is pressed', async () => {
    discoverModelsMock.mockResolvedValueOnce([{ id: 'model-new-large', name: 'New Large Model' }])
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'model-new' } })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Use "model-new"')
    expect(options[1]).toHaveTextContent('New Large Model')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue('model-new')
    expect(screen.queryByDisplayValue('New Large Model')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Model ID' })).not.toBeInTheDocument()
  })

  it('does not offer the typed id when it already matches a listed model', async () => {
    discoverModelsMock.mockResolvedValueOnce([
      { id: 'model-new-large', name: 'New Large Model' },
      { id: 'model-new', name: 'New Model' },
    ])
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'model-new' } })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('New Model')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue('model-new')
    expect(screen.getByDisplayValue('New Model')).toBeInTheDocument()
  })

  it('closes the model suggestions instead of the modal when Escape reaches an option', async () => {
    const onClose = vi.fn()
    render(<ProviderFormModal open={true} onClose={onClose} mode="create" presets={[deepseekPreset]} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    const input = screen.getByRole('combobox', { name: 'Model ID' })
    fireEvent.focus(input)
    const option = screen.getByRole('option', { name: /New Model/ })

    fireEvent.keyDown(option, { key: 'Escape' })

    expect(screen.queryByRole('listbox', { name: 'Model ID' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
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

  it('waits for settings before saving and preserves unrelated environment values', async () => {
    let resolveSettings!: (settings: Record<string, unknown>) => void
    providersApiMock.getSettings.mockReturnValueOnce(new Promise((resolve) => { resolveSettings = resolve }))
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />)
    const save = screen.getByRole('button', { name: 'Save' })
    await waitFor(() => expect(providersApiMock.getSettings).toHaveBeenCalledTimes(1))
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(providersApiMock.updateSettings).not.toHaveBeenCalled()
    expect(updateProviderMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Context window for model-1'), { target: { value: '64000' } })
    await act(async () => { resolveSettings({ env: { CUSTOM_SETTING: 'preserve' } }) })
    expect(save).toBeEnabled()
    await act(async () => { fireEvent.click(save) })
    expect(providersApiMock.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({
      CUSTOM_SETTING: 'preserve', CLAUDE_CODE_MODEL_CONTEXT_WINDOWS: JSON.stringify({ 'model-1': 64000 }),
    }) }))
    expect(updateProviderMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['en', 'Save', 'Could not load settings. Close this form and try again.'],
    ['zh', '保存', '无法加载设置，请关闭表单后重试。'],
  ] as const)('blocks saving after settings fail to load in %s', async (locale, saveLabel, error) => {
    useSettingsStore.setState({ locale })
    providersApiMock.getSettings.mockRejectedValueOnce(new Error('offline'))
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(error)
    const save = screen.getByRole('button', { name: saveLabel })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(providersApiMock.updateSettings).not.toHaveBeenCalled()
    expect(updateProviderMock).not.toHaveBeenCalled()
  })

  it.each([
    ['en', 'light', 'Context window for model-1', /Auto-compact/],
    ['zh', 'dark', 'model-1 的上下文窗口', /自动压缩/],
  ] as const)('shows context inputs in model rows in %s with the %s theme and no auto-compact settings', (locale, theme, label, section) => {
    useSettingsStore.setState({ locale, theme })
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />)
    const input = screen.getByLabelText(label)
    expect(input).toBeVisible()
    expect(input.closest('div.flex-wrap')).toHaveTextContent('model-1')
    expect(screen.getAllByPlaceholderText(locale === 'en' ? 'e.g. 200000' : '例如 200000')).toHaveLength(models.length)
    expect(screen.queryByRole('button', { name: section })).not.toBeInTheDocument()
  })

  it('fills only empty rows, preserves saved and pending typed values, and saves the row windows', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={{ ...provider, modelContextWindows: { 'model-1': 64000 } }} presets={[deepseekPreset]} />)
    await waitFor(() => expect(document.querySelector('textarea')?.value).toContain('ANTHROPIC_MODEL'))
    let resolveDiscovery!: (models: DiscoveredProviderModel[]) => void
    discoverModelsMock.mockReturnValueOnce(new Promise<DiscoveredProviderModel[]>((resolve) => { resolveDiscovery = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    fireEvent.change(screen.getByLabelText('Context window for model-2'), { target: { value: '96000' } })
    const fetched = models.map((model) => ({ ...model, contextWindow: 131072 }))
    await act(async () => { resolveDiscovery(fetched) })
    expect(screen.getByLabelText('Context window for model-1')).toHaveValue('64000')
    expect(screen.getByLabelText('Context window for model-2')).toHaveValue('96000')
    expect(screen.getByLabelText('Context window for model-3')).toHaveValue('131072')
    fireEvent.change(screen.getByLabelText('Context window for model-4'), { target: { value: '' } })
    discoverModelsMock.mockResolvedValueOnce(fetched.map((model) => ({ ...model, contextWindow: 262144 })))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fetch models' })) })
    expect(screen.getByLabelText('Context window for model-2')).toHaveValue('96000')
    expect(screen.getByLabelText('Context window for model-3')).toHaveValue('131072')
    expect(screen.getByLabelText('Context window for model-4')).toHaveValue('262144')
    const windows = { 'model-1': 64000, 'model-2': 96000, 'model-3': 131072, 'model-4': 262144, 'model-5': 131072 }
    expect(JSON.parse(document.querySelector('textarea')!.value).env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS).toBe(JSON.stringify(windows))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProviderMock).toHaveBeenCalledWith(provider.id, expect.objectContaining({ models, modelContextWindows: windows }))
  })

  it('requests native metadata for the selected LM Studio preset', async () => {
    const preset: ProviderPreset = { ...deepseekPreset, id: 'lmstudio', name: 'LM Studio', needsApiKey: false }
    discoverModelsMock.mockResolvedValueOnce([{ id: 'model-1', contextWindow: 131072 }])
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={{ ...provider, presetId: 'lmstudio' }} presets={[preset]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fetch models' })) })
    expect(discoverModelsMock).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'lmstudio' }))
    expect(screen.getByLabelText('Context window for model-1')).toHaveValue('131072')
  })

  it('fills a newly added discovered model and keeps preset context windows', async () => {
    discoverModelsMock.mockResolvedValueOnce([
      { id: 'model-new', name: 'New Model', contextWindow: 131072 },
      { id: 'preset-model', contextWindow: 262144 },
    ])
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[{ ...deepseekPreset, modelContextWindows: { 'preset-model': 64000 } }]} />)
    await waitFor(() => expect(document.querySelector('textarea')?.value).toContain('ANTHROPIC_MODEL'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fetch models' })) })
    fireEvent.focus(screen.getByRole('combobox', { name: 'Model ID' }))
    fireEvent.click(screen.getByRole('option', { name: /New Model/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('Context window for model-new')).toHaveValue('131072')
    fireEvent.change(screen.getByRole('combobox', { name: 'Model ID' }), { target: { value: 'preset-model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('Context window for preset-model')).toHaveValue('64000')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProviderMock).toHaveBeenCalledWith(provider.id, expect.objectContaining({
      modelContextWindows: { 'model-new': 131072, 'preset-model': 64000 },
      models: [...models, { id: 'model-new', name: 'New Model' }, { id: 'preset-model' }],
    }))
  })

  it('shows the save error and keeps the modal open when saving fails', async () => {
    updateProviderMock.mockRejectedValue(new Error('Base URL is invalid'))
    const onClose = vi.fn()
    render(
      <ProviderFormModal open={true} onClose={onClose} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Could not save: Base URL is invalid')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    updateProviderMock.mockResolvedValue(provider)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Could not save/)).not.toBeInTheDocument()
  })

  it('does not restore the preset fast model when editing a provider without one', async () => {
    const providerWithoutFast: SavedProvider = {
      ...provider,
      models: [{ id: 'model-main' }],
      fastModel: undefined,
    }
    render(
      <ProviderFormModal
        open={true}
        onClose={vi.fn()}
        mode="edit"
        provider={providerWithoutFast}
        presets={[deepseekPresetWithFast]}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Fast model' })).toHaveTextContent('Use selected model')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      providerWithoutFast.id,
      expect.objectContaining({ fastModel: null }),
    ))
  })

  it('labels the API format and auth variable selects', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />)

    const apiFormat = screen.getByRole('combobox', { name: 'API Format' })
    const authStrategy = screen.getByRole('combobox', { name: 'Auth Variable' })
    expect(apiFormat).toHaveTextContent('Anthropic Messages (native)')
    expect(screen.getByLabelText('API Format')).toBe(apiFormat)
    expect(screen.getByLabelText('Auth Variable')).toBe(authStrategy)
    expect(authStrategy).toHaveTextContent('Bearer Token (ANTHROPIC_AUTH_TOKEN)')
    expect(authStrategy).toHaveAccessibleDescription('Most third-party Anthropic-compatible services using Authorization Bearer.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  })

  it('enables saving after deleting a model with an invalid context window', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Model ID' }), {
      target: { value: 'test-b' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('Context window for test-b'), { target: { value: '1' } })

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!)

    expect(screen.queryByText('Must be between 16000 and 10000000.')).not.toBeInTheDocument()
    await waitFor(() => expect(save).toBeEnabled())
  })

  it('saves the reordered model list and generated main model', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )
    await waitFor(() => expect(document.querySelector('textarea')?.value).toContain('ANTHROPIC_MODEL'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Move model up' })[1]!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const reordered = [models[1], models[0], ...models.slice(2)]
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({ models: reordered }),
    ))
    expect(providersApiMock.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ ANTHROPIC_MODEL: 'model-2' }),
    }))
  })

  it('clears the fast model when its row is deleted', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({
        models: models.slice(0, -1),
        fastModel: null,
      }),
    ))
  })

  it('clears the fast model when current selected model is chosen', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Fast model' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Use selected model' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({ fastModel: null }),
    ))
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

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
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

  it('asks to fetch models again after the API format changes until a fetch succeeds', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )
    const hint = 'Model IDs can differ between API formats. Fetch models again and check the list below.'
    expect(screen.queryByText(hint)).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'API Format' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: /OpenAI Chat Completions/ }))
    expect(screen.getByText(hint)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    })
    expect(discoverModelsMock).toHaveBeenCalledWith(expect.objectContaining({ apiFormat: 'openai_chat' }))
    expect(screen.queryByText(hint)).not.toBeInTheDocument()
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
