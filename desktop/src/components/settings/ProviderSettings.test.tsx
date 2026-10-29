import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedProvider } from '../../types/provider'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ProviderSettings } from './ProviderSettings'

const models = [{ id: 'model-main' }]
const providers: SavedProvider[] = [
  {
    id: 'deepseek-1',
    presetId: 'deepseek',
    name: 'DeepSeek',
    apiKey: '',
    baseUrl: 'https://example.invalid',
    apiFormat: 'anthropic',
    models,
  },
  {
    id: 'custom-1',
    presetId: 'custom',
    name: 'My Custom Provider',
    apiKey: '',
    baseUrl: 'https://example.invalid',
    apiFormat: 'anthropic',
    models,
  },
]

describe('ProviderSettings provider icons', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useProviderStore.setState({
      providers,
      activeId: 'deepseek-1',
      hasLoadedProviders: true,
      presets: [],
      isLoading: false,
      isPresetsLoading: false,
      fetchProviders: vi.fn(async () => {}),
      fetchPresets: vi.fn(async () => {}),
    })
  })

  it('uses the saved preset ID for the logo and falls back for custom providers', () => {
    render(<ProviderSettings />)

    expect(screen.getByText('DeepSeek').parentElement?.querySelector('[data-testid="provider-icon-deepseek"]')).toBeInTheDocument()
    expect(screen.getByText('My Custom Provider').parentElement?.querySelector('[data-testid="provider-icon-fallback"]')).toBeInTheDocument()
  })
})
