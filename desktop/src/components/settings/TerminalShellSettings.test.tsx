import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalShellSettings } from './TerminalShellSettings'
import { useSettingsStore } from '../../stores/settingsStore'

const native = vi.hoisted(() => ({ available: true, detect: vi.fn() }))
vi.mock('../../api/terminal', () => ({ terminalApi: {
  isAvailable: () => native.available,
  detectDefaultShell: native.detect,
} }))

describe('default shell preferences', () => {
  beforeEach(() => {
    native.available = true
    native.detect.mockReset()
    native.detect.mockResolvedValue({ platform: 'macos', shell: '/bin/zsh' })
    useSettingsStore.setState({
      locale: 'en',
      desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: null },
      setDesktopTerminal: vi.fn().mockResolvedValue(undefined),
    })
  })
  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  })

  it('shows the Bash path setting only on Windows', async () => {
    native.detect.mockResolvedValue({ platform: 'windows', shell: 'cmd.exe' })
    render(<TerminalShellSettings />)
    expect(await screen.findByPlaceholderText('Bash Path')).toBeInTheDocument()
    cleanup()
    native.detect.mockResolvedValue({ platform: 'macos', shell: '/bin/zsh' })
    render(<TerminalShellSettings />)
    expect(await screen.findByRole('button', { name: 'Save shell' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Bash Path')).not.toBeInTheDocument()
  })

  it('asks the sidecar for the default shell', async () => {
    render(<TerminalShellSettings />)
    await waitFor(() => expect(native.detect).toHaveBeenCalledWith())
  })

  it.each(['macos', 'linux'])('shows detection and Unix choices on %s', async (platform) => {
    native.detect.mockResolvedValue({ platform, shell: '/usr/bin/fish' })
    render(<TerminalShellSettings />)
    await waitFor(() => expect(native.detect).toHaveBeenCalled())
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Default shell' }), { key: 'ArrowDown' })
    expect(screen.getByText('/usr/bin/fish')).toBeInTheDocument()
    for (const shell of ['zsh', 'bash', 'fish']) {
      expect(screen.getByRole('menuitemradio', { name: shell })).toBeInTheDocument()
    }
    expect(screen.queryByText('Command Prompt')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'fish' }))
    await screen.findByRole('button', { name: 'Default shell' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(useSettingsStore.getState().setDesktopTerminal).toHaveBeenCalledWith({ startupShell: 'fish', customShellPath: '' })
  })

  it('keeps Windows shell choices using the native host platform', async () => {
    native.detect.mockResolvedValue({ platform: 'windows', shell: 'cmd.exe' })
    render(<TerminalShellSettings />)
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Default shell' }), { key: 'ArrowDown' })
    expect(screen.getByText('cmd.exe')).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /^Command Prompt/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'fish' })).not.toBeInTheDocument()
  })

  it('validates custom Unix paths and persists a trimmed absolute path', async () => {
    useSettingsStore.setState({ desktopTerminal: { startupShell: 'custom', customShellPath: '', bashPath: null } })
    render(<TerminalShellSettings />)
    await screen.findByRole('button', { name: 'Default shell' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(screen.getByText('Enter a shell path before saving.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Custom shell path'), { target: { value: 'bin/fish' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save shell' }))
    expect(screen.getByText('Custom shell path must be an absolute path.')).toBeInTheDocument()
    expect(useSettingsStore.getState().setDesktopTerminal).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Custom shell path'), { target: { value: ' /opt/homebrew/bin/fish ' } })
    await screen.findByRole('button', { name: 'Default shell' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(useSettingsStore.getState().setDesktopTerminal).toHaveBeenCalledWith({ startupShell: 'custom', customShellPath: '/opt/homebrew/bin/fish' })
    expect(screen.getByText('Saved. Restart or open a new terminal to apply it.')).toBeInTheDocument()
  })

  it('hides preferences in H5 without detecting the browser platform', () => {
    native.available = false
    native.detect.mockClear()
    render(<TerminalShellSettings />)
    expect(screen.queryByText('Default shell')).not.toBeInTheDocument()
    expect(native.detect).not.toHaveBeenCalled()
  })

  it('waits for host detection and never guesses the browser platform', async () => {
    let resolveHost!: (value: { platform: string; shell: string }) => void
    native.detect.mockReturnValue(new Promise((resolve) => { resolveHost = resolve }))
    render(<TerminalShellSettings />)
    expect(screen.queryByRole('button', { name: 'Default shell' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Detecting the host shell')
    await act(async () => { resolveHost({ platform: 'windows', shell: 'cmd.exe' }) })
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Default shell' }), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitemradio', { name: /^Command Prompt/ })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.getAllByRole('button', { name: 'Default shell' })).toHaveLength(1)
  })

  it('keeps controls unavailable when host detection fails', async () => {
    native.detect.mockRejectedValue(new Error('host detection failed'))
    render(<TerminalShellSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('host detection failed')
    expect(screen.queryByRole('button', { name: 'Default shell' })).not.toBeInTheDocument()
  })

  it('displays save failures without claiming success', async () => {
    useSettingsStore.setState({ setDesktopTerminal: vi.fn().mockRejectedValue(new Error('save failed')) })
    render(<TerminalShellSettings />)
    await screen.findByRole('button', { name: 'Default shell' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(screen.getByText('save failed')).toBeInTheDocument()
    expect(screen.queryByText('Saved. Restart or open a new terminal to apply it.')).not.toBeInTheDocument()
  })
})
