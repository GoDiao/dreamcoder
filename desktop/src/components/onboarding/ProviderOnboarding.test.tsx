import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

    expect(await screen.findByRole('textbox', { name: /^API Key/ })).toBeInTheDocument()
    expect(providersApiMock.presets).toHaveBeenCalledTimes(1)
  })

  it('does not refetch presets that are already available', () => {
    useProviderStore.setState({ presets: [dreamfieldPreset] })

    render(
      <StrictMode>
        <ProviderOnboarding />
      </StrictMode>,
    )

    expect(screen.getByRole('textbox', { name: /^API Key/ })).toBeInTheDocument()
    expect(providersApiMock.presets).not.toHaveBeenCalled()
  })

  it('shows an error with a retry button when preset loading fails, and recovers on retry', async () => {
    providersApiMock.presets
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ presets: [dreamfieldPreset] })

    render(
      <StrictMode>
        <ProviderOnboarding />
      </StrictMode>,
    )

    const retryButton = await screen.findByRole('button', { name: '重试' })
    expect(screen.getByText(/network down/)).toBeInTheDocument()

    fireEvent.click(retryButton)

    expect(await screen.findByRole('textbox', { name: /^API Key/ })).toBeInTheDocument()
    expect(providersApiMock.presets).toHaveBeenCalledTimes(2)
  })
})
