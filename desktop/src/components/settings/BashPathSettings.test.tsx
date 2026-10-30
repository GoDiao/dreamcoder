import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsApi } from '../../api/settings'
import { useSettingsStore } from '../../stores/settingsStore'

const validateBashPath = vi.hoisted(() => vi.fn())
vi.mock('../../api/terminal', () => ({ terminalApi: { validateBashPath } }))

import { BashPathSettings } from './BashPathSettings'

describe('BashPathSettings', () => {
  beforeEach(() => {
    validateBashPath.mockReset()
    validateBashPath.mockResolvedValue(undefined)
    useSettingsStore.setState({
      locale: 'en',
      desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: null },
      setDesktopTerminal: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    vi.restoreAllMocks()
  })

  it.each([
    ['en', 'Save', 'Could not save the Bash path.', 'save'],
    ['en', 'Reset to default', 'Could not save the Bash path.', 'reset'],
    ['zh', '保存', '无法保存 Bash 路径。', 'save'],
    ['zh', '恢复默认', '无法保存 Bash 路径。', 'reset'],
  ] as const)('localizes %s %s failures and logs the original error', async (locale, button, message, operation) => {
    const error = new Error('settings unavailable')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    useSettingsStore.setState({
      locale,
      desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: 'C:\\Git\\bash.exe' },
      setDesktopTerminal: vi.fn().mockRejectedValue(error),
    })
    render(<BashPathSettings />)
    const input = await screen.findByPlaceholderText(locale === 'en' ? 'Bash Path' : 'Bash 路径')
    fireEvent.change(input, { target: { value: 'C:\\Tools\\Git\\bash.exe' } })
    fireEvent.click(screen.getByRole('button', { name: button }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('alert')).not.toHaveTextContent('settings unavailable')
    expect(logError).toHaveBeenCalledWith(`[terminal] Failed to ${operation} Bash path`, error)
    expect(input).toHaveValue('C:\\Tools\\Git\\bash.exe')
    expect(screen.queryByText('Path does not exist. Select a valid Bash executable.')).not.toBeInTheDocument()
  })

  it('clears the saved Bash path through the sidecar settings store', async () => {
    const updateUser = vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
    useSettingsStore.setState({
      desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: 'C:\\Git\\bash.exe' },
      setDesktopTerminal: useSettingsStore.getInitialState().setDesktopTerminal,
    })
    render(<BashPathSettings />)
    const input = await screen.findByPlaceholderText('Bash Path')
    fireEvent.change(input, { target: { value: 'C:\\Tools\\Git\\bash.exe' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Reset to default' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(updateUser).toHaveBeenCalledWith({
      desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: null },
    })
    expect(useSettingsStore.getState().desktopTerminal.bashPath).toBeNull()
    expect(input).toHaveValue('')
  })

  it('preserves the Bash path draft after a failed save and retries that draft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const previousPath = 'C:\\Git\\bash.exe'
    const draftPath = 'C:\\Tools\\Git\\bash.exe'
    let rejectSave!: (reason: Error) => void
    const pendingSave = new Promise<{ ok: true }>((_, reject) => { rejectSave = reject })
    const updateUser = vi.spyOn(settingsApi, 'updateUser')
      .mockReturnValueOnce(pendingSave)
      .mockResolvedValue({ ok: true })
    useSettingsStore.setState({
      desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: previousPath },
      setDesktopTerminal: useSettingsStore.getInitialState().setDesktopTerminal,
    })

    render(<BashPathSettings />)
    const input = await screen.findByDisplayValue(previousPath)
    fireEvent.change(input, { target: { value: draftPath } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1))
    expect(useSettingsStore.getState().desktopTerminal.bashPath).toBe(draftPath)
    expect(input).toBeDisabled()
    await act(async () => { rejectSave(new Error('settings unavailable')) })

    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the Bash path.')
    expect(useSettingsStore.getState().desktopTerminal.bashPath).toBe(previousPath)
    expect(input).toHaveValue(draftPath)
    expect(input).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2))
    expect(updateUser).toHaveBeenLastCalledWith({
      desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: draftPath },
    })
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(useSettingsStore.getState().desktopTerminal.bashPath).toBe(draftPath)
    expect(input).toHaveValue(draftPath)

    act(() => {
      useSettingsStore.setState({
        desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: previousPath },
      })
    })
    expect(input).toHaveValue(previousPath)
  })

  it('saves a custom Windows bash path', async () => {
    useSettingsStore.setState({ desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' } })

    render(<BashPathSettings />)

    const input = await screen.findByDisplayValue('C:\\Program Files\\Git\\bin\\bash.exe')
    fireEvent.change(input, { target: { value: ' C:\\Tools\\Git\\bin\\bash.exe ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(validateBashPath).toHaveBeenCalledWith('C:\\Tools\\Git\\bin\\bash.exe')
      expect(useSettingsStore.getState().setDesktopTerminal).toHaveBeenCalledWith({ bashPath: 'C:\\Tools\\Git\\bin\\bash.exe' })
    })
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
  })

  it('shows an invalid path message when native bash path validation fails', async () => {
    validateBashPath.mockRejectedValue(new Error('terminal bash path does not exist'))

    render(<BashPathSettings />)

    const input = await screen.findByPlaceholderText('Bash Path')
    fireEvent.change(input, { target: { value: 'C:\\missing\\bash.exe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Path does not exist. Select a valid Bash executable.')).toBeInTheDocument()
  })
})
