import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PendingReportsBar } from './PendingReportsBar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import type { SessionState } from '../../types/chat'

const SESSION_ID = 'parent-1'

type Reports = SessionState['pendingReports']

function setReports(pendingReports: Reports) {
  const mirror: SessionState = {
    id: SESSION_ID,
    version: 1,
    permission: { desired: 'default', effective: 'default' },
    runtime: { desired: null, effective: null },
    title: { text: null, source: null },
    workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
    process: { phase: 'running', generation: 1 },
    turn: { phase: 'idle' },
    pendingPermissions: [],
    pendingBrowserGrants: [],
    browserActivity: null,
    slashCommands: [],
    activeGoal: null,
    backgroundTasks: [],
    uiPages: [],
    pendingReports,
    queuedMessages: [],
    team: null,
    clientCount: 1,
  }
  act(() => {
    useChatStore.setState({
      sessions: { [SESSION_ID]: { ...useChatStore.getState().getSession(SESSION_ID), mirror } },
    })
  })
}

const report = (id: string, summary: string, createdAt = Date.now() - 5 * 60000): Reports[number] => ({
  id,
  from: { sessionId: `child-${id}`, name: `worker-${id}` },
  summary,
  createdAt,
})

describe('PendingReportsBar', () => {
  const connectToSession = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [] })
    useChatStore.setState({ sessions: {}, connectToSession } as Partial<ReturnType<typeof useChatStore.getState>>)
  })

  afterEach(() => cleanup())

  it('renders nothing without queued reports', () => {
    setReports([])
    const { container } = render(<PendingReportsBar sessionId={SESSION_ID} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a singular and a plural count', () => {
    setReports([report('1', 'tests green')])
    render(<PendingReportsBar sessionId={SESSION_ID} />)
    expect(screen.getByText('1 progress report waiting')).toBeInTheDocument()

    setReports([report('1', 'tests green'), report('2', 'docs done')])
    expect(screen.getByText('2 progress reports waiting')).toBeInTheDocument()
  })

  it('lists sender, summary, age and the delivery hint when expanded', () => {
    setReports([report('1', 'tests green'), report('2', 'docs done')])
    render(<PendingReportsBar sessionId={SESSION_ID} />)

    fireEvent.click(screen.getByRole('button', { name: '2 progress reports waiting' }))

    expect(screen.getByText('tests green')).toBeInTheDocument()
    expect(screen.getByText('docs done')).toBeInTheDocument()
    expect(screen.getAllByText('5m ago')).toHaveLength(2)
    expect(screen.getByText('They will be delivered with your next message.')).toBeInTheDocument()
  })

  it('opens the sender session from its title', () => {
    setReports([report('1', 'tests green')])
    render(<PendingReportsBar sessionId={SESSION_ID} />)
    fireEvent.click(screen.getByRole('button', { name: '1 progress report waiting' }))

    fireEvent.click(screen.getByRole('button', { name: 'Open session worker-1' }))

    expect(useTabStore.getState().activeTabId).toBe('child-1')
    expect(connectToSession).toHaveBeenCalledWith('child-1')
  })
})
