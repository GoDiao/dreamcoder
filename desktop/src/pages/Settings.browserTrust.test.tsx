import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../components/settings/BrowserTrustSettings', () => ({ BrowserTrustSettings: () => <div>trusted sites section</div> }))
vi.mock('../api/computerUse', () => ({ computerUseApi: { getConfig: vi.fn().mockResolvedValue({ enabled: false }) } }))

import { Settings } from './Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { ELECTRON_BRIDGE_KEY } from '../lib/shell/electronBridge'

function setDesktop(enabled: boolean) {
  const target = window as unknown as Record<string, unknown>
  if (enabled) target[ELECTRON_BRIDGE_KEY] = {}
  else delete target[ELECTRON_BRIDGE_KEY]
}

describe('Settings permissions tab', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ settingsTab: 'permissions' })
  })

  afterEach(() => {
    cleanup()
    setDesktop(false)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useUIStore.setState(useUIStore.getInitialState(), true)
  })

  it('shows the trusted sites section in the desktop app', () => {
    setDesktop(true)
    render(<Settings />)

    expect(screen.getByText('trusted sites section')).toBeInTheDocument()
  })

  it('hides the trusted sites section outside the desktop app', () => {
    render(<Settings />)

    expect(screen.queryByText('trusted sites section')).not.toBeInTheDocument()
  })
})
