import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../api/computerUse', () => ({ computerUseApi: { getConfig: vi.fn().mockResolvedValue({ enabled: false }) } }))

import { Settings } from './Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { ELECTRON_BRIDGE_KEY } from '../lib/shell/electronBridge'
import { useDecisionProviderStore } from '../stores/decisionProviderStore'
import { useProviderStore } from '../stores/providerStore'

function setDesktop(enabled: boolean) {
  const target = window as unknown as Record<string, unknown>
  if (enabled) target[ELECTRON_BRIDGE_KEY] = { invoke: vi.fn().mockResolvedValue([]) }
  else delete target[ELECTRON_BRIDGE_KEY]
}

describe('Settings permissions tab', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'en',
      permissionMode: 'default',
      autoPermission: {
        providerId: null,
        modelId: '',
        privacyNoticeVersion: 0,
      },
    })
    useDecisionProviderStore.setState({
      providers: [],
      fetchProviders: vi.fn(async () => {}),
    })
    useProviderStore.setState({
      providers: [{
        id: 'provider-1',
        presetId: 'openai',
        name: 'OpenAI',
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        apiFormat: 'openai_responses',
        runtimeKind: 'anthropic_compatible',
        models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }],
        fastModel: 'gpt-5-mini',
      }],
      activeId: 'provider-1',
      fetchProviders: vi.fn(async () => {}),
    })
    useUIStore.setState({ settingsTab: 'permissions' })
  })

  afterEach(() => {
    cleanup()
    setDesktop(false)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useUIStore.setState(useUIStore.getInitialState(), true)
    useDecisionProviderStore.setState(useDecisionProviderStore.getInitialState(), true)
    useProviderStore.setState(useProviderStore.getInitialState(), true)
  })

  it('shows the trusted sites section in the desktop app', async () => {
    setDesktop(true)
    render(<Settings />)

    expect(screen.getByRole('heading', { name: 'Trusted sites' })).toBeInTheDocument()
    expect(await screen.findByText('No trusted sites. The agent asks the first time it operates each site.')).toBeInTheDocument()
  })

  it('hides the trusted sites section outside the desktop app', () => {
    render(<Settings />)

    expect(screen.queryByRole('heading', { name: 'Trusted sites' })).not.toBeInTheDocument()
  })

  it('shows Auto configuration only when Auto mode is selected', () => {
    render(<Settings />)

    expect(screen.queryByRole('heading', { name: 'Auto permission model' })).not.toBeInTheDocument()

    cleanup()
    useSettingsStore.setState({ permissionMode: 'auto' })
    render(<Settings />)

    expect(screen.getByRole('heading', { name: 'Auto permission model' })).toBeInTheDocument()
    expect(screen.getByText('Auto will use gpt-5-mini from OpenAI.')).toBeInTheDocument()
    expect(screen.getByText('Active provider fast model')).toBeInTheDocument()
  })

  it('uses the selected model when the active provider has no separate fast model', () => {
    useSettingsStore.setState({
      permissionMode: 'auto',
      autoPermission: {
        providerId: null,
        modelId: '',
        privacyNoticeVersion: 1,
      },
    })
    useProviderStore.setState((state) => ({
      providers: state.providers.map((provider) => ({ ...provider, fastModel: undefined })),
    }))

    render(<Settings />)

    expect(screen.getByText('Auto will use gpt-5 from OpenAI.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('shows the project rule configuration path and reload guidance', () => {
    render(<Settings />)

    expect(screen.getByRole('heading', { name: 'Explicit tool rules' })).toBeInTheDocument()
    expect(screen.getByText('.claude/settings.local.json')).toBeInTheDocument()
    expect(screen.getByText(/On Windows use PowerShell/)).toBeInTheDocument()
    expect(screen.getByText(/Start a new session after editing/)).toBeInTheDocument()
  })
})
