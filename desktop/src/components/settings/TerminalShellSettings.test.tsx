import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalShellSettings } from './TerminalShellSettings'
import { useSettingsStore } from '../../stores/settingsStore'

const native = vi.hoisted(() => ({ detect: vi.fn() }))
vi.mock('../../api/terminal', () => ({ terminalApi: {
  isAvailable: () => true,
  detectDefaultShell: native.detect,
} }))

describe('default shell preferences', () => {
  beforeEach(() => {
    native.detect.mockResolvedValue({ platform: 'macos', shell: '/bin/zsh' })
    useSettingsStore.setState({
      locale: 'en',
      desktopTerminal: { startupShell: 'system', customShellPath: '' },
      setDesktopTerminal: vi.fn().mockResolvedValue(undefined),
    })
  })
  afterEach(cleanup)

  it.each(['macos', 'linux'])('shows detection and Unix choices on %s', async (platform) => {
    native.detect.mockResolvedValue({ platform, shell: '/usr/bin/fish' })
    render(<TerminalShellSettings title="Default shell" />)
    await waitFor(() => expect(native.detect).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Default shell' })) })
    expect(screen.getByText('/usr/bin/fish')).toBeInTheDocument()
    for (const shell of ['zsh', 'bash', 'fish']) {
      expect(screen.getByRole('button', { name: shell })).toBeInTheDocument()
    }
    expect(screen.queryByText('Command Prompt')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'fish' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(useSettingsStore.getState().setDesktopTerminal).toHaveBeenCalledWith({ startupShell: 'fish', customShellPath: '' })
  })

  it('keeps Windows shell choices using the native host platform', async () => {
    native.detect.mockResolvedValue({ platform: 'windows', shell: 'cmd.exe' })
    render(<TerminalShellSettings />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Startup shell' })) })
    expect(screen.getByText('cmd.exe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Command Prompt/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'fish' })).not.toBeInTheDocument()
  })

  it('validates custom Unix paths and persists a trimmed absolute path', async () => {
    useSettingsStore.setState({ desktopTerminal: { startupShell: 'custom', customShellPath: '' } })
    render(<TerminalShellSettings />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(screen.getByText('Enter a shell path before saving.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Custom shell path'), { target: { value: 'bin/fish' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save shell' }))
    expect(screen.getByText('Custom shell path must be an absolute path.')).toBeInTheDocument()
    expect(useSettingsStore.getState().setDesktopTerminal).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Custom shell path'), { target: { value: ' /opt/homebrew/bin/fish ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(useSettingsStore.getState().setDesktopTerminal).toHaveBeenCalledWith({ startupShell: 'custom', customShellPath: '/opt/homebrew/bin/fish' })
    expect(screen.getByText('Saved. Restart or open a new terminal to apply it.')).toBeInTheDocument()
  })

  it('displays save failures without claiming success', async () => {
    useSettingsStore.setState({ setDesktopTerminal: vi.fn().mockRejectedValue(new Error('save failed')) })
    render(<TerminalShellSettings />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save shell' })) })
    expect(screen.getByText('save failed')).toBeInTheDocument()
    expect(screen.queryByText('Saved. Restart or open a new terminal to apply it.')).not.toBeInTheDocument()
  })
})
