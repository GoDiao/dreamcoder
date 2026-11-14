import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('./ChatInput', () => ({
  ChatInput: ({ sessionId, compact, primary }: { sessionId: string; compact?: boolean; primary?: boolean }) => (
    <div data-testid="chat-input" data-session={sessionId} data-compact={String(compact)} data-primary={String(primary)} />
  ),
}))

import { SessionConversation } from './SessionConversation'
import { useChatStore } from '../../stores/chatStore'
import { useCLITaskStore } from '../../stores/cliTaskStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

const initialChatState = useChatStore.getState()
const initialTabState = useTabStore.getInitialState()

function sessionWith(text: string) {
  return {
    ...useChatStore.getState().getSession('unused'),
    chatState: 'idle' as const,
    connectionState: 'connected' as const,
    messages: [{ id: `${text}-reply`, type: 'assistant_text' as const, content: text, timestamp: 1 }],
  }
}

describe('SessionConversation', () => {
  const connectToSession = vi.fn()
  const prewarmSession = vi.fn()

  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ activeTabId: 'main', tabs: [{ sessionId: 'main', title: 'Main', type: 'session', status: 'idle' }] })
    useChatStore.setState({
      connectToSession,
      prewarmSession,
      sessions: { main: sessionWith('main reply'), side: sessionWith('side reply') },
    })
    useCLITaskStore.setState({ bySession: {}, fetchSessionTasks: vi.fn(async () => {}) })
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'main task', status: 'in_progress', activeForm: 'main task' }], 'main')
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'side task', status: 'pending' }], 'side')
  })

  afterEach(() => {
    cleanup()
    connectToSession.mockReset()
    prewarmSession.mockReset()
    useChatStore.setState(initialChatState, true)
    useTabStore.setState(initialTabState, true)
    useCLITaskStore.setState(useCLITaskStore.getInitialState(), true)
  })

  it('shows and connects the session it is given, not the active tab', () => {
    const { container } = render(<SessionConversation sessionId="side" compact primary={false} />)

    expect(connectToSession).toHaveBeenCalledWith('side', { prewarm: false })
    expect(prewarmSession).toHaveBeenCalledWith('side')
    expect(connectToSession).not.toHaveBeenCalledWith('main', expect.anything())
    expect(screen.getByText('side reply')).toBeInTheDocument()
    expect(screen.queryByText('main reply')).not.toBeInTheDocument()
    expect(screen.getByText('0 of 1 done')).toBeInTheDocument()
    expect(screen.getByTestId('chat-input').dataset).toMatchObject({ session: 'side', compact: 'true', primary: 'false' })
    expect(container.querySelector('[data-session-view="side"]')).not.toBeNull()
  })

  it('shows the conversation, not the new-session placeholder, while a side chat’s history loads', () => {
    useChatStore.setState((state) => ({ sessions: { ...state.sessions, side: { ...state.sessions.side!, messages: [] } } }))

    render(<SessionConversation sessionId="side" compact primary={false} />)

    expect(screen.queryByText('Start a new task')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-input').dataset.session).toBe('side')
  })

  it('shows each session’s own task bar when the main view and a side chat are on screen together', () => {
    render(
      <>
        <SessionConversation sessionId="main" />
        <SessionConversation sessionId="side" compact primary={false} />
      </>,
    )

    const [mainView, sideView] = [
      document.querySelector<HTMLElement>('[data-session-view="main"]')!,
      document.querySelector<HTMLElement>('[data-session-view="side"]')!,
    ]
    expect(mainView).toHaveTextContent('main reply')
    expect(mainView).toHaveTextContent('0 of 1 done')
    expect(mainView.querySelector('[data-status="running"]')).not.toBeNull()
    expect(sideView).toHaveTextContent('side reply')
    expect(sideView.querySelector('[data-status="running"]')).toBeNull()
  })
})
