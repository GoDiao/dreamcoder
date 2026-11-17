import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: vi.fn(),
  },
}))

import { StreamingIndicator } from './StreamingIndicator'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import type { SessionState } from '../../types/chat'

const NOW = 1_000_000

function sessionWithTurn(sessionId: string, turn: SessionState['turn']): PerSessionState {
  return {
    messages: [],
    chatState: 'thinking',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    statusVerb: '',
    slashCommands: [],
    agentTaskNotifications: {},
    mirror: {
      id: sessionId,
      version: 1,
      permission: { desired: 'default', effective: 'default' },
      runtime: { desired: null, effective: null },
      title: { text: null, source: null },
      workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
      process: { phase: 'running', generation: 1 },
      turn,
      pendingPermissions: [],
      pendingBrowserGrants: [],
      browserActivity: null,
      artifactWait: null,
      slashCommands: [],
      activeGoal: null,
      backgroundTasks: [],
      uiPages: [],
      pendingReports: [],
      queuedMessages: [],
      team: null,
      clientCount: 1,
    },
  }
}

function showTab(sessionId: string) {
  act(() => {
    useTabStore.setState({
      activeTabId: sessionId,
      tabs: [
        { sessionId: 'a', title: 'A', type: 'session', status: 'running' },
        { sessionId: 'b', title: 'B', type: 'session', status: 'running' },
      ],
    })
  })
}

describe('StreamingIndicator elapsed time', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState({
      sessions: {
        a: sessionWithTurn('a', { phase: 'running', startedAt: NOW - 65_000, activity: 'thinking' }),
        b: sessionWithTurn('b', { phase: 'running', startedAt: NOW - 3_000, activity: 'thinking' }),
      },
    })
    showTab('a')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('counts from the turn start the server reported and ticks every second', () => {
    render(<StreamingIndicator sessionId="a" />)
    expect(screen.getByText('1m 5s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('1m 6s')).toBeInTheDocument()
  })

  it('shows the time of the session switched to', () => {
    const view = render(<StreamingIndicator sessionId="a" />)
    view.rerender(<StreamingIndicator sessionId="b" />)

    expect(screen.getByText('3s')).toBeInTheDocument()
    expect(screen.queryByText('1m 5s')).not.toBeInTheDocument()
  })

  it('keeps counting from the same start after a reconnect snapshot', () => {
    render(<StreamingIndicator sessionId="a" />)
    act(() => {
      vi.advanceTimersByTime(2000)
      useChatStore.setState({
        sessions: {
          ...useChatStore.getState().sessions,
          a: sessionWithTurn('a', { phase: 'running', startedAt: NOW - 65_000, activity: 'streaming' }),
        },
      })
    })

    expect(screen.getByText('1m 7s')).toBeInTheDocument()
  })

  it('shows no time when the server has not started a turn', () => {
    useChatStore.setState({ sessions: { a: sessionWithTurn('a', { phase: 'idle' }) } })
    render(<StreamingIndicator sessionId="a" />)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText(/^\d+s$/)).not.toBeInTheDocument()
  })
})

describe('StreamingIndicator while the agent waits for the user', () => {
  const waiting = (wait: SessionState['artifactWait']) => {
    const session = sessionWithTurn('a', { phase: 'running', startedAt: NOW, activity: 'tool' })
    return { ...session, chatState: 'tool_executing' as const, mirror: { ...session.mirror!, artifactWait: wait } }
  }

  afterEach(() => {
    cleanup()
  })

  it('says it waits for the user to finish editing the artifact, and goes back to the usual text once that ends', () => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState({ sessions: { a: waiting({ folder: '/repo/dc_artifacts/talk', title: 'Quarterly review' }) } })
    render(<StreamingIndicator sessionId="a" />)
    expect(screen.getByText('Waiting for you to finish editing “Quarterly review”...')).toBeInTheDocument()

    act(() => {
      useChatStore.setState({ sessions: { a: waiting(null) } })
    })
    expect(screen.queryByText(/Waiting for you/)).not.toBeInTheDocument()
    expect(screen.getByText('Running...')).toBeInTheDocument()
  })

  it('uses the language of the app', () => {
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({ sessions: { a: waiting({ folder: '/repo/dc_artifacts/talk', title: 'Talk' }) } })
    render(<StreamingIndicator sessionId="a" />)
    expect(screen.getByText('正在等你改完「Talk」...')).toBeInTheDocument()
  })
})
