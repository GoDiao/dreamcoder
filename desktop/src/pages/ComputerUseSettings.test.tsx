import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ComputerUseSettings } from './ComputerUseSettings'
import { useSettingsStore } from '../stores/settingsStore'
import type { ComputerUseStatus } from '../api/computerUse'

const computerUseApiMock = vi.hoisted(() => ({
  getStatus: vi.fn(),
  install: vi.fn(),
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  grantPermissions: vi.fn(),
  doctor: vi.fn(),
  disableTelemetry: vi.fn(),
  openSettings: vi.fn(),
  cleanupLegacyRuntime: vi.fn(),
}))

vi.mock('../api/computerUse', () => ({
  computerUseApi: computerUseApiMock,
}))

function makeStatus(overrides: Partial<ComputerUseStatus> = {}): ComputerUseStatus {
  return {
    platform: 'darwin',
    platformSupported: true,
    state: 'installed',
    verifiedVersion: '0.34.0',
    version: '0.34.0',
    newerThanVerified: false,
    path: '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
    source: 'existing',
    install: null,
    permissions: { accessibility: 'granted', screenRecording: 'granted' },
    telemetry: 'disabled',
    enabled: false,
    driverPath: null,
    conflicts: { reservedName: false, duplicates: [] },
    legacyRuntime: { present: false, path: '/cfg/.runtime', bytes: 0 },
    ...overrides,
  }
}

const notInstalled = makeStatus({
  state: 'not_installed',
  version: null,
  path: null,
  source: null,
  permissions: null,
  telemetry: 'unknown',
})

