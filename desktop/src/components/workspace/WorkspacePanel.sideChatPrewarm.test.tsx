import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '../../types/chat'

const socket = vi.hoisted(() => ({
  send: vi.fn(),
  handlers: new Map<string, (message: unknown) => void>(),
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    clearHandlers: vi.fn(),
    onMessage: (sessionId: string, handler: (message: unknown) => void) => {
      socket.handlers.set(sessionId, handler)
      return () => socket.handlers.delete(sessionId)
    },
    send: socket.send,
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    listSideChats: vi.fn(async () => ({ sessions: [{ id: 'side-a' }, { id: 'side-b' }] })),
    getWorkspaceStatus: vi.fn(async () => ({ state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] })),
    getTranscript: vi.fn(async () => ({ items: [], agentNotifications: {}, lastTodos: null, hasMessagesAfterTaskCompletion: false })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

vi.mock('../../api/cliTasks', () => ({
  cliTasksApi: { getTasksForList: vi.fn(async () => ({ tasks: [] })), resetTaskList: vi.fn() },
}))

vi.mock('../chat/MessageList', () => ({ MessageList: () => <div /> }))
vi.mock('../chat/ChatInput', () => ({ ChatInput: () => <div /> }))

import { useChatStore } from '../../stores/chatStore'
import { useWorkspacePanelStore, type WorkspaceTab } from '../../stores/workspacePanelStore'
import { WorkspacePanel } from './WorkspacePanel'

function snapshot(sessionId: string): SessionState {
  return {
    id: sessionId,
    version: 1,
    permission: { desired: 'default', effective: 'default' },
    runtime: { desired: null, effective: null },
    title: { text: `btw: ${sessionId}`, source: 'custom' },
    workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
    process: { phase: 'stopped', generation: 0 },
    turn: { phase: 'idle' },
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
  }
}

function deliverSnapshots() {
  act(() => {
    for (const [sessionId, handler] of socket.handlers) handler({ type: 'session_snapshot', state: snapshot(sessionId) })
  })
}

function prewarmed() {
  return socket.send.mock.calls.flatMap(([sessionId, message]) => (message as { type: string }).type === 'prewarm_session' ? [sessionId] : [])
}

describe('side chat prewarming in the parent panel', () => {
  const sideA: WorkspaceTab = { id: 'tab-a', kind: 'sideChat', sessionId: 'side-a' }
  const sideB: WorkspaceTab = { id: 'tab-b', kind: 'sideChat', sessionId: 'side-b' }
  const initialChatState = useChatStore.getState()

  beforeEach(() => {
    useWorkspacePanelStore.setState({
      panelByTab: { parent: { isOpen: true, expanded: false, tabs: [sideA, sideB], activeTabId: sideA.id, recentFiles: [], selectedFile: null } },
    })
  })

  afterEach(() => {
    cleanup()
    for (const sessionId of Object.keys(useChatStore.getState().sessions)) useChatStore.getState().disconnectSession(sessionId)
    useChatStore.setState(initialChatState, true)
    useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
    socket.send.mockReset()
    socket.handlers.clear()
    localStorage.clear()
  })

  it('connects every side chat but prewarms only the one on screen', async () => {
    await act(async () => {
      render(<WorkspacePanel panelId="parent" sessionTitle="Parent" />)
    })
    deliverSnapshots()

    expect([...socket.handlers.keys()].sort()).toEqual(['side-a', 'side-b'])
    expect(prewarmed()).toEqual(['side-a'])
  })

  it('prewarms another side chat when it is switched to', async () => {
    await act(async () => {
      render(<WorkspacePanel panelId="parent" sessionTitle="Parent" />)
    })
    deliverSnapshots()
    expect(prewarmed()).toEqual(['side-a'])

    act(() => useWorkspacePanelStore.getState().activateTab('parent', sideB.id))

    expect(prewarmed()).toEqual(['side-a', 'side-b'])
  })
})
