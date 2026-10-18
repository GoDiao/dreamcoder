import { StrictMode } from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderPreset } from '../../types/providerPreset'
import type { SavedProvider } from '../../types/provider'
import type { ClaudeCodeImportStatus } from '../../api/claudeCodeImport'

const providersApiMock = vi.hoisted(() => ({
  presets: vi.fn(),
  list: vi.fn(),
}))

vi.mock('../../api/providers', () => ({
  providersApi: providersApiMock,
}))

const createdProvider: SavedProvider = {
  id: 'provider-1',
  presetId: 'deepseek',
  name: 'DeepSeek',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/anthropic',
  apiFormat: 'anthropic',
  models: { main: 'model-main', haiku: '', sonnet: '', opus: '' },
}

vi.mock('../settings/ProviderFormModal', () => ({
  ProviderFormModal: ({ onClose, onCreated }: {
    onClose: () => void
    onCreated?: (provider: SavedProvider) => Promise<void> | void
  }) => (
    <div role="dialog">
      <button
        type="button"
        onClick={async () => {
          await onCreated?.(createdProvider)
          onClose()
        }}
      >
        mock-save
      </button>
      <button type="button" onClick={onClose}>mock-cancel</button>
    </div>
  ),
}))

import { useProviderStore } from '../../stores/providerStore'
import { ONBOARDING_COMPLETED_STORAGE_KEY, useSettingsStore } from '../../stores/settingsStore'
import { useClaudeCodeImportStore } from '../../stores/claudeCodeImportStore'
import { useTabStore } from '../../stores/tabStore'
import { FirstLaunch } from './FirstLaunch'
import { useFirstLaunchGate } from './useFirstLaunchGate'

const deepseekPreset: ProviderPreset = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://example.invalid/anthropic',
  apiFormat: 'anthropic',
  defaultModels: {
    main: 'model-main',
    haiku: '',
    sonnet: '',
    opus: '',
  },
  needsApiKey: true,
  websiteUrl: 'https://example.invalid',
}

const offerStatus: ClaudeCodeImportStatus = {
  claudeCodeDir: '/home/me/.claude',
  claudeCodeHasData: true,
  dreamcoderHasData: false,
  decided: false,
  incomplete: false,
  offer: true,
  job: null,
}

const activateProviderMock = vi.fn()
const startImportMock = vi.fn()
const skipMock = vi.fn()
const onFinish = vi.fn()

function resetStores() {
  useSettingsStore.setState({ locale: 'zh', onboardingCompleted: false })
  useProviderStore.setState({
    providers: [],
    activeId: null,
    hasLoadedProviders: true,
    presets: [],
    isLoading: false,
    isPresetsLoading: false,
    error: null,
    activateProvider: activateProviderMock,
  })
  useClaudeCodeImportStore.setState({
    status: null,
    job: null,
    error: null,
    promptOpen: false,
    startImport: startImportMock,
    skip: skipMock,
  })
}

