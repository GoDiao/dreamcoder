import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stopBrowserControl: vi.fn(),
}))

vi.mock('../../lib/shell', () => ({
  stopBrowserControl: mocks.stopBrowserControl,
}))

import { toast } from 'sonner'
import { useChatStore } from '../../stores/chatStore'
import type { SessionState } from '../../types/chat'
import { BrowserActivityBar } from './BrowserActivityBar'

function mirror(browserActivity: SessionState['browserActivity']): SessionState {
  return {
    id: 's1',
    version: 1,
    permission: { desired: 'default', effective: 'default' },
    runtime: { desired: null, effective: null },
    title: { text: null, source: null },
    workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
    process: { phase: 'running', generation: 1 },
    turn: { phase: 'idle' },
    pendingPermissions: [],
    pendingBrowserGrants: [],
    browserActivity,
    slashCommands: [],
    activeGoal: null,
    backgroundTasks: [],
    uiPages: [],
    team: null,
    clientCount: 1,
  }
}

function setActivity(sessionId: string, browserActivity: SessionState['browserActivity']) {
  act(() => {
    useChatStore.setState((state) => ({
      sessions: { ...state.sessions, [sessionId]: { ...state.getSession(sessionId), mirror: { ...mirror(browserActivity), id: sessionId } } },
    }))
  })
}

describe('BrowserActivityBar', () => {
  beforeEach(() => {
    mocks.stopBrowserControl.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    useChatStore.setState(useChatStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('is hidden while the agent is not operating the browser', () => {
    setActivity('s1', null)
    render(<BrowserActivityBar sessionId="s1" tabId="t1" />)

    expect(screen.queryByTestId('browser-activity')).not.toBeInTheDocument()
  })

  it('is hidden for a session without a mirror', () => {
    render(<BrowserActivityBar sessionId="s1" tabId="t1" />)

    expect(screen.queryByTestId('browser-activity')).not.toBeInTheDocument()
  })

  it('shows only on the tab being operated and follows the session state', () => {
    setActivity('s1', { tabId: 't1' })
    const { rerender } = render(<BrowserActivityBar sessionId="s1" tabId="t1" />)
    expect(screen.getByRole('status')).toHaveTextContent('The agent is operating this page')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()

    rerender(<BrowserActivityBar sessionId="s1" tabId="t2" />)
    expect(screen.queryByTestId('browser-activity')).not.toBeInTheDocument()

    rerender(<BrowserActivityBar sessionId="s1" tabId="t1" />)
    setActivity('s1', null)
    expect(screen.queryByTestId('browser-activity')).not.toBeInTheDocument()
  })

  it('ignores the activity of another session', () => {
    setActivity('s2', { tabId: 't1' })
    render(<BrowserActivityBar sessionId="s1" tabId="t1" />)

    expect(screen.queryByTestId('browser-activity')).not.toBeInTheDocument()
  })

  it('stops through the desktop shell only and shows a pending state until it answers', async () => {
    let finish!: () => void
    mocks.stopBrowserControl.mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve
    }))
    setActivity('s1', { tabId: 't1' })
    render(<BrowserActivityBar sessionId="s1" tabId="t1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(mocks.stopBrowserControl).toHaveBeenCalledOnce()
    expect(mocks.stopBrowserControl).toHaveBeenCalledWith({ sessionId: 's1' })
    const pending = screen.getByRole('button', { name: 'Stopping' })
    expect(pending).toBeDisabled()
    fireEvent.click(pending)
    expect(mocks.stopBrowserControl).toHaveBeenCalledOnce()

    await act(async () => {
      finish()
    })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a failed stop and lets the user try again', async () => {
    mocks.stopBrowserControl.mockRejectedValueOnce(new Error('channel closed'))
    setActivity('s1', { tabId: 't1' })
    render(<BrowserActivityBar sessionId="s1" tabId="t1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    })

    expect(toast.error).toHaveBeenCalledWith('Could not stop the agent: channel closed')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    })
    expect(mocks.stopBrowserControl).toHaveBeenCalledTimes(2)
  })
})
