import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderPreset } from '../../types/providerPreset'

const providersApiMock = vi.hoisted(() => ({
  presets: vi.fn(),
}))

vi.mock('../../api/providers', () => ({
  providersApi: providersApiMock,
}))

import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ProviderOnboarding } from './ProviderOnboarding'

const dreamfieldPreset: ProviderPreset = {
  id: 'dreamfield',
  name: 'DreamField',
  baseUrl: 'https://example.invalid/api',
  apiFormat: 'anthropic',
  defaultModels: {
    main: 'dreamfield-main',
    haiku: '',
    sonnet: '',
    opus: '',
  },
  needsApiKey: true,
  websiteUrl: 'https://example.invalid',
}

describe('ProviderOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'zh' })
    useProviderStore.setState({
      providers: [],
      activeId: null,
      hasLoadedProviders: true,
      presets: [],
      isLoading: false,
      isPresetsLoading: false,
      error: null,
    })
  })

  it('loads presets once after mounting and advances past the loading screen', async () => {
    providersApiMock.presets.mockResolvedValue({ presets: [dreamfieldPreset] })

    render(
      <StrictMode>
        <ProviderOnboarding />
      </StrictMode>,
    )

    expect(await screen.findByRole('textbox', { name: /^API 密钥/ })).toBeInTheDocument()
    expect(providersApiMock.presets).toHaveBeenCalledTimes(1)
  })

  it('does not refetch presets that are already available', () => {
    useProviderStore.setState({ presets: [dreamfieldPreset] })

    render(
      <StrictMode>
        <ProviderOnboarding />
      </StrictMode>,
    )

    expect(screen.getByRole('textbox', { name: /^API 密钥/ })).toBeInTheDocument()
    expect(providersApiMock.presets).not.toHaveBeenCalled()
  })

  it.each([
    { locale: 'zh' as const, errorPrefix: '预设加载失败：', retry: '重试', apiKey: /^API 密钥/ },
    { locale: 'en' as const, errorPrefix: 'Failed to load presets:', retry: 'Retry', apiKey: /^API Key/ },
  ])('localizes the loading error and retry action in $locale and recovers on retry', async ({ locale, errorPrefix, retry, apiKey }) => {
    useSettingsStore.setState({ locale })
    providersApiMock.presets
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ presets: [dreamfieldPreset] })

    render(
      <StrictMode>
        <ProviderOnboarding />
      </StrictMode>,
    )

    const errorAlert = await screen.findByRole('alert')
    expect(errorAlert).toHaveTextContent(errorPrefix)
    expect(errorAlert).toHaveTextContent('network down')
    const retryButton = screen.getByRole('button', { name: retry })

    fireEvent.click(retryButton)

    expect(await screen.findByRole('textbox', { name: apiKey })).toBeInTheDocument()
    expect(providersApiMock.presets).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      locale: 'zh' as const,
      welcome: '欢迎使用 DreamCoder',
      tagline: 'DreamField 官方 AI Coding Agent',
      instructions: '输入你的 DreamField API Key 开始使用',
      apiKey: /^API 密钥/,
      placeholder: '输入 DreamField API Key',
      start: '开始使用',
      noApiKey: '没有 API Key？',
      signUp: '前往 DreamField 注册',
    },
    {
      locale: 'en' as const,
      welcome: 'Welcome to DreamCoder',
      tagline: 'The official DreamField AI coding agent',
      instructions: 'Enter your DreamField API key to get started',
      apiKey: /^API Key/,
      placeholder: 'Enter your DreamField API key',
      start: 'Get started',
      noApiKey: "Don't have an API key?",
      signUp: 'Sign up for DreamField',
    },
  ])('localizes the onboarding form in $locale', (copy) => {
    useSettingsStore.setState({ locale: copy.locale })
    useProviderStore.setState({ presets: [dreamfieldPreset] })

    render(<ProviderOnboarding />)

    expect(screen.getByRole('heading', { name: copy.welcome })).toBeInTheDocument()
    expect(screen.getByText(copy.tagline, { exact: false })).toHaveTextContent(copy.instructions)
    expect(screen.getByRole('textbox', { name: copy.apiKey })).toHaveAttribute('placeholder', copy.placeholder)
    expect(screen.getByRole('button', { name: copy.start })).toBeDisabled()
    const signUp = screen.getByRole('link', { name: copy.signUp })
    expect(signUp).toHaveAttribute('href', 'https://www.dreamfield.top')
    expect(signUp.parentElement).toHaveTextContent(copy.noApiKey)
  })

  it('updates the copy when the locale changes without losing the entered API key', () => {
    useProviderStore.setState({ presets: [dreamfieldPreset] })
    render(<ProviderOnboarding />)

    fireEvent.change(screen.getByRole('textbox', { name: /^API 密钥/ }), {
      target: { value: 'test-api-key' },
    })
    act(() => useSettingsStore.setState({ locale: 'en' }))

    expect(screen.getByRole('heading', { name: 'Welcome to DreamCoder' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^API Key/ })).toHaveValue('test-api-key')
    expect(screen.getByRole('button', { name: 'Get started' })).toBeEnabled()
  })
})