describe('FirstLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    resetStores()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it.each([
    { locale: 'zh' as const, welcome: '欢迎使用 DreamCoder', tagline: '本地运行、支持多服务商的 AI 编程工作台', addProvider: '添加服务商', later: '稍后设置' },
    { locale: 'en' as const, welcome: 'Welcome to DreamCoder', tagline: 'A locally run, multi-provider AI coding workspace', addProvider: 'Add Provider', later: 'Set up later' },
  ])('shows provider-neutral copy in $locale', (copy) => {
    useSettingsStore.setState({ locale: copy.locale })

    const { container } = render(<FirstLaunch onFinish={onFinish} />)

    expect(screen.getByRole('heading', { name: copy.welcome })).toBeInTheDocument()
    expect(screen.getByText(copy.tagline)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.addProvider })).toBeEnabled()
    expect(screen.getByRole('button', { name: copy.later })).toBeEnabled()
    expect(container).not.toHaveTextContent(/DreamField/i)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('hides the import row when nothing is offered', () => {
    render(<FirstLaunch onFinish={onFinish} />)

    expect(screen.queryByText('从 Claude Code 导入')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入' })).not.toBeInTheDocument()
  })

  it('offers the import in a row and starts it', () => {
    useClaudeCodeImportStore.setState({ status: offerStatus, promptOpen: true })
    render(<FirstLaunch onFinish={onFinish} />)

    expect(screen.getByText('从 Claude Code 导入')).toBeInTheDocument()
    expect(screen.getByText(/\/home\/me\/\.claude/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入' }))

    expect(startImportMock).toHaveBeenCalledTimes(1)
  })

  it('shows progress in the row and blocks the other actions while importing', () => {
    useClaudeCodeImportStore.setState({
      status: offerStatus,
      job: { state: 'running', total: 10, copied: 3, skipped: 1 },
    })
    render(<FirstLaunch onFinish={onFinish} />)

    expect(screen.getByRole('status')).toHaveTextContent('4 / 10')
    expect(screen.queryByRole('button', { name: '导入' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加服务商' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '稍后设置' })).toBeDisabled()
  })

  it('shows the copied and kept counts when the import is done', () => {
    useClaudeCodeImportStore.setState({
      status: { ...offerStatus, offer: false, decided: true },
      job: { state: 'done', total: 12, copied: 10, skipped: 2 },
    })
    render(<FirstLaunch onFinish={onFinish} />)

    expect(screen.getByRole('status')).toHaveTextContent('已导入')
    expect(screen.getByText('已复制 10 个文件，保留 2 个已有文件。')).toBeInTheDocument()
  })

  it('shows import errors inside the row and lets the user retry', () => {
    useClaudeCodeImportStore.setState({
      status: offerStatus,
      job: { state: 'failed', total: 5, copied: 1, skipped: 0, error: 'disk full' },
    })
    render(<FirstLaunch onFinish={onFinish} />)

    expect(screen.getByRole('alert')).toHaveTextContent('导入失败：disk full')
    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled()
  })

  it('offers only "get started" once a default provider exists', async () => {
    useProviderStore.setState({ activeId: 'provider-1' })
    useClaudeCodeImportStore.setState({
      status: { ...offerStatus, offer: false, decided: true },
      job: { state: 'done', total: 1, copied: 1, skipped: 0 },
    })
    render(<FirstLaunch onFinish={onFinish} />)

    expect(screen.queryByRole('button', { name: '添加服务商' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '稍后设置' })).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    })

    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(skipMock).not.toHaveBeenCalled()
  })

  it('"set up later" skips an undecided import, completes onboarding and remembers it', async () => {
    useClaudeCodeImportStore.setState({ status: offerStatus, promptOpen: true })
    render(<FirstLaunch onFinish={onFinish} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '稍后设置' }))
    })

    expect(skipMock).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().onboardingCompleted).toBe(true)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY)).toBe('true')
    expect(activateProviderMock).not.toHaveBeenCalled()
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('"set up later" does not skip when no import was offered', async () => {
    render(<FirstLaunch onFinish={onFinish} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '稍后设置' }))
    })

    expect(skipMock).not.toHaveBeenCalled()
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('loads presets only when adding a provider, once, and opens the form', async () => {
    providersApiMock.presets.mockResolvedValue({ presets: [deepseekPreset] })
    render(
      <StrictMode>
        <FirstLaunch onFinish={onFinish} />
      </StrictMode>,
    )

    expect(providersApiMock.presets).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加服务商' }))
    })

    expect(providersApiMock.presets).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not refetch presets that are already loaded', async () => {
    useProviderStore.setState({ presets: [deepseekPreset] })
    render(<FirstLaunch onFinish={onFinish} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加服务商' }))
    })

    expect(providersApiMock.presets).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it.each([
    { locale: 'zh' as const, errorPrefix: '预设加载失败：', addProvider: '添加服务商' },
    { locale: 'en' as const, errorPrefix: 'Failed to load presets:', addProvider: 'Add Provider' },
  ])('shows a preset load error in $locale and recovers on retry', async ({ locale, errorPrefix, addProvider }) => {
    useSettingsStore.setState({ locale })
    providersApiMock.presets
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ presets: [deepseekPreset] })
    render(<FirstLaunch onFinish={onFinish} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: addProvider }))
    })
    const errorAlert = screen.getByRole('alert')
    expect(errorAlert).toHaveTextContent(errorPrefix)
    expect(errorAlert).toHaveTextContent('network down')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: addProvider }))
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(providersApiMock.presets).toHaveBeenCalledTimes(2)
  })

  it('activates the created provider and finishes when the form closes', async () => {
    useProviderStore.setState({ presets: [deepseekPreset] })
    render(<FirstLaunch onFinish={onFinish} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加服务商' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'mock-save' }))
    })

    expect(activateProviderMock).toHaveBeenCalledWith('provider-1')
    expect(useSettingsStore.getState().onboardingCompleted).toBe(true)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY)).toBe('true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('stays open when the provider form is closed without saving', async () => {
    useProviderStore.setState({ presets: [deepseekPreset] })
    render(<FirstLaunch onFinish={onFinish} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加服务商' }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'mock-cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useSettingsStore.getState().onboardingCompleted).toBe(false)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY)).toBeNull()
    expect(activateProviderMock).not.toHaveBeenCalled()
    expect(onFinish).not.toHaveBeenCalled()
  })
})