describe('ComputerUseSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    for (const mock of Object.values(computerUseApiMock)) mock.mockReset()
    computerUseApiMock.updateConfig.mockResolvedValue({ enabled: true, driverPath: null })
  })

  it('shows an installed driver with its permissions and source', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus())
    render(<ComputerUseSettings />)

    expect(await screen.findByText(/Installed v0\.34\.0 · existing install/)).toBeInTheDocument()
    expect(screen.getByText('Accessibility')).toBeInTheDocument()
    expect(screen.getByText('Screen Recording')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Computer control' })).not.toBeChecked()
  })

  it('asks before downloading when the switch is turned on without a driver, and cancel keeps it off', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(notInstalled)
    render(<ComputerUseSettings />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Computer control' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/about 76 MB from GitHub/)).toBeInTheDocument()
    expect(within(dialog).getByText(/telemetry is turned off/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(computerUseApiMock.install).not.toHaveBeenCalled()
    expect(computerUseApiMock.updateConfig).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Computer control' })).not.toBeChecked()
  })

  it('enables directly when a driver is already installed', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus())
    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Computer control' }))
    await waitFor(() => expect(computerUseApiMock.updateConfig).toHaveBeenCalledWith({ enabled: true }))
    expect(computerUseApiMock.install).not.toHaveBeenCalled()
  })

  it('disables every control while installing', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({
        ...notInstalled,
        state: 'installing',
        install: { phase: 'installing', startedAt: 'now', output: ['fetching archive'] },
      }),
    )
    render(<ComputerUseSettings />)

    expect(await screen.findByText(/Installing: running the cua installer/)).toBeInTheDocument()
    expect(screen.getByText('fetching archive')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Computer control' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()
  })

  it('shows the installer error and keeps the switch off when installation failed', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({
        ...notInstalled,
        install: {
          phase: 'failed',
          startedAt: 'a',
          finishedAt: 'b',
          output: ['error: /Applications is not writable'],
          error: 'Installer exited with code 1',
        },
      }),
    )
    render(<ComputerUseSettings />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Installation failed')
    expect(alert).toHaveTextContent('Installer exited with code 1')
    expect(alert).toHaveTextContent('/Applications is not writable')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Use an existing install path' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Computer control' })).not.toBeChecked()
  })

  it('separates a failed status check from "not installed"', async () => {
    computerUseApiMock.getStatus.mockRejectedValue(new Error('server unreachable'))
    render(<ComputerUseSettings />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not check Computer Use status')
    expect(alert).toHaveTextContent('server unreachable')
    expect(screen.queryByText('Not installed')).not.toBeInTheDocument()
  })

  it('explains unknown permissions and offers to grant', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({ permissions: { accessibility: 'unknown', screenRecording: 'unknown' } }),
    )
    render(<ComputerUseSettings />)
    expect(await screen.findAllByText('cua-driver is not running, so permissions cannot be read')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Grant' })).toHaveLength(2)
  })

  it('keeps a persistent hint when permissions are still missing after granting', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({ permissions: { accessibility: 'granted', screenRecording: 'denied' } }),
    )
    computerUseApiMock.grantPermissions.mockResolvedValue({
      ok: true,
      output: '',
      permissions: { accessibility: 'granted', screenRecording: 'denied' },
    })
    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Grant' }))
    expect(await screen.findByText(/Still not granted/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Screen Recording settings' })).toBeInTheDocument()
  })

  it('offers no downgrade for a newer install', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus({ version: '0.35.4', newerThanVerified: true }))
    render(<ComputerUseSettings />)
    expect(await screen.findByText(/Newer than the verified version 0\.34\.0/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Install/ })).not.toBeInTheDocument()
  })

  it('offers to install the verified version over an older one, with the replacement warning', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus({ state: 'outdated', version: '0.30.0' }))
    computerUseApiMock.install.mockResolvedValue({ phase: 'downloading', startedAt: 'now', output: [] })
    render(<ComputerUseSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install 0.34.0' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Other tools using cua are disconnected/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(computerUseApiMock.install).toHaveBeenCalled())
  })

  it('offers to turn off telemetry of an existing install', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus({ telemetry: 'enabled' }))
    computerUseApiMock.disableTelemetry.mockResolvedValue({ telemetry: 'disabled' })
    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off cua telemetry' }))
    await waitFor(() => expect(computerUseApiMock.disableTelemetry).toHaveBeenCalled())
  })

  it('warns about MCP name conflicts and duplicate cua-driver servers', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({ conflicts: { reservedName: true, duplicates: ['cua-computer-use'] } }),
    )
    render(<ComputerUseSettings />)
    expect(await screen.findByText(/server named "cua"/)).toBeInTheDocument()
    expect(screen.getByText(/\(cua-computer-use\)/)).toBeInTheDocument()
  })

  it('cleans up the legacy Python runtime after confirmation', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({ legacyRuntime: { present: true, path: '/cfg/.runtime', bytes: 50 * 1024 * 1024 } }),
    )
    computerUseApiMock.cleanupLegacyRuntime.mockResolvedValue({ present: false, path: '/cfg/.runtime', bytes: 0 })
    render(<ComputerUseSettings />)

    expect(await screen.findByText(/50 MB in \/cfg\/\.runtime/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove old runtime' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(computerUseApiMock.cleanupLegacyRuntime).toHaveBeenCalled())
  })

  it('shows doctor output', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus())
    computerUseApiMock.doctor.mockResolvedValue({ ok: true, output: 'daemon: running' })
    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Diagnostics' }))
    expect(await screen.findByText('daemon: running')).toBeInTheDocument()
  })

  it('disables the switch on unsupported platforms', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus({ platform: 'freebsd', platformSupported: false }))
    render(<ComputerUseSettings />)
    expect(await screen.findByText(/not available on this platform \(freebsd\)/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Computer control' })).toBeDisabled()
  })

  it('asks the server to enable Computer Use after an install started by the switch', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(notInstalled)
    computerUseApiMock.install.mockResolvedValue({ phase: 'downloading', startedAt: 'now', output: [] })
    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Computer control' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(computerUseApiMock.install).toHaveBeenCalledWith(true))
    expect(computerUseApiMock.updateConfig).not.toHaveBeenCalled()
  })

  it('does not enable Computer Use after an install started from the status row', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(notInstalled)
    computerUseApiMock.install.mockResolvedValue({ phase: 'downloading', startedAt: 'now', output: [] })
    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(computerUseApiMock.install).toHaveBeenCalledWith(false))
  })

  it('shows an upgraded user with Computer Use on but no driver as on, not installed, with Install', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus({ ...notInstalled, enabled: true }))
    computerUseApiMock.install.mockResolvedValue({ phase: 'downloading', startedAt: 'now', output: [] })
    render(<ComputerUseSettings />)
    expect(await screen.findByRole('switch', { name: 'Computer control' })).toBeChecked()
    expect(screen.getByText('Not installed')).toBeInTheDocument()
    expect(screen.queryByText(/Takes effect in new sessions/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(computerUseApiMock.install).toHaveBeenCalled())
    expect(computerUseApiMock.updateConfig).not.toHaveBeenCalled()
  })

  it('hides an old install failure once a driver is available', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({ install: { phase: 'failed', startedAt: 'a', output: [], error: 'network' }, source: 'custom' }),
    )
    render(<ComputerUseSettings />)
    await screen.findByText(/Installed v0\.34\.0/)
    expect(screen.queryByText('Installation failed')).not.toBeInTheDocument()
  })

  it('does not offer an upgrade that cannot replace an outdated custom path', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({ state: 'outdated', version: '0.30.0', source: 'custom', driverPath: '/opt/cua-driver' }),
    )
    render(<ComputerUseSettings />)
    expect(await screen.findByText(/This is your custom path/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install 0.34.0' })).not.toBeInTheDocument()
  })

  it('clears the "still not granted" hint once a recheck shows the permissions granted', async () => {
    computerUseApiMock.getStatus.mockResolvedValue(
      makeStatus({ permissions: { accessibility: 'granted', screenRecording: 'denied' } }),
    )
    computerUseApiMock.grantPermissions.mockResolvedValue({
      ok: true,
      output: '',
      permissions: { accessibility: 'granted', screenRecording: 'denied' },
    })
    render(<ComputerUseSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Grant' }))
    expect(await screen.findByText(/Still not granted/)).toBeInTheDocument()
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus())
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.queryByText(/Still not granted/)).not.toBeInTheDocument())
  })

  it('fills the custom path field from a recheck after a failed first load', async () => {
    computerUseApiMock.getStatus.mockRejectedValueOnce(new Error('down'))
    render(<ComputerUseSettings />)
    await screen.findByText('Could not check Computer Use status')
    computerUseApiMock.getStatus.mockResolvedValue(makeStatus({ source: 'custom', driverPath: '/opt/cua-driver' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Advanced' }))
    expect(screen.getByRole('textbox', { name: 'Custom cua-driver path' })).toHaveValue('/opt/cua-driver')
  })
})
