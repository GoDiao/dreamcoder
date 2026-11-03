import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../api/computerUse', () => ({ computerUseApi: { getConfig: vi.fn().mockResolvedValue({ enabled: false }) } }))

import { Settings } from './Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { ELECTRON_BRIDGE_KEY } from '../lib/shell/electronBridge'
import { useDecisionProviderStore } from '../stores/decisionProviderStore'

function setDesktop(enabled: boolean) {
  const target = window as unknown as Record<string, unknown>
  if (enabled) target[ELECTRON_BRIDGE_KEY] = { invoke: vi.fn().mockResolvedValue([]) }
  else delete target[ELECTRON_BRIDGE_KEY]
}

describe('Settings permissions tab', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'en',
      permissionGuardrail: {
        enabled: false,
        providerId: null,
        modelId: '',
        preset: 'safetyNet',
        threshold: 0.95,
        privacyNoticeVersion: 0,
      },
    })
    useDecisionProviderStore.setState({
      providers: [],
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

  it('shows the permission guardrail disabled by default', () => {
    render(<Settings />)

    expect(screen.getByRole('heading', { name: 'Permission guardrail' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable permission guardrail' })).not.toBeChecked()
  })

  it('shows the project rule configuration path and reload guidance', () => {
    render(<Settings />)

    expect(screen.getByRole('heading', { name: 'Explicit tool rules' })).toBeInTheDocument()
    expect(screen.getByText('.claude/settings.local.json')).toBeInTheDocument()
    expect(screen.getByText(/On Windows use PowerShell/)).toBeInTheDocument()
    expect(screen.getByText(/Start a new session after editing/)).toBeInTheDocument()
  })
})
