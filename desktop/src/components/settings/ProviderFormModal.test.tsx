import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderPreset } from '../../types/providerPreset'
import type { ProviderModel, SavedProvider } from '../../types/provider'
import { resolvedView } from './resolvedViewFixture'

const providersApiMock = vi.hoisted(() => ({
  discoverModels: vi.fn(),
}))

vi.mock('../../api/providers.ts', () => ({
  providersApi: providersApiMock,
}))

import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
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
const originalUIState = useUIStore.getState()

afterEach(() => {
  useProviderStore.setState(originalProviderState, true)
  useSettingsStore.setState(originalSettingsState, true)
  useUIStore.setState(originalUIState, true)
})

describe('ProviderFormModal create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providersApiMock.discoverModels.mockResolvedValue({
      models: [{ id: 'model-new', name: 'New Model' }],
    })
    createProviderMock.mockResolvedValue({ provider: createdProvider })
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
  const pendingProvider: SavedProvider = { ...provider, resolvedModels: {} }
  const resolvedProvider: SavedProvider = {
    ...provider,
    apiFormat: 'openai_chat',
    resolvedModels: {
      'model-1': resolvedView({}),
      'model-2': resolvedView({
        contextWindow: 200000,
        maxOutputTokens: 32000,
        reasoning: { control: 'none' },
        effortLevels: [],
        appliedEffort: undefined,
        usedFallback: true,
        sources: { contextWindow: 'fallback', maxOutputTokens: 'fallback', reasoning: 'fallback', image: 'fallback', pdf: 'fallback', structuredOutput: 'fallback' },
      }),
    },
  }
  const refreshProviderModelsMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    updateProviderMock.mockResolvedValue({ provider })
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
      refreshProviderModels: refreshProviderModelsMock,
    })
  })

  it.each([
    ['en', 'light', 'Model settings for model-1', 'Context window for model-1', /Auto-compact/],
    ['zh', 'dark', 'model-1 的模型设置', 'model-1 的上下文窗口', /自动压缩/],
  ] as const)('opens the per-model editor in %s with the %s theme and no auto-compact settings', (locale, theme, toggle, label, section) => {
    useSettingsStore.setState({ locale, theme })
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={resolvedProvider} presets={[deepseekPreset]} />)
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: toggle }))
    const input = screen.getByLabelText(label)
    expect(input).toBeVisible()
    expect(screen.getByRole('button', { name: toggle })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: section })).not.toBeInTheDocument()
  })

  it('hides the model rules for a saved provider the server gives no rules, such as the official Anthropic API', () => {
    const official: SavedProvider = { ...provider, baseUrl: 'https://api.anthropic.com', apiFormat: 'anthropic' }
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={official} presets={[deepseekPreset]} />)
    expect(screen.queryByRole('button', { name: 'Model settings for model-1' })).not.toBeInTheDocument()
    expect(screen.queryByText('Model information appears after saving.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh model info' })).not.toBeInTheDocument()
  })

  it('summarizes the resolved rules on each card and marks models on the generic defaults', () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={resolvedProvider} presets={[deepseekPreset]} />)
    expect(screen.getByTestId('model-rules-summary-model-1')).toHaveTextContent('Window 1,048,576 · Output 65,536 · Thinking Low, High, Max · Images No · PDF No')
    expect(screen.getByTestId('model-rules-summary-model-2')).toHaveTextContent('Thinking No thinking')
    expect(screen.getByTestId('model-card-model-2')).toHaveTextContent('Uses generic defaults')
    expect(screen.getByTestId('model-card-model-1')).not.toHaveTextContent('Uses generic defaults')
  })

  it('shows a saved thinking override as the server resolved it, and the values it replaced', () => {
    const inheritedRules = resolvedView({
      reasoning: { control: 'effort' },
      effortLevels: ['low', 'medium', 'high'],
      sources: { contextWindow: 'model', maxOutputTokens: 'model', reasoning: 'model', image: 'model', pdf: 'model', structuredOutput: 'model' },
    })
    const overridden: SavedProvider = {
      ...resolvedProvider,
      modelOverrides: { 'model-1': { reasoningLevels: [], image: true } },
      resolvedModels: {
        ...resolvedProvider.resolvedModels,
        'model-1': {
          ...inheritedRules,
          reasoning: { control: 'always' },
          effortLevels: [],
          appliedEffort: undefined,
          image: true,
          sources: { ...inheritedRules.sources, reasoning: 'user', image: 'user' },
          inherited: inheritedRules.inherited,
        },
      },
    }
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={overridden} presets={[deepseekPreset]} />)
    expect(screen.getByTestId('model-rules-summary-model-1')).toHaveTextContent('Thinking Always on')
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    const editor = screen.getByTestId('model-rules-editor-model-1')
    expect(editor).toHaveTextContent('Default: Low, Medium, High (built-in)')
    expect(editor).toHaveTextContent('Default: No (built-in)')
  })

  it('starts the thinking choice from the default levels, so one click removes a level', () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={resolvedProvider} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    const thinking = screen.getByRole('toolbar', { name: 'Thinking for model-1' })
    const pressed = () => within(thinking).getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent)
    expect(pressed()).toEqual(['Low', 'High', 'Max'])
    expect(screen.getByRole('button', { name: 'Restore default: Thinking' })).toBeDisabled()
    fireEvent.click(within(thinking).getByRole('button', { name: 'High' }))
    expect(pressed()).toEqual(['Low', 'Max'])
    expect(screen.getByTestId('model-rules-summary-model-1')).toHaveTextContent('Thinking Low, Max')
    fireEvent.click(within(thinking).getByRole('button', { name: 'High' }))
    expect(screen.getByRole('button', { name: 'Restore default: Thinking' })).toBeDisabled()
  })

  it('groups the digits of an overridden number and saves the plain number', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={resolvedProvider} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    fireEvent.change(screen.getByLabelText('Context window for model-1'), { target: { value: '200000' } })
    expect(screen.getByLabelText('Context window for model-1')).toHaveValue('200,000')
    fireEvent.change(screen.getByLabelText('Context window for model-1'), { target: { value: '200,0001' } })
    expect(screen.getByLabelText('Context window for model-1')).toHaveValue('2,000,001')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProviderMock).toHaveBeenCalledWith(provider.id, expect.objectContaining({
      modelOverrides: { 'model-1': { contextWindow: 2000001 } },
    }))
  })

  it('shows the inherited values and where they come from', () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={resolvedProvider} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    expect(screen.getByLabelText('Context window for model-1')).toHaveAttribute('placeholder', '1,048,576 · built-in')
    expect(screen.getByLabelText('Max output tokens for model-1')).toHaveAttribute('placeholder', '65,536 · provider API')
    const editor = screen.getByTestId('model-rules-editor-model-1')
    expect(editor).toHaveTextContent('Default: Low, High, Max (built-in)')
    expect(editor).toHaveTextContent('Default: No (generic default)')
    expect(screen.getByRole('toolbar', { name: 'Thinking for model-1' })).toBeInTheDocument()
  })

  it('labels values that come from models.dev', () => {
    const fromModelsDev: SavedProvider = {
      ...resolvedProvider,
      resolvedModels: {
        'model-1': resolvedView({
          sources: { contextWindow: 'modelsDev', maxOutputTokens: 'modelsDev', reasoning: 'modelsDev', image: 'fallback', pdf: 'modelsDev', structuredOutput: 'modelsDev' },
        }),
      },
    }
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={fromModelsDev} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    expect(screen.getByLabelText('Context window for model-1')).toHaveAttribute('placeholder', '1,048,576 · models.dev')
    expect(screen.getByTestId('model-rules-editor-model-1')).toHaveTextContent('Default: Low, High, Max (models.dev)')
  })

  it('saves edited overrides and keeps the fields the form does not edit', async () => {
    const withHandWritten: SavedProvider = {
      ...resolvedProvider,
      modelOverrides: { 'model-1': { reasoningDialect: 'thinking_type', extraBody: { thinking: { keep: 'all' } } } },
    }
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={withHandWritten} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    fireEvent.change(screen.getByLabelText('Context window for model-1'), { target: { value: '200000' } })
    fireEvent.change(screen.getByLabelText('Max output tokens for model-1'), { target: { value: '32000' } })
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Thinking for model-1' })).getByRole('button', { name: 'Low' }))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Images for model-1' })).getByRole('radio', { name: 'Supported' }))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'PDF for model-1' })).getByRole('radio', { name: 'Not supported' }))
    expect(screen.getByTestId('model-rules-summary-model-1')).toHaveTextContent('Window 200,000 · Output 32,000 · Thinking High, Max · Images Yes · PDF No')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProviderMock).toHaveBeenCalledWith(provider.id, expect.objectContaining({
      modelOverrides: {
        'model-1': {
          reasoningDialect: 'thinking_type',
          extraBody: { thinking: { keep: 'all' } },
          contextWindow: 200000,
          maxOutputTokens: 32000,
          reasoningLevels: ['high', 'max'],
          image: true,
          pdf: false,
        },
      },
    }))
  })

  it('writes the two special thinking options', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={resolvedProvider} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Thinking for model-1' })).getByRole('button', { name: 'No thinking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-2' }))
    const thinking2 = screen.getByRole('toolbar', { name: 'Thinking for model-2' })
    fireEvent.click(within(thinking2).getByRole('button', { name: 'Low' }))
    fireEvent.click(within(thinking2).getByRole('button', { name: 'Thinks, no levels' }))
    expect(within(thinking2).getByRole('button', { name: 'Low' })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProviderMock).toHaveBeenCalledWith(provider.id, expect.objectContaining({
      modelOverrides: { 'model-1': { reasoningLevels: 'off' }, 'model-2': { reasoningLevels: [] } },
    }))
  })

  it('restores a single field to its default', async () => {
    const withOverrides: SavedProvider = {
      ...resolvedProvider,
      modelOverrides: { 'model-1': { contextWindow: 64000, image: true, extraBody: { seed: 1 } } },
    }
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={withOverrides} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    expect(screen.getByLabelText('Context window for model-1')).toHaveValue('64,000')
    expect(screen.getByRole('button', { name: 'Restore default: Max output tokens' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Restore default: Context window' }))
    expect(screen.getByLabelText('Context window for model-1')).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProviderMock).toHaveBeenCalledWith(provider.id, expect.objectContaining({
      modelOverrides: { 'model-1': { image: true, extraBody: { seed: 1 } } },
    }))
  })

  it('does not turn fetched model limits into overrides', async () => {
    discoverModelsMock.mockResolvedValueOnce([{ id: 'model-new', name: 'New Model' }])
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fetch models' })) })
    fireEvent.focus(screen.getByRole('combobox', { name: 'Model ID' }))
    fireEvent.click(screen.getByRole('option', { name: /New Model/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProviderMock).toHaveBeenCalledWith(provider.id, expect.objectContaining({
      modelOverrides: {},
      models: [...models, { id: 'model-new', name: 'New Model' }],
    }))
  })

  it('requests native metadata for the selected LM Studio preset', async () => {
    const preset: ProviderPreset = { ...deepseekPreset, id: 'lmstudio', name: 'LM Studio', needsApiKey: false }
    discoverModelsMock.mockResolvedValueOnce([{ id: 'model-1' }])
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={{ ...provider, presetId: 'lmstudio' }} presets={[preset]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fetch models' })) })
    expect(discoverModelsMock).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'lmstudio' }))
  })

  it('refreshes model information in edit mode and shows why it failed', async () => {
    refreshProviderModelsMock.mockResolvedValueOnce({ provider, modelDiscovery: { ok: false, error: 'HTTP 401' } })
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={pendingProvider} presets={[deepseekPreset]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh model info' })) })
    expect(refreshProviderModelsMock).toHaveBeenCalledWith(provider.id)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read model information from the provider: HTTP 401')

    refreshProviderModelsMock.mockResolvedValueOnce({ provider })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh model info' })) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Model information updated.')
  })

  it('uses the refreshed rules from the store', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={pendingProvider} presets={[deepseekPreset]} />)
    expect(screen.getByTestId('model-rules-summary-model-1')).toHaveTextContent('Model information appears after saving.')
    act(() => { useProviderStore.setState({ providers: [resolvedProvider] }) })
    expect(screen.getByTestId('model-rules-summary-model-1')).toHaveTextContent('Window 1,048,576')
  })

  it('shows one warning after saving when model information could not be read, saying when open sessions pick up changes', async () => {
    const addToast = vi.fn()
    useUIStore.setState({ addToast })
    updateProviderMock.mockResolvedValueOnce({ provider, modelDiscovery: { ok: false, error: 'Unable to connect. Is the computer able to access the url?' } })
    const onClose = vi.fn()
    render(<ProviderFormModal open={true} onClose={onClose} mode="edit" provider={provider} presets={[deepseekPreset]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(addToast.mock.calls).toEqual([[{
      type: 'warning',
      message: 'Saved. Open sessions use the new model settings after their next model switch or restart. Could not read model information from the provider: Unable to connect. Is the computer able to access the url?',
    }]])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ends the warning with the provider error in Chinese', async () => {
    const addToast = vi.fn()
    useUIStore.setState({ addToast })
    useSettingsStore.setState({ locale: 'zh' })
    updateProviderMock.mockResolvedValueOnce({ provider, modelDiscovery: { ok: false, error: 'Unable to connect. Is the computer able to access the url?' } })
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
    expect(addToast.mock.calls).toEqual([[{
      type: 'warning',
      message: '已保存。已打开的会话在下次切换模型或重新开始后使用新的模型设置。没能从提供方读取模型信息：Unable to connect. Is the computer able to access the url?',
    }]])
  })

  it('shows one note after saving when model information was read', async () => {
    const addToast = vi.fn()
    useUIStore.setState({ addToast })
    updateProviderMock.mockResolvedValueOnce({ provider })
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(addToast.mock.calls).toEqual([[{ type: 'info', message: 'Saved. Open sessions use the new model settings after their next model switch or restart.' }]])
  })

  it('does not show the refresh button when adding a provider', () => {
    useProviderStore.setState({ createProvider: createProviderMock })
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="create" presets={[deepseekPreset]} />)
    expect(screen.queryByRole('button', { name: 'Refresh model info' })).not.toBeInTheDocument()
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

    updateProviderMock.mockResolvedValue({ provider })
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

  it('validates the limits in the per-model editor', async () => {
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={pendingProvider} presets={[deepseekPreset]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for model-1' }))
    const save = screen.getByRole('button', { name: 'Save' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Context window for model-1'), { target: { value: '12.5' } })
    expect(screen.getByText('Enter an integer.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Context window for model-1'), { target: { value: '200000' } })
    fireEvent.change(screen.getByLabelText('Max output tokens for model-1'), { target: { value: '0' } })
    expect(screen.getByText('Enter a positive integer.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Max output tokens for model-1'), { target: { value: '8192' } })
    expect(save).toBeEnabled()
  })

  it('enables saving after deleting a model with an invalid context window', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={pendingProvider} presets={[deepseekPreset]} />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Model ID' }), {
      target: { value: 'test-b' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Model settings for test-b' }))
    fireEvent.change(screen.getByLabelText('Context window for test-b'), { target: { value: '1' } })

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!)

    expect(screen.queryByText('Must be between 16000 and 10000000.')).not.toBeInTheDocument()
    await waitFor(() => expect(save).toBeEnabled())
  })

  it('saves the reordered model list', async () => {
    render(
      <ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={provider} presets={[deepseekPreset]} />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Move model up' })[1]!)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const reordered = [models[1], models[0], ...models.slice(2)]
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith(
      provider.id,
      expect.objectContaining({ models: reordered }),
    ))
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
