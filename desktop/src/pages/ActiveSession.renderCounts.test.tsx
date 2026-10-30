import { Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: vi.fn(),
  },
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: new Proxy({}, { get: () => () => new Promise(() => {}) }),
}))

vi.mock('../hooks/useMobileViewport', () => ({
  useMobileViewport: () => false,
  useViewportQuery: () => false,
}))

vi.mock('../components/chat/MessageList', () => ({
  MessageList: () => <div data-testid="message-list" />,
}))

vi.mock('../components/chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}))

vi.mock('../components/teams/TeamStatusBar', () => ({
  TeamStatusBar: () => <div data-testid="team-status-bar" />,
}))

vi.mock('../components/chat/SessionTaskBar', () => ({
  SessionTaskBar: () => <div data-testid="session-task-bar" />,
}))

vi.mock('../components/workspace/WorkspacePanel', () => ({
  WorkspacePanel: () => <div data-testid="workspace-panel" />,
}))

import { ActiveSession } from './ActiveSession'
import { useChatStore, type PerSessionState } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import {
  SCENARIO_SESSION_ID,
  installScenarioSession,
  playStreamingReply,
} from '../components/chat/streamingRenderScenario'

afterEach(() => {
  cleanup()
  useChatStore.setState(useChatStore.getInitialState(), true)
  useTabStore.setState(useTabStore.getInitialState(), true)
})

describe('ActiveSession render count during one streaming reply', () => {
  it('re-renders only when the page-level fields change', () => {
    useCLITaskStore.setState({ fetchSessionTasks: vi.fn(async () => {}) })
    installScenarioSession()
    let commits = 0
    render(
      <Profiler id="ActiveSession" onRender={() => { commits += 1 }}>
        <ActiveSession />
      </Profiler>,
    )
    commits = 0

    playStreamingReply()

    expect(commits).toBe(2)
  })
})

function patchSession(update: Partial<PerSessionState>) {
  act(() => {
    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [SCENARIO_SESSION_ID]: { ...state.sessions[SCENARIO_SESSION_ID]!, ...update },
      },
    }))
  })
}

describe('ActiveSession still updates on the fields it uses', () => {
  it('follows the running state, background tasks, the goal and the first message', () => {
    useSettingsStore.setState({ locale: 'en' })
    useCLITaskStore.setState({ fetchSessionTasks: vi.fn(async () => {}) })
    installScenarioSession()
    patchSession({ messages: [] })
    render(<ActiveSession />)

    expect(screen.queryByTestId('message-list')).not.toBeInTheDocument()
    patchSession({ streamingText: 'Hello' })
    expect(screen.getByTestId('message-list')).toBeInTheDocument()

    expect(screen.queryByTestId('session-header-running')).not.toBeInTheDocument()
    patchSession({ chatState: 'thinking' })
    expect(screen.getByTestId('session-header-running')).toBeInTheDocument()
    patchSession({ chatState: 'idle' })
    expect(screen.queryByTestId('session-header-running')).not.toBeInTheDocument()

    patchSession({ backgroundAgentTasks: { t1: { taskId: 't1', status: 'running', startedAt: 1, updatedAt: 1 } } })
    expect(screen.getByTestId('session-header-running')).toBeInTheDocument()
    patchSession({ backgroundAgentTasks: { t1: { taskId: 't1', status: 'completed', startedAt: 1, updatedAt: 2 } } })
    expect(screen.queryByTestId('session-header-running')).not.toBeInTheDocument()

    expect(screen.queryByText('Active goal')).not.toBeInTheDocument()
    patchSession({ activeGoal: { action: 'created', objective: 'Ship the release', updatedAt: 1 } })
    expect(screen.getByText('Active goal')).toBeInTheDocument()
  })
})
