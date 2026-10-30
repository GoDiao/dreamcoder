import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportSessionDialog } from './ExportSessionDialog'
import { sessionsApi } from '../../api/sessions'
import { useSettingsStore } from '../../stores/settingsStore'

const mocks = vi.hoisted(() => ({
  pickExportPath: vi.fn(async () => null),
  writeSessionExport: vi.fn(),
}))

vi.mock('../../lib/shell', () => ({
  pickExportPath: mocks.pickExportPath,
  writeSessionExport: mocks.writeSessionExport,
}))

vi.mock('../../lib/desktopRuntime', () => ({
  isDesktopRuntime: () => true,
}))

const originalLocale = useSettingsStore.getState().locale

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useSettingsStore.setState({ locale: originalLocale })
})

describe('ExportSessionDialog', () => {
  it('sends the checked options when saving', async () => {
    const exportSession = vi.spyOn(sessionsApi, 'exportSession').mockResolvedValue({ format: 'markdown', fileName: 'chat.md', content: '' })
    render(<ExportSessionDialog sessionId="s1" open onClose={() => {}} />)

    const thinking = screen.getByRole('checkbox', { name: 'Include thinking' })
    expect(thinking).not.toBeChecked()
    fireEvent.click(thinking)
    expect(thinking).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Redact secrets and home folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save…' }))

    await waitFor(() => expect(exportSession).toHaveBeenCalledWith('s1', { format: 'markdown', includeThinking: true, fullToolOutput: false, redact: true }))
  })

  it('disables the Markdown-only options for JSON', () => {
    render(<ExportSessionDialog sessionId="s1" open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }))

    expect(screen.getByRole('checkbox', { name: 'Include thinking' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Full tool output/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Redact secrets and home folder' })).toBeEnabled()
  })
})