describe('useFirstLaunchGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    resetStores()
    useProviderStore.setState({ hasLoadedProviders: false })
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  async function renderGate(ready = true) {
    const hook = renderHook(({ isReady }) => useFirstLaunchGate(isReady), { initialProps: { isReady: ready } })
    await act(async () => {})
    return hook
  }

  it('fetches providers itself and stays pending until they load', async () => {
    let resolveList: (value: { providers: SavedProvider[]; activeId: string | null }) => void = () => {}
    providersApiMock.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve }))
    const { result } = renderHook(() => useFirstLaunchGate(true))

    expect(result.current.state).toBe('pending')
    expect(providersApiMock.list).toHaveBeenCalledTimes(1)
    await act(async () => resolveList({ providers: [], activeId: null }))
    expect(result.current.state).toBe('open')
  })

  it('opens for an import offer alone', async () => {
    providersApiMock.list.mockResolvedValue({ providers: [createdProvider], activeId: 'provider-1' })
    useClaudeCodeImportStore.setState({ status: offerStatus, promptOpen: true })

    const { result } = await renderGate()

    expect(result.current.state).toBe('open')
  })

  it('opens when onboarding alone is needed', async () => {
    providersApiMock.list.mockResolvedValue({ providers: [], activeId: null })

    const { result } = await renderGate()

    expect(result.current.state).toBe('open')
  })

  it('stays closed when providers exist and nothing is offered', async () => {
    providersApiMock.list.mockResolvedValue({ providers: [createdProvider], activeId: 'provider-1' })

    const { result } = await renderGate()

    expect(result.current.state).toBe('closed')
  })

  it('stays closed when onboarding was completed earlier', async () => {
    useSettingsStore.setState({ onboardingCompleted: true })
    providersApiMock.list.mockResolvedValue({ providers: [], activeId: null })

    const { result } = await renderGate()

    expect(result.current.state).toBe('closed')
  })

  it('stays open after a provider appears and closes on finish onto the empty session page', async () => {
    providersApiMock.list.mockResolvedValue({ providers: [], activeId: null })
    useTabStore.setState({
      tabs: [{ sessionId: 'old', title: 'Old', type: 'session', status: 'idle' }],
      activeTabId: 'old',
    })
    useClaudeCodeImportStore.setState({ promptOpen: true })
    const { result } = await renderGate()
    expect(result.current.state).toBe('open')

    act(() => {
      useProviderStore.setState({ providers: [createdProvider], activeId: 'provider-1' })
      useClaudeCodeImportStore.setState({ promptOpen: false })
    })
    expect(result.current.state).toBe('open')

    act(() => result.current.finish())
    expect(result.current.state).toBe('closed')
    expect(useTabStore.getState().activeTabId).toBeNull()
    expect(useClaudeCodeImportStore.getState().promptOpen).toBe(false)
  })
})

describe('onboarding completion persistence', () => {
  afterEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('restores the completed flag from storage on startup', async () => {
    localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, 'true')
    vi.resetModules()
    const { useSettingsStore: freshStore } = await import('../../stores/settingsStore')

    expect(freshStore.getState().onboardingCompleted).toBe(true)
  })

  it('starts incomplete when nothing is stored', async () => {
    vi.resetModules()
    const { useSettingsStore: freshStore } = await import('../../stores/settingsStore')

    expect(freshStore.getState().onboardingCompleted).toBe(false)
  })
})
