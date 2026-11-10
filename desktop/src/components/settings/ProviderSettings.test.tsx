import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedProvider } from '../../types/provider'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ProviderSettings } from './ProviderSettings'
import { useDecisionProviderStore } from '../../stores/decisionProviderStore'

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
    useDecisionProviderStore.setState({
      providers: [
        {
          id: 'guardrail-1',
          presetId: 'openai',
          name: 'OpenAI Decisions',
          deployment: 'hosted',
          apiFormat: 'openai_decisions',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          models: [{ id: 'gpt-6-luna' }],
        },
      ],
      presets: [],
      isLoading: false,
      fetchProviders: vi.fn(async () => {}),
      fetchPresets: vi.fn(async () => {}),
    })
  })

  it('uses the saved preset ID for the logo and falls back for custom providers', () => {
    render(<ProviderSettings />)

    expect(screen.getByText('DeepSeek').parentElement?.querySelector('[data-testid="provider-icon-deepseek"]')).toBeInTheDocument()
    expect(screen.getByText('My Custom Provider').parentElement?.querySelector('[data-testid="provider-icon-fallback"]')).toBeInTheDocument()
    expect(screen.getByText('Decision model providers')).toBeInTheDocument()
    expect(screen.getByText('OpenAI Decisions')).toBeInTheDocument()
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useProviderStore.setState(useProviderStore.getInitialState(), true)
    useDecisionProviderStore.setState(useDecisionProviderStore.getInitialState(), true)
  })
})
