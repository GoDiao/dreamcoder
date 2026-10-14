import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderPreset } from '../../types/providerPreset'
import type { SavedProvider } from '../../types/provider'

const providersApiMock = vi.hoisted(() => ({
  presets: vi.fn(),
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
import { ProviderOnboarding } from './ProviderOnboarding'

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

const activateProviderMock = vi.fn()

describe('ProviderOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
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
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('loads presets once after mounting and advances past the loading screen', async () => {
    providersApiMock.presets.mockResolvedValue({ presets: [deepseekPreset] })

    render(
      <StrictMode>
        <ProviderOnboarding />
      </StrictMode>,
    )

    expect(await screen.findByRole('button', { name: '添加服务商' })).toBeInTheDocument()
    expect(providersApiMock.presets).toHaveBeenCalledTimes(1)
  })

  it('does not refetch when presets are already loaded', () => {
    useProviderStore.setState({ presets: [deepseekPreset] })

    render(<ProviderOnboarding />)

    expect(screen.getByRole('button', { name: '添加服务商' })).toBeInTheDocument()
    expect(providersApiMock.presets).not.toHaveBeenCalled()
  })

  it.each([
    { locale: 'zh' as const, errorPrefix: '预设加载失败：', retry: '重试', addProvider: '添加服务商' },
    { locale: 'en' as const, errorPrefix: 'Failed to load presets:', retry: 'Retry', addProvider: 'Add Provider' },
  ])('localizes the loading error and retry action in $locale and recovers on retry', async ({ locale, errorPrefix, retry, addProvider }) => {
    useSettingsStore.setState({ locale })
    providersApiMock.presets
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ presets: [deepseekPreset] })

    render(
      <StrictMode>
        <ProviderOnboarding />
      </StrictMode>,
    )

    const errorAlert = await screen.findByRole('alert')
    expect(errorAlert).toHaveTextContent(errorPrefix)
    expect(errorAlert).toHaveTextContent('network down')

    fireEvent.click(screen.getByRole('button', { name: retry }))

    expect(await screen.findByRole('button', { name: addProvider })).toBeInTheDocument()
    expect(providersApiMock.presets).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      locale: 'zh' as const,
      welcome: '欢迎使用 DreamCoder',
      tagline: '本地运行、支持多服务商的 AI 编程工作台',
      addProvider: '添加服务商',
      later: '稍后设置',
    },
    {
      locale: 'en' as const,
      welcome: 'Welcome to DreamCoder',
      tagline: 'A locally run, multi-provider AI coding workspace',
      addProvider: 'Add Provider',
      later: 'Set up later',
    },
  ])('shows provider-neutral copy in $locale', (copy) => {
    useSettingsStore.setState({ locale: copy.locale })
    useProviderStore.setState({ presets: [deepseekPreset] })

    const { container } = render(<ProviderOnboarding />)

    expect(screen.getByRole('heading', { name: copy.welcome })).toBeInTheDocument()
    expect(screen.getByText(copy.tagline, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.addProvider })).toBeEnabled()
    expect(screen.getByRole('button', { name: copy.later })).toBeEnabled()
    expect(container).not.toHaveTextContent(/DreamField/i)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('lets the user skip setup and remembers it across launches', () => {
    useProviderStore.setState({ presets: [deepseekPreset] })
    render(<ProviderOnboarding />)

    fireEvent.click(screen.getByRole('button', { name: '稍后设置' }))

    expect(useSettingsStore.getState().onboardingCompleted).toBe(true)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY)).toBe('true')
    expect(activateProviderMock).not.toHaveBeenCalled()
  })

  it('opens the provider form and activates the provider it creates', async () => {
    useProviderStore.setState({ presets: [deepseekPreset] })
    render(<ProviderOnboarding />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加服务商' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'mock-save' }))
    })

    expect(activateProviderMock).toHaveBeenCalledWith('provider-1')
    expect(useSettingsStore.getState().onboardingCompleted).toBe(true)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY)).toBe('true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps onboarding open when the provider form is closed without saving', () => {
    useProviderStore.setState({ presets: [deepseekPreset] })
    render(<ProviderOnboarding />)

    fireEvent.click(screen.getByRole('button', { name: '添加服务商' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useSettingsStore.getState().onboardingCompleted).toBe(false)
    expect(localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY)).toBeNull()
    expect(activateProviderMock).not.toHaveBeenCalled()
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
