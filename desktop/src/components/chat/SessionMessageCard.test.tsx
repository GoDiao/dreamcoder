import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SessionMessageCard } from './SessionMessageCard'
import { MessageBlock } from './MessageList'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import type { SessionOrigin, UIMessage } from '../../types/chat'

const origin: SessionOrigin = { kind: 'session', sessionId: 'child-1', name: 'docs-reorg', purpose: 'report' }

describe('SessionMessageCard', () => {
  const connectToSession = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [] })
    useChatStore.setState({ sessions: {}, connectToSession } as Partial<ReturnType<typeof useChatStore.getState>>)
  })

  afterEach(() => cleanup())

  it('is collapsed by default and shows the summary as the preview', () => {
    render(<SessionMessageCard content={'Result: **all green**'} origin={{ ...origin, summary: 'Docs moved, links fixed' }} />)

    expect(screen.getByText('docs-reorg')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
    expect(screen.getByText('Docs moved, links fixed')).toBeInTheDocument()
    expect(screen.queryByText('all green')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy prompt' })).not.toBeInTheDocument()
  })

  it('previews the first line of the body when there is no summary', () => {
    render(<SessionMessageCard content={'First line\nSecond line'} origin={origin} />)

    expect(screen.getByText('First line')).toBeInTheDocument()
    expect(screen.queryByText(/Second line/)).not.toBeInTheDocument()
  })

  it('expands to the body as markdown, with the copy action', () => {
    render(<SessionMessageCard content={'Result: **all green**'} origin={origin} />)

    fireEvent.click(screen.getByText('Report'))

    expect(screen.getByText('all green').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
  })

  it.each([
    ['message', 'Message'],
    ['brief', 'Brief'],
    ['report', 'Report'],
  ] as const)('labels the %s purpose', (purpose, label) => {
    render(<SessionMessageCard content="x" origin={{ ...origin, purpose }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows the current session title instead of the title at send time', () => {
    useSessionStore.setState({
      sessions: [{
        id: 'child-1', title: 'Project manager', createdAt: '', modifiedAt: '', messageCount: 1,
        projectPath: '/p', workDir: '/p', workDirExists: true,
      }],
    })
    render(<SessionMessageCard content="x" origin={origin} />)

    expect(screen.getByRole('button', { name: 'Open session Project manager' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open session docs-reorg' })).not.toBeInTheDocument()
  })

  it('falls back to the known session title when the origin has no title', () => {
    useSessionStore.setState({
      sessions: [{
        id: 'child-1', title: 'Reorganise docs', createdAt: '', modifiedAt: '', messageCount: 1,
        projectPath: '/p', workDir: '/p', workDirExists: true,
      }],
    })
    render(<SessionMessageCard content="x" origin={{ kind: 'session', sessionId: 'child-1', purpose: 'message' }} />)

    expect(screen.getByRole('button', { name: 'Open session Reorganise docs' })).toBeInTheDocument()
  })

  it('opens the source session when the title is clicked', () => {
    render(<SessionMessageCard content="x" origin={origin} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open session docs-reorg' }))

    expect(useTabStore.getState().activeTabId).toBe('child-1')
    expect(connectToSession).toHaveBeenCalledWith('child-1')
    expect(screen.queryByRole('button', { name: 'Copy prompt' })).not.toBeInTheDocument()
  })

  it('keeps the open-session control outside the collapsible trigger as a native button', () => {
    render(<SessionMessageCard content="x" origin={origin} />)

    const open = screen.getByRole('button', { name: 'Open session docs-reorg' })
    expect(open.tagName).toBe('BUTTON')
    expect(open.closest('[data-slot="trace-collapsible-trigger"]')).toBeNull()
    expect(screen.getByText('Report').closest('[data-slot="trace-collapsible-trigger"]')).not.toBeNull()
  })

  it('offers copy but no fork action', () => {
    render(<SessionMessageCard content="x" origin={origin} />)
    fireEvent.click(screen.getByText('Report'))

    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fork a new conversation' })).not.toBeInTheDocument()
  })
})

describe('MessageBlock user messages', () => {
  const base = { id: 'u-1', type: 'user_text', content: 'hello there', timestamp: 1 } as const

  function renderMessage(message: UIMessage) {
    return render(
      <MessageBlock
        sessionId="s-1"
        message={message}
        activeThinkingId={null}
        agentTaskNotifications={{}}
        branchAction={{ label: 'Fork a new conversation', onBranch: () => {} }}
      />,
    )
  }

  afterEach(() => cleanup())

  it('renders a message with a session origin as a card, without the fork action', () => {
    const { container } = renderMessage({ ...base, origin })

    expect(container.querySelector('[data-message-shell="session"]')).not.toBeNull()
    expect(container.querySelector('[data-message-shell="user"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fork a new conversation' })).not.toBeInTheDocument()
  })

  it('renders a message without origin as the user bubble with its fork action', () => {
    const { container } = renderMessage(base)

    expect(container.querySelector('[data-message-shell="user"]')).not.toBeNull()
    expect(container.querySelector('[data-message-shell="session"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Fork a new conversation' })).toBeInTheDocument()
  })
})
