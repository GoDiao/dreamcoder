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
      slashCommands: [],
      activeGoal: null,
      backgroundTasks: [],
      uiPages: [],
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
    render(<StreamingIndicator />)
    expect(screen.getByText('1m 5s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('1m 6s')).toBeInTheDocument()
  })

  it('shows the time of the session switched to', () => {
    render(<StreamingIndicator />)
    showTab('b')

    expect(screen.getByText('3s')).toBeInTheDocument()
    expect(screen.queryByText('1m 5s')).not.toBeInTheDocument()
  })

  it('keeps counting from the same start after a reconnect snapshot', () => {
    render(<StreamingIndicator />)
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
    render(<StreamingIndicator />)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText(/^\d+s$/)).not.toBeInTheDocument()
  })
})
