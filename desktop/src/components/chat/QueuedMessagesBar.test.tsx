import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueuedMessagesBar } from './QueuedMessagesBar'
import { useChatStore } from '../../stores/chatStore'
import type { SessionState } from '../../types/chat'

const SESSION_ID = 'session-1'

function setQueued(queuedMessages: SessionState['queuedMessages']) {
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
    pendingReports: [],
    queuedMessages,
    team: null,
    clientCount: 1,
  }
  act(() => {
    useChatStore.setState({
      sessions: { [SESSION_ID]: { ...useChatStore.getState().getSession(SESSION_ID), mirror } },
    })
  })
}

describe('QueuedMessagesBar', () => {
  const cancelQueuedMessage = vi.fn()
  const sendQueuedNow = vi.fn()

  beforeEach(() => {
    cancelQueuedMessage.mockReset()
    sendQueuedNow.mockReset()
    useChatStore.setState({ sessions: {}, cancelQueuedMessage, sendQueuedNow } as Partial<ReturnType<typeof useChatStore.getState>>)
  })

  afterEach(() => cleanup())

  it('renders nothing without queued messages', () => {
    setQueued([])
    const { container } = render(<QueuedMessagesBar sessionId={SESSION_ID} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each message with its attachment count', () => {
    setQueued([
      { id: 'a', content: 'first follow-up', attachmentCount: 0, createdAt: 1 },
      { id: 'b', content: 'second follow-up', attachmentCount: 2, createdAt: 2 },
    ])
    render(<QueuedMessagesBar sessionId={SESSION_ID} />)

    expect(screen.getByText('Queued - sends when this turn ends')).toBeInTheDocument()
    expect(screen.getByText('first follow-up')).toBeInTheDocument()
    expect(screen.getByText('second follow-up')).toBeInTheDocument()
    expect(screen.getAllByText(/^Attachments:/)).toHaveLength(1)
    expect(screen.getByText('Attachments: 2')).toBeInTheDocument()
  })

  it('withdraws one message by id', () => {
    setQueued([
      { id: 'a', content: 'first follow-up', attachmentCount: 0, createdAt: 1 },
      { id: 'b', content: 'second follow-up', attachmentCount: 0, createdAt: 2 },
    ])
    render(<QueuedMessagesBar sessionId={SESSION_ID} />)

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw queued message: second follow-up' }))

    expect(cancelQueuedMessage).toHaveBeenCalledWith(SESSION_ID, 'b')
  })

  it('sends the queue now', () => {
    setQueued([{ id: 'a', content: 'first follow-up', attachmentCount: 0, createdAt: 1 }])
    render(<QueuedMessagesBar sessionId={SESSION_ID} />)

    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))

    expect(sendQueuedNow).toHaveBeenCalledWith(SESSION_ID)
  })
})
