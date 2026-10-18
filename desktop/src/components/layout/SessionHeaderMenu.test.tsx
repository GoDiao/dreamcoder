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
vi.mock('../../stores/uiStore', () => ({
  useUIStore: { getState: () => ({ setSidebarOpen: mocks.setSidebarOpen }) },
}))

import { SessionHeaderMenu } from './SessionHeaderMenu'

describe('SessionHeaderMenu', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
  })

  it('renames the session from a dialog', async () => {
    render(<SessionHeaderMenu sessionId="s1" title="Old title" />)
    fireEvent.click(screen.getByRole('button', { name: 'session.header.actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.rename' }))

    const input = screen.getByRole('textbox', { name: 'common.rename' })
    expect(input).toHaveValue('Old title')
    fireEvent.change(input, { target: { value: 'New title' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.renameSession).toHaveBeenCalledWith('s1', 'New title'))
  })

  it('enters batch mode with the sidebar open', () => {
    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.click(screen.getByRole('button', { name: 'session.header.actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'sidebar.batchManage' }))

    expect(mocks.setSidebarOpen).toHaveBeenCalledWith(true)
    expect(mocks.enterBatchMode).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('deletes the session after confirmation', async () => {
    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.click(screen.getByRole('button', { name: 'session.header.actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.delete' }))
    expect(mocks.deleteSession).not.toHaveBeenCalled()

    const confirm = screen.getAllByRole('button', { name: 'common.delete' }).slice(-1)[0]!
    fireEvent.click(confirm)

    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('s1'))
    expect(mocks.disconnectSession).toHaveBeenCalledWith('s1')
    expect(mocks.closeTab).toHaveBeenCalledWith('s1')
  })

  it('closes the menu on Escape without bubbling to outer layers', () => {
    render(<SessionHeaderMenu sessionId="s1" title="T" />)
    fireEvent.click(screen.getByRole('button', { name: 'session.header.actions' }))
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
