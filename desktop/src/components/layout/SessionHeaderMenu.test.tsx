import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => key,
}))

const mocks = vi.hoisted(() => ({
  renameSession: vi.fn(),
  deleteSession: vi.fn(),
  enterBatchMode: vi.fn(),
  disconnectSession: vi.fn(),
  closeTab: vi.fn(),
  setSidebarOpen: vi.fn(),
  addToast: vi.fn(),
  exportSession: vi.fn(),
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: { getState: () => ({
    renameSession: mocks.renameSession,
    deleteSession: mocks.deleteSession,
    enterBatchMode: mocks.enterBatchMode,
  }) },
}))
vi.mock('../../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ disconnectSession: mocks.disconnectSession }) },
}))
vi.mock('../../stores/tabStore', () => ({
  useTabStore: { getState: () => ({ closeTab: mocks.closeTab }) },
}))
vi.mock('../../stores/uiStore', () => {
  const state = () => ({ setSidebarOpen: mocks.setSidebarOpen, addToast: mocks.addToast })
  return { useUIStore: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }) }
})
vi.mock('../../api/sessions', () => ({
  sessionsApi: { exportSession: mocks.exportSession },
}))

import { SessionHeaderMenu } from './SessionHeaderMenu'

describe('SessionHeaderMenu', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
  })

  it('renames the session from a dialog', async () => {
    render(<SessionHeaderMenu sessionId="s1" title="Old title" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'session.header.actions' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.rename' }))

    const input = await screen.findByRole('textbox', { name: 'common.rename' })
    expect(input).toHaveValue('Old title')
    fireEvent.change(input, { target: { value: 'New title' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.renameSession).toHaveBeenCalledWith('s1', 'New title'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'session.header.actions' })).toHaveFocus())
  })

  it('enters batch mode with the sidebar open', () => {
    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'session.header.actions' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'sidebar.batchManage' }))

    expect(mocks.setSidebarOpen).toHaveBeenCalledWith(true)
    expect(mocks.enterBatchMode).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('deletes the session after confirmation', async () => {
    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'session.header.actions' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.delete' }))
    expect(mocks.deleteSession).not.toHaveBeenCalled()

    const confirm = await screen.findByRole('button', { name: 'common.delete' })
    fireEvent.click(confirm)

    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('s1'))
    expect(mocks.disconnectSession).toHaveBeenCalledWith('s1')
    expect(mocks.closeTab).toHaveBeenCalledWith('s1')
  })

  it('closes the menu on Escape without bubbling to outer layers', () => {
    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'session.header.actions' }), { key: 'ArrowDown' })
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('exports the session with the chosen options and downloads it outside the desktop app', async () => {
    mocks.exportSession.mockResolvedValue({ fileName: '2026-10-20-T.md', format: 'markdown', content: '# T\n' })
    const createObjectURL = vi.fn(() => 'blob:export')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'session.header.actions' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'exportSession.menuItem' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'exportSession.includeThinking' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'exportSession.redact' }))
    fireEvent.click(screen.getByRole('button', { name: 'exportSession.save' }))

    await waitFor(() => expect(mocks.exportSession).toHaveBeenCalledWith('s1', {
      format: 'markdown',
      includeThinking: true,
      fullToolOutput: false,
      redact: true,
    }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
    expect(mocks.addToast).toHaveBeenCalledWith({ type: 'success', message: 'exportSession.saved' })
    click.mockRestore()
  })

  it('turns off the Markdown-only options for JSON', async () => {
    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'session.header.actions' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'exportSession.menuItem' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'JSON' }))

    expect(screen.getByRole('checkbox', { name: 'exportSession.includeThinking' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'exportSession.fullToolOutput' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'exportSession.redact' })).toBeEnabled()
  })
})
