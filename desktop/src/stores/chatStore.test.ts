import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from '../types/chat'
import type { SessionTranscript } from '../types/session'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import { useSettingsStore } from './settingsStore'

const {
  sendMock,
  getMemberBySessionIdMock,
  sendMessageToMemberMock,
  handleTeamCreatedMock,
  handleTeamUpdateMock,
  handleTeamDeletedMock,
  fetchSessionTasksMock,
  clearTasksMock,
  setTasksFromTodosMock,
  markCompletedAndDismissedMock,
  resetCompletedTasksMock,
  refreshTasksMock,
  notifyDesktopMock,
  updateTabTitleMock,
  updateTabStatusMock,
  updateSessionTitleMock,
  sessionStoreSnapshot,
  cliTaskStoreSnapshot,
} = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getMemberBySessionIdMock: vi.fn<(sessionId: string) => any>(() => null),
  sendMessageToMemberMock: vi.fn(async () => {}),
  handleTeamCreatedMock: vi.fn(),
  handleTeamUpdateMock: vi.fn(),
  handleTeamDeletedMock: vi.fn(),
  fetchSessionTasksMock: vi.fn(),
  clearTasksMock: vi.fn(),
  setTasksFromTodosMock: vi.fn(),
  markCompletedAndDismissedMock: vi.fn(),
  resetCompletedTasksMock: vi.fn(async () => {}),
  refreshTasksMock: vi.fn(),
  notifyDesktopMock: vi.fn(),
  updateTabTitleMock: vi.fn(),
  updateTabStatusMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  sessionStoreSnapshot: {
    sessions: [] as Array<{
      id: string
      title: string
      createdAt: string
      modifiedAt: string
      messageCount: number
      projectPath: string
      workDir: string | null
      workDirExists: boolean
    }>,
  },
  cliTaskStoreSnapshot: {
    tasks: [] as Array<{ id: string; subject: string; status: string; activeForm?: string }>,
    sessionId: null as string | null,
  },
}))

vi.mock('../lib/desktopNotifications', () => ({
  notifyDesktop: notifyDesktopMock,
}))

vi.mock('../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: sendMock,
  },
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    getTranscript: vi.fn(async () => ({
      items: [],
      agentNotifications: {},
      lastTodos: null,
      hasMessagesAfterTaskCompletion: false,
    })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

vi.mock('./teamStore', () => ({
  useTeamStore: {
    getState: () => ({
      getMemberBySessionId: getMemberBySessionIdMock,
      sendMessageToMember: sendMessageToMemberMock,
      handleTeamCreated: handleTeamCreatedMock,
      handleTeamUpdate: handleTeamUpdateMock,
      handleTeamDeleted: handleTeamDeletedMock,
    }),
  },
}))

vi.mock('./tabStore', () => ({
  useTabStore: {
    getState: () => ({
      updateTabStatus: updateTabStatusMock,
      updateTabTitle: updateTabTitleMock,
    }),
  },
}))

vi.mock('./sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      sessions: sessionStoreSnapshot.sessions,
      updateSessionTitle: updateSessionTitleMock,
    }),
  },
}))

vi.mock('./cliTaskStore', () => ({
  useCLITaskStore: {
    getState: () => ({
      fetchSessionTasks: fetchSessionTasksMock,
      tasks: cliTaskStoreSnapshot.tasks,
      sessionId: cliTaskStoreSnapshot.sessionId,
      clearTasks: clearTasksMock,
      setTasksFromTodos: setTasksFromTodosMock,
      markCompletedAndDismissed: markCompletedAndDismissedMock,
      resetCompletedTasks: resetCompletedTasksMock,
      refreshTasks: refreshTasksMock,
    }),
  },
}))

import { sessionsApi } from '../api/sessions'
import {
  type PerSessionState,
  useChatStore,
} from './chatStore'

const TEST_SESSION_ID = 'test-session-1'

function transcriptOf(items: UIMessage[], rest: Partial<SessionTranscript> = {}): SessionTranscript {
  return { items, agentNotifications: {}, lastTodos: null, hasMessagesAfterTaskCompletion: false, ...rest }
}
const initialState = useChatStore.getState()

function makeSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    chatState: 'streaming',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingComputerUsePermission: null,
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    elapsedSeconds: 0,
    statusVerb: '',
    apiRetry: null,
    slashCommands: [],
    agentTaskNotifications: {},
    backgroundAgentTasks: {},
    elapsedTimer: null,
    ...overrides,
  }
}

describe('chatStore history mapping', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getMemberBySessionIdMock.mockReset()
    getMemberBySessionIdMock.mockReturnValue(null)
    sendMessageToMemberMock.mockReset()
    fetchSessionTasksMock.mockReset()
    clearTasksMock.mockReset()
    setTasksFromTodosMock.mockReset()
    markCompletedAndDismissedMock.mockReset()
    resetCompletedTasksMock.mockReset()
    refreshTasksMock.mockReset()
    notifyDesktopMock.mockReset()
    updateTabTitleMock.mockReset()
    updateTabStatusMock.mockReset()
    updateSessionTitleMock.mockReset()
    vi.mocked(sessionsApi.getTranscript).mockReset()
    vi.mocked(sessionsApi.getTranscript).mockResolvedValue(transcriptOf([]))
    sessionStoreSnapshot.sessions = []
    cliTaskStoreSnapshot.tasks = []
    cliTaskStoreSnapshot.sessionId = null
    useSessionRuntimeStore.setState({ selections: {} })
    localStorage.clear()
    useSettingsStore.setState({ locale: 'zh' })
    useChatStore.setState({
      ...initialState,
      sessions: {},
    })
  })

  it('restores completed /goal state from transcript history after app restart', async () => {
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(
      transcriptOf([
        { id: 'goal-command', type: 'user_text', content: '/goal ship the smoke test', timestamp: 1775433600000 },
        {
          id: 'goal-output',
          type: 'goal_event',
          action: 'created',
          status: 'active',
          objective: 'ship the smoke test',
          message: 'Goal set: ship the smoke test',
          timestamp: 1775433601000,
        },
        { id: 'goal-complete', type: 'goal_event', action: 'completed', message: 'Goal marked complete.', timestamp: 1775433602000 },
      ]),
    )

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ messages: [] }),
      },
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        id: 'goal-command',
        type: 'user_text',
        content: '/goal ship the smoke test',
      },
      {
        id: 'goal-output',
        type: 'goal_event',
        action: 'created',
        objective: 'ship the smoke test',
      },
      {
        id: 'goal-complete',
        type: 'goal_event',
        action: 'completed',
        message: 'Goal marked complete.',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeGoal).toMatchObject({
      action: 'completed',
      status: 'complete',
      objective: 'ship the smoke test',
    })
  })

  it('restores messages, goal, background tasks and todos from a session transcript', async () => {
    const todos = [{ content: 'Write the summary', status: 'in_progress', activeForm: 'Writing the summary' }]
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(transcriptOf([
      { id: 'u1', type: 'user_text', content: 'Review the app', transcriptMessageId: 'u1', timestamp: 1 },
      {
        id: 'a1:0',
        type: 'tool_use',
        toolName: 'Agent',
        toolUseId: 'agent-tool-1',
        input: { description: 'Review app', prompt: 'Review the app', run_in_background: true },
        timestamp: 2,
      },
      { id: 'g1', type: 'goal_event', action: 'created', status: 'active', objective: 'ship it', timestamp: 3 },
      { id: 'a2:0', type: 'assistant_text', content: 'Started the review.', transcriptMessageId: 'a2', timestamp: 4 },
    ], {
      agentNotifications: {
        'agent-tool-1': {
          taskId: 'agent-task-1',
          toolUseId: 'agent-tool-1',
          status: 'completed',
          summary: 'Review finished',
        },
      },
      lastTodos: todos,
    }))
    cliTaskStoreSnapshot.sessionId = TEST_SESSION_ID
    cliTaskStoreSnapshot.tasks = []
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ messages: [] }),
      },
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(sessionsApi.getTranscript).toHaveBeenCalledWith(TEST_SESSION_ID)
    expect(session?.messages).toMatchObject([
      { id: 'u1', type: 'user_text', content: 'Review the app' },
      { id: 'a1:0', type: 'tool_use', toolUseId: 'agent-tool-1' },
      { id: 'g1', type: 'goal_event', action: 'created' },
      { id: 'a2:0', type: 'assistant_text', content: 'Started the review.' },
      {
        id: 'background-task-agent-task-1',
        type: 'background_task',
        task: { taskId: 'agent-task-1', status: 'completed', summary: 'Review finished' },
      },
    ])
    expect(session?.activeGoal).toMatchObject({ status: 'active', objective: 'ship it' })
    expect(session?.agentTaskNotifications['agent-tool-1']).toMatchObject({ status: 'completed' })
    expect(session?.backgroundAgentTasks?.['agent-task-1']).toMatchObject({
      toolUseId: 'agent-tool-1',
      status: 'completed',
      summary: 'Review finished',
    })
    expect(setTasksFromTodosMock).toHaveBeenCalledWith(todos, TEST_SESSION_ID)
  })

  it('uses transcript terminal events to repair stale live goal and background task state', async () => {
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(
      transcriptOf([
        { id: 'goal-command', type: 'user_text', content: '/goal ship the smoke test', timestamp: 1775433600000 },
        {
          id: 'goal-output',
          type: 'goal_event',
          action: 'created',
          status: 'active',
          objective: 'ship the smoke test',
          message: 'Goal set: ship the smoke test',
          timestamp: 1775433601000,
        },
        { id: 'goal-complete', type: 'goal_event', action: 'completed', message: 'Goal marked complete.', timestamp: 1775433602000 },
      ], {
        agentNotifications: {
          'agent-tool-1': {
            taskId: 'agent-task-1',
            toolUseId: 'agent-tool-1',
            status: 'completed',
            summary: 'Agent completed',
            timestamp: '2026-04-06T00:00:03.000Z',
          },
        },
      }),
    )

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [{ id: 'visible-message', type: 'assistant_text', content: 'already rendered', timestamp: 1 }],
          activeGoal: {
            action: 'created',
            status: 'active',
            objective: 'ship the smoke test',
            updatedAt: 1,
          },
          backgroundAgentTasks: {
            'agent-tool-1': {
              taskId: 'agent-tool-1',
              toolUseId: 'agent-tool-1',
              status: 'running',
              taskType: 'local_agent',
              description: 'Review app',
              startedAt: 1,
              updatedAt: 2,
            },
          },
        }),
      },
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages).toMatchObject([
      { id: 'visible-message', type: 'assistant_text', content: 'already rendered' },
      {
        id: 'goal-complete',
        type: 'goal_event',
        action: 'completed',
        message: 'Goal marked complete.',
      },
    ])
    expect(session?.activeGoal).toMatchObject({
      action: 'completed',
      status: 'complete',
      objective: 'ship the smoke test',
    })
    expect(session?.backgroundAgentTasks?.['agent-tool-1']).toBeUndefined()
    expect(session?.backgroundAgentTasks?.['agent-task-1']).toMatchObject({
      taskId: 'agent-task-1',
      toolUseId: 'agent-tool-1',
      status: 'completed',
      description: 'Review app',
      summary: 'Agent completed',
    })
  })

  it('hydrates transcript ids for a just-completed live turn', async () => {
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(transcriptOf([
      { id: 'transcript-user-1', type: 'user_text', content: 'live prompt', transcriptMessageId: 'transcript-user-1', timestamp: 1775433600000 },
      { id: 'transcript-assistant-1:0', type: 'assistant_text', content: 'live answer', transcriptMessageId: 'transcript-assistant-1', timestamp: 1775433601000 },
    ]))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [
            {
              id: 'live-user',
              type: 'user_text',
              content: 'live prompt',
              timestamp: 1,
            },
          ],
          streamingText: 'live answer',
          chatState: 'streaming',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    await vi.waitFor(() => {
      expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
        {
          type: 'user_text',
          transcriptMessageId: 'transcript-user-1',
        },
        {
          type: 'assistant_text',
          transcriptMessageId: 'transcript-assistant-1',
        },
      ])
    })
  })

  it('does not duplicate a hydrated assistant reply when live output replays after reconnect', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [
            {
              id: 'live-user',
              type: 'user_text',
              content: 'live prompt',
              transcriptMessageId: 'transcript-user-1',
              timestamp: 1,
            },
            {
              id: 'live-assistant',
              type: 'assistant_text',
              content: 'live answer',
              transcriptMessageId: 'transcript-assistant-1',
              timestamp: 2,
            },
          ],
          streamingText: 'live answer',
          chatState: 'streaming',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        id: 'live-user',
        type: 'user_text',
        transcriptMessageId: 'transcript-user-1',
      },
      {
        id: 'live-assistant',
        type: 'assistant_text',
        content: 'live answer',
        transcriptMessageId: 'transcript-assistant-1',
      },
    ])
    expect(notifyDesktopMock).not.toHaveBeenCalled()
  })

  it('collapses duplicate assistant replies after transcript id hydration', async () => {
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(transcriptOf([
      { id: 'transcript-user-1', type: 'user_text', content: 'live prompt', transcriptMessageId: 'transcript-user-1', timestamp: 1775433600000 },
      { id: 'transcript-assistant-1:0', type: 'assistant_text', content: 'live answer', transcriptMessageId: 'transcript-assistant-1', timestamp: 1775433601000 },
    ]))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [
            {
              id: 'live-user',
              type: 'user_text',
              content: 'live prompt',
              transcriptMessageId: 'transcript-user-1',
              timestamp: 1,
            },
            {
              id: 'live-assistant',
              type: 'assistant_text',
              content: 'live answer',
              transcriptMessageId: 'transcript-assistant-1',
              timestamp: 2,
            },
            {
              id: 'replayed-assistant',
              type: 'assistant_text',
              content: 'live answer',
              timestamp: 3,
            },
          ],
        }),
      },
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        id: 'live-user',
        type: 'user_text',
        transcriptMessageId: 'transcript-user-1',
      },
      {
        id: 'live-assistant',
        type: 'assistant_text',
        content: 'live answer',
        transcriptMessageId: 'transcript-assistant-1',
      },
    ])
  })

  it('retries transcript id hydration after the assistant message is persisted', async () => {
    vi.useFakeTimers()
    vi.mocked(sessionsApi.getTranscript)
      .mockResolvedValueOnce(transcriptOf([
        { id: 'transcript-user-1', type: 'user_text', content: 'live prompt', transcriptMessageId: 'transcript-user-1', timestamp: 1775433600000 },
      ]))
      .mockResolvedValueOnce(transcriptOf([
        { id: 'transcript-user-1', type: 'user_text', content: 'live prompt', transcriptMessageId: 'transcript-user-1', timestamp: 1775433600000 },
        { id: 'transcript-assistant-1:0', type: 'assistant_text', content: 'live answer', transcriptMessageId: 'transcript-assistant-1', timestamp: 1775433601000 },
      ]))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [
            {
              id: 'live-user',
              type: 'user_text',
              content: 'live prompt',
              timestamp: 1,
            },
          ],
          streamingText: 'live answer',
          chatState: 'streaming',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(sessionsApi.getTranscript).toHaveBeenCalledTimes(1)
    const firstHydrationMessages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages ?? []
    expect(firstHydrationMessages[0]).toMatchObject({
      type: 'user_text',
      transcriptMessageId: 'transcript-user-1',
    })
    expect(firstHydrationMessages[1]).toMatchObject({
      type: 'assistant_text',
    })
    expect(firstHydrationMessages[1]).not.toHaveProperty('transcriptMessageId')

    await vi.advanceTimersByTimeAsync(750)

    expect(sessionsApi.getTranscript).toHaveBeenCalledTimes(2)
    const secondHydrationMessages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages ?? []
    expect(secondHydrationMessages[0]).toMatchObject({
      type: 'user_text',
      transcriptMessageId: 'transcript-user-1',
    })
    expect(secondHydrationMessages[1]).toMatchObject({
      type: 'assistant_text',
      transcriptMessageId: 'transcript-assistant-1',
    })

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('keeps workspace reference chips visible while sending CLI attachment paths', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().sendMessage(
      TEST_SESSION_ID,
      'Referenced workspace context:\n@"src/App.tsx:L4":\nComment: tighten this\n```tsx\nconst value = 1\n```',
      [{
        type: 'file',
        name: 'App.tsx',
        path: '/repo/src/App.tsx',
        lineStart: 4,
        lineEnd: 4,
        note: 'tighten this',
        quote: 'const value = 1',
      }],
      {
        displayContent: '改这里',
        displayAttachments: [{
          type: 'file',
          name: 'App.tsx',
          path: 'src/App.tsx',
          lineStart: 4,
          lineEnd: 4,
          note: 'tighten this',
          quote: 'const value = 1',
        }],
      },
    )

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'user_text',
        content: '改这里',
        modelContent: '@"/repo/src/App.tsx" Referenced workspace context:\n@"src/App.tsx:L4":\nComment: tighten this\n```tsx\nconst value = 1\n```',
        attachments: [{
          type: 'file',
          name: 'App.tsx',
          path: 'src/App.tsx',
          lineStart: 4,
          lineEnd: 4,
          note: 'tighten this',
          quote: 'const value = 1',
        }],
      },
    ])
    expect(sendMock).toHaveBeenCalledWith(
      TEST_SESSION_ID,
      {
        type: 'user_message',
        content: 'Referenced workspace context:\n@"src/App.tsx:L4":\nComment: tighten this\n```tsx\nconst value = 1\n```',
        attachments: [{
          type: 'file',
          name: 'App.tsx',
          path: '/repo/src/App.tsx',
          lineStart: 4,
          lineEnd: 4,
          note: 'tighten this',
          quote: 'const value = 1',
        }],
      },
    )
  })

  it('stores server-materialized attachment prefixes for rewind matching', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().sendMessage(
      TEST_SESSION_ID,
      '记一下这个文件讲了什么东西。',
      [{ type: 'file', name: 'conditions.py', path: '/repo/backend/conditions.py' }],
      {
        displayContent: '记一下这个文件讲了什么东西。',
        displayAttachments: [{ type: 'file', name: 'conditions.py', path: 'backend/conditions.py' }],
      },
    )

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'user_text',
        content: '记一下这个文件讲了什么东西。',
        modelContent: '@"/repo/backend/conditions.py" 记一下这个文件讲了什么东西。',
        attachments: [{
          type: 'file',
          name: 'conditions.py',
          path: 'backend/conditions.py',
        }],
      },
    ])
  })

  it('hydrates TodoWrite history into the currently tracked task store only', async () => {
    const todos = [{ content: 'Session task', status: 'in_progress' }]
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(transcriptOf([], { lastTodos: todos }))
    cliTaskStoreSnapshot.sessionId = TEST_SESSION_ID
    cliTaskStoreSnapshot.tasks = []

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ messages: [] }),
      },
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    expect(setTasksFromTodosMock).toHaveBeenCalledWith(todos, TEST_SESSION_ID)
  })

  it('marks history task completion dismissed when the user already continued', async () => {
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(
      transcriptOf([], { hasMessagesAfterTaskCompletion: true }),
    )

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ messages: [] }),
      },
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    expect(setTasksFromTodosMock).toHaveBeenCalledWith([], TEST_SESSION_ID)
    expect(markCompletedAndDismissedMock).toHaveBeenCalledWith(TEST_SESSION_ID)
  })

  it('reloads history task state for the requested session', async () => {
    const todos = [{ content: 'Reloaded task', status: 'pending' }]
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(transcriptOf([], { lastTodos: todos }))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ messages: [{ id: 'old', type: 'assistant_text', content: 'old', timestamp: 1 }] }),
      },
    })

    await useChatStore.getState().reloadHistory(TEST_SESSION_ID)

    expect(setTasksFromTodosMock).toHaveBeenCalledWith(todos, TEST_SESSION_ID)
  })

  it('clears reloaded task state after completed history is followed by a user turn', async () => {
    vi.mocked(sessionsApi.getTranscript).mockResolvedValueOnce(
      transcriptOf([], { hasMessagesAfterTaskCompletion: true }),
    )

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ messages: [{ id: 'old', type: 'assistant_text', content: 'old', timestamp: 1 }] }),
      },
    })

    await useChatStore.getState().reloadHistory(TEST_SESSION_ID)

    expect(setTasksFromTodosMock).toHaveBeenCalledWith([], TEST_SESSION_ID)
    expect(markCompletedAndDismissedMock).toHaveBeenCalledWith(TEST_SESSION_ID)
  })

  it('keeps parent tool linkage for live tool events', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [{ name: 'old-command', description: 'Old command' }],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'src/App.tsx' },
      parentToolUseId: 'agent-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'tool-1',
      content: 'ok',
      isError: false,
      parentToolUseId: 'agent-1',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'tool_use',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
      {
        type: 'tool_result',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
    ])
  })

  it('retains live parent linkage when only content_start carries the parent id', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'tool_use',
      toolName: 'Read',
      toolUseId: 'tool-1',
      parentToolUseId: 'agent-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'src/App.tsx' },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'tool-1',
      content: 'ok',
      isError: false,
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'tool_use',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
      {
        type: 'tool_result',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
    ])
  })

  it('renders a pending tool call as soon as the tool stream starts', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'tool_use',
      toolName: 'Write',
      toolUseId: 'write-1',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-1',
        input: {},
        isPending: true,
      },
    ])

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      toolInput: '{"file_path":"/private/tmp/ai-code-novel.md","content":"第一章',
    })
    vi.advanceTimersByTime(60)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-1',
        input: { file_path: '/private/tmp/ai-code-novel.md' },
        isPending: true,
        partialInput: '{"file_path":"/private/tmp/ai-code-novel.md","content":"第一章',
      },
    ])

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'Write',
      toolUseId: 'write-1',
      input: {
        file_path: '/private/tmp/ai-code-novel.md',
        content: '第一章\n正文',
      },
    })

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages ?? []
    const toolMessages = messages.filter((message) => message.type === 'tool_use')
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      type: 'tool_use',
      toolName: 'Write',
      toolUseId: 'write-1',
      input: {
        file_path: '/private/tmp/ai-code-novel.md',
        content: '第一章\n正文',
      },
      isPending: false,
    })
    expect(toolMessages[0]).not.toHaveProperty('partialInput')

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('batches streaming tool input deltas before updating the pending card', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'tool_use',
      toolName: 'Write',
      toolUseId: 'write-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      toolInput: '{"file_path":"/private/tmp/story.md","content":"第一',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      toolInput: '章\\n第二段',
    })

    const beforeFlush = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages[0]
    expect(beforeFlush).toMatchObject({
      type: 'tool_use',
      isPending: true,
      input: {},
      partialInput: '',
    })

    vi.advanceTimersByTime(60)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages[0]).toMatchObject({
      type: 'tool_use',
      input: { file_path: '/private/tmp/story.md' },
      partialInput: '{"file_path":"/private/tmp/story.md","content":"第一章\\n第二段',
    })

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('refreshes merged slash commands when a live CLI update omits project commands', async () => {
    const cliCommand = { name: 'builtin-help', description: 'Built-in command' }
    const projectCommand = { name: 'project-probe', description: 'Project custom command' }

    vi.mocked(sessionsApi.getSlashCommands).mockClear()
    vi.mocked(sessionsApi.getSlashCommands).mockResolvedValueOnce({
      commands: [cliCommand, projectCommand],
    })

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          slashCommands: [projectCommand],
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'slash_commands',
      data: [cliCommand],
    })

    await Promise.resolve()

    expect(sessionsApi.getSlashCommands).toHaveBeenCalledTimes(1)
    expect(sessionsApi.getSlashCommands).toHaveBeenCalledWith(TEST_SESSION_ID)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.slashCommands).toEqual([
      cliCommand,
      projectCommand,
    ])
  })

  it('syncs live TodoWrite tool input into the task store for that session', () => {
    const todos = [{ content: 'Live todo', status: 'in_progress' }]
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ chatState: 'tool_executing' }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'TodoWrite',
      toolUseId: 'todo-live',
      input: { todos },
    })

    expect(setTasksFromTodosMock).toHaveBeenCalledWith(todos, TEST_SESSION_ID)
  })

  it('replays saved runtime selection when reconnecting a session', () => {
    useSessionRuntimeStore.getState().setSelection(TEST_SESSION_ID, {
      providerId: 'provider-1',
      modelId: 'kimi-k2.6',
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'set_runtime_config',
      providerId: 'provider-1',
      modelId: 'kimi-k2.6',
    })
    expect(sendMock.mock.calls.slice(0, 2)).toEqual([
      [
        TEST_SESSION_ID,
        {
          type: 'set_runtime_config',
          providerId: 'provider-1',
          modelId: 'kimi-k2.6',
        },
      ],
      [TEST_SESSION_ID, { type: 'prewarm_session' }],
    ])
  })

  it('prewarms regular desktop sessions when connecting', () => {
    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'prewarm_session',
    })
  })

  it('does not prewarm team member sessions', () => {
    getMemberBySessionIdMock.mockReturnValue({
      agentId: 'reviewer@test-team',
      role: 'reviewer',
      status: 'running',
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).not.toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'prewarm_session',
    })
  })

  it('does not prewarm synthetic app tabs', () => {
    useChatStore.getState().connectToSession('__settings__')

    expect(sendMock).not.toHaveBeenCalledWith('__settings__', {
      type: 'prewarm_session',
    })
  })

  it('sends explicit runtime overrides over websocket', () => {
    useChatStore.getState().setSessionRuntime(TEST_SESSION_ID, {
      providerId: null,
      modelId: 'claude-opus-4-7',
    })

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'set_runtime_config',
      providerId: null,
      modelId: 'claude-opus-4-7',
    })
  })

  it('keeps AskUserQuestion permission requests out of the message list while tracking the pending request', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            {
              id: 'ask-1',
              type: 'tool_use',
              toolName: 'AskUserQuestion',
              toolUseId: 'tool-ask-1',
              input: {
                questions: [
                  {
                    question: 'Should we persist data?',
                    options: [{ label: 'No' }, { label: 'Yes' }],
                  },
                ],
              },
              timestamp: 1,
            },
          ],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'permission_request',
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: {
        questions: [
          {
            question: 'Should we persist data?',
            options: [{ label: 'No' }, { label: 'Yes' }],
          },
        ],
      },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.pendingPermission).toMatchObject({
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
    })
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'tool_use',
      toolUseId: 'tool-ask-1',
    })
    expect(notifyDesktopMock).toHaveBeenCalledWith({
      dedupeKey: 'permission:perm-ask-1',
      cooldownScope: 'permission-prompt',
      requestAttention: true,
      title: 'DreamCoder 需要你的确认',
      body: 'AskUserQuestion 请求执行，正在等待允许。',
      target: { type: 'session', sessionId: TEST_SESSION_ID },
    })
  })

  it('sends permission mode updates to the active session only', () => {
    useChatStore.getState().setSessionPermissionMode('nonexistent-session', 'acceptEdits')
    expect(sendMock).not.toHaveBeenCalled()

    useChatStore.setState({
      sessions: {
        'session-1': {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
    useChatStore.getState().setSessionPermissionMode('session-1', 'acceptEdits')

    expect(sendMock).toHaveBeenCalledWith('session-1', {
      type: 'set_permission_mode',
      mode: 'acceptEdits',
    })
  })

  it('stores terminal task notifications for agent tool cards', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: { taskId: 'agent-task-1', toolUseId: 'agent-tool-1', status: 'completed', summary: 'Agent "修复异常处理" completed', outputFile: '/tmp/agent-output.txt' },
      notification: {
        taskId: 'agent-task-1',
        toolUseId: 'agent-tool-1',
        status: 'completed',
        summary: 'Agent "修复异常处理" completed',
        result: '修复了异常处理并补充了回归覆盖。',
        outputFile: '/tmp/agent-output.txt',
      },
    })

    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.agentTaskNotifications[
        'agent-tool-1'
      ],
    ).toMatchObject({
      taskId: 'agent-task-1',
      toolUseId: 'agent-tool-1',
      status: 'completed',
      summary: 'Agent "修复异常处理" completed',
      result: '修复了异常处理并补充了回归覆盖。',
      outputFile: '/tmp/agent-output.txt',
    })
  })

  it('tracks background agent task lifecycle without duplicating transcript cards', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-06T00:00:01.000Z'))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          chatState: 'tool_executing',
        }),
      },
    })

    vi.setSystemTime(new Date('2026-04-06T00:00:02.000Z'))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: { taskId: 'agent-task-1', toolUseId: 'agent-tool-1', status: 'running', description: 'Verify the todo app', taskType: 'local_agent', prompt: 'Run E2E verification' },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.backgroundAgentTasks?.['agent-task-1']).toMatchObject({
      taskId: 'agent-task-1',
      toolUseId: 'agent-tool-1',
      status: 'running',
      description: 'Verify the todo app',
      taskType: 'local_agent',
      prompt: 'Run E2E verification',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toHaveLength(0)

    vi.setSystemTime(new Date('2026-04-06T00:00:03.000Z'))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: {
        taskId: 'agent-task-1',
        toolUseId: 'agent-tool-1',
        status: 'running',
        description: 'Verify the todo app',
        summary: 'Running Playwright checks',
        lastToolName: 'Bash',
        usage: { totalTokens: 1200, toolUses: 4, durationMs: 45000 },
      },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.backgroundAgentTasks?.['agent-task-1']).toMatchObject({
      status: 'running',
      summary: 'Running Playwright checks',
      lastToolName: 'Bash',
      usage: {
        totalTokens: 1200,
        toolUses: 4,
        durationMs: 45000,
      },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toHaveLength(0)

    vi.setSystemTime(new Date('2026-04-06T00:00:04.000Z'))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: {
        taskId: 'agent-task-1',
        toolUseId: 'agent-tool-1',
        status: 'completed',
        summary: 'Found and fixed localStorage corruption.',
        outputFile: '/tmp/agent-output.txt',
        usage: { totalTokens: 2400, toolUses: 9, durationMs: 120000 },
      },
      notification: {
        taskId: 'agent-task-1',
        toolUseId: 'agent-tool-1',
        status: 'completed',
        summary: 'Found and fixed localStorage corruption.',
        result: 'Root cause was a stale session cache entry.',
        outputFile: '/tmp/agent-output.txt',
        usage: { totalTokens: 2400, toolUses: 9, durationMs: 120000 },
      },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.backgroundAgentTasks?.['agent-task-1']).toMatchObject({
      status: 'completed',
      summary: 'Found and fixed localStorage corruption.',
      outputFile: '/tmp/agent-output.txt',
      usage: {
        totalTokens: 2400,
        toolUses: 9,
        durationMs: 120000,
      },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.agentTaskNotifications['agent-tool-1']).toMatchObject({
      status: 'completed',
      summary: 'Found and fixed localStorage corruption.',
      result: 'Root cause was a stale session cache entry.',
      outputFile: '/tmp/agent-output.txt',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toHaveLength(0)
    vi.useRealTimers()
  })

  it('keeps non-agent background tasks visible and updates the existing transcript card', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-06T00:00:01.000Z'))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: { taskId: 'shell-task-1', toolUseId: 'shell-tool-1', status: 'running', description: 'Run desktop checks', taskType: 'local_bash' },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'background_task',
        task: {
          taskId: 'shell-task-1',
          toolUseId: 'shell-tool-1',
          status: 'running',
          taskType: 'local_bash',
          description: 'Run desktop checks',
        },
      },
    ])
    const insertedTaskTimestamp = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages[0]?.timestamp

    vi.setSystemTime(new Date('2026-04-06T00:00:02.000Z'))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: {
        taskId: 'shell-task-1',
        toolUseId: 'shell-tool-1',
        status: 'running',
        description: 'Run desktop checks',
        summary: 'Running Vitest',
        lastToolName: 'Bash',
        taskType: 'local_bash',
      },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'background_task',
      task: {
        taskId: 'shell-task-1',
        status: 'running',
        summary: 'Running Vitest',
        lastToolName: 'Bash',
      },
    })
    expect(session?.messages[0]?.timestamp).toBe(insertedTaskTimestamp)
    vi.useRealTimers()
  })

  it('marks a background shell task stopped when TaskStop returns before a task notification', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T13:34:19.000Z'))

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: { taskId: 'shell-task-1', toolUseId: 'shell-tool-1', status: 'running', description: 'Start tap proxy', taskType: 'local_bash' },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'TaskStop',
      toolUseId: 'task-stop-1',
      input: { task_id: 'shell-task-1' },
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'task-stop-1',
      isError: false,
      content: JSON.stringify({
        message: 'Successfully stopped task: shell-task-1 (tap proxy)',
        task_id: 'shell-task-1',
        task_type: 'local_bash',
        command: 'tap proxy',
      }),
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.backgroundAgentTasks?.['shell-task-1']).toMatchObject({
      status: 'stopped',
      taskType: 'local_bash',
      description: 'tap proxy',
    })
    expect(session?.messages.find((message) => message.type === 'background_task')).toMatchObject({
      type: 'background_task',
      task: {
        taskId: 'shell-task-1',
        status: 'stopped',
        taskType: 'local_bash',
        description: 'tap proxy',
      },
    })

    vi.useRealTimers()
  })

  it('removes stale agent task transcript cards by matching tool use id', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [{
            id: 'background-task-old-agent-task',
            type: 'background_task',
            timestamp: 1,
            task: {
              taskId: 'old-agent-task',
              toolUseId: 'agent-tool-1',
              status: 'running',
              taskType: 'local_agent',
              startedAt: 1,
              updatedAt: 1,
            },
          }],
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'background_task',
      event: { taskId: 'new-agent-task', toolUseId: 'agent-tool-1', status: 'running', taskType: 'local_agent', description: 'Review app' },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toHaveLength(0)
  })

  it('clears local desktop chat state when the server confirms /clear', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'u1', type: 'user_text', content: '/clear', timestamp: Date.now() },
            { id: 'a1', type: 'assistant_text', content: 'old context', timestamp: Date.now() },
          ],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: 'pending',
          streamingToolInput: 'tool',
          activeToolUseId: 'tool-1',
          activeToolName: 'Read',
          activeThinkingId: 'thinking-1',
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 12, output_tokens: 34 },
          elapsedSeconds: 5,
          statusVerb: 'Thinking',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'stale throttled delta',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'session_cleared',
      message: 'Conversation cleared',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages).toEqual([])
    expect(session?.streamingText).toBe('')
    expect(session?.chatState).toBe('idle')
    expect(session?.tokenUsage).toEqual({ input_tokens: 0, output_tokens: 0 })
    expect(session?.slashCommands).toEqual([])
    expect(clearTasksMock).toHaveBeenCalledWith(TEST_SESSION_ID)

    vi.advanceTimersByTime(60)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.streamingText).toBe('')
    vi.useRealTimers()
  })

  it('clears local message state for only the requested session', () => {
    useChatStore.setState({
      sessions: {
        'session-a': makeSession({
          messages: [{ id: 'a1', type: 'assistant_text', content: 'A old', timestamp: 1 }],
          streamingText: 'A pending',
        }),
        'session-b': makeSession({
          messages: [{ id: 'b1', type: 'assistant_text', content: 'B old', timestamp: 1 }],
          streamingText: 'B pending',
        }),
      },
    })

    useChatStore.getState().clearMessages('session-a')

    expect(useChatStore.getState().sessions['session-a']?.messages).toEqual([])
    expect(useChatStore.getState().sessions['session-a']?.streamingText).toBe('')
    expect(useChatStore.getState().sessions['session-b']?.messages).toMatchObject([
      { content: 'B old' },
    ])
  })

  it('renders compact boundary notifications as compact summary cards', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'old-user', type: 'user_text', content: 'Build the billing import flow', timestamp: 1 },
            { id: 'old-assistant', type: 'assistant_text', content: 'Implemented the flow.', timestamp: 2 },
          ],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: { id: 'compact-boundary', type: 'compact_summary', title: 'Context compacted', phase: 'complete', trigger: 'auto', preTokens: 120000, timestamp: 3 },
    })

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages ?? []
    expect(messages).toHaveLength(3)
    expect(messages).toMatchObject([
      { id: 'old-user', type: 'user_text', content: 'Build the billing import flow' },
      { id: 'old-assistant', type: 'assistant_text', content: 'Implemented the flow.' },
      {
        type: 'compact_summary',
        title: 'Context compacted',
        trigger: 'auto',
        preTokens: 120000,
      },
    ])
  })

  it('attaches compact summary content to the latest compact card', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'compacting',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: 'Compacting conversation',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: { id: 'compact-boundary', type: 'compact_summary', title: 'Context compacted', phase: 'complete', trigger: 'manual', timestamp: 3 },
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: {
        id: 'compact-summary',
        type: 'compact_summary',
        title: 'Context compacted',
        phase: 'complete',
        summary: 'Implemented the billing report and verified export behavior.',
        timestamp: 4,
      },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'compact_summary',
        trigger: 'manual',
        summary: 'Implemented the billing report and verified export behavior.',
      },
    ])
  })

  it('tracks compacting status as an active chat state', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'old-user', type: 'user_text', content: 'old context', timestamp: 1 },
          ],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'compacting',
      verb: 'Compacting conversation',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('compacting')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.statusVerb).toBe('Compacting conversation')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        id: 'old-user',
        type: 'user_text',
        content: 'old context',
      },
      {
        type: 'compact_summary',
        phase: 'compacting',
      },
    ])
    expect(updateTabStatusMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, 'running')
  })

  it('removes the transient compacting card when compaction is canceled', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'old-user', type: 'user_text', content: 'old context', timestamp: 1 },
          ],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'compacting',
      verb: 'Compacting conversation',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'error',
      message: 'Compaction canceled.',
      code: 'aborted',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.statusVerb).toBe('')
    expect(session?.messages).toMatchObject([
      {
        id: 'old-user',
        type: 'user_text',
        content: 'old context',
      },
      {
        type: 'error',
        message: 'Compaction canceled.',
      },
    ])
    expect(session?.messages.some((message) => message.type === 'compact_summary' && message.phase === 'compacting')).toBe(false)
    expect(updateTabStatusMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, 'error')
  })

  it('removes the transient compacting card when compacting status ends without a boundary', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'old-user', type: 'user_text', content: 'old context', timestamp: 1 },
          ],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'compacting',
      verb: 'Compacting conversation',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'thinking',
      verb: 'Thinking',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('thinking')
    expect(session?.messages).toMatchObject([
      {
        id: 'old-user',
        type: 'user_text',
        content: 'old context',
      },
    ])
    expect(session?.messages.some((message) => message.type === 'compact_summary' && message.phase === 'compacting')).toBe(false)
    expect(updateTabStatusMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, 'running')
  })

  it('tracks API retry status until the request finishes', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [],
          chatState: 'thinking',
          statusVerb: 'Thinking',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'api_retry',
      attempt: 1,
      maxRetries: 10,
      retryDelayMs: 2500,
      errorStatus: 503,
      errorType: 'server_error',
    })

    const retryingSession = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(retryingSession?.chatState).toBe('thinking')
    expect(retryingSession?.statusVerb).toBe('')
    expect(retryingSession?.apiRetry).toMatchObject({
      attempt: 1,
      maxRetries: 10,
      retryDelayMs: 2500,
      errorStatus: 503,
      errorType: 'server_error',
    })
    expect(updateTabStatusMock).toHaveBeenLastCalledWith(TEST_SESSION_ID, 'running')

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 0 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.apiRetry).toBeNull()
  })

  it('renders memory saved notifications as chat memory events', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [],
          chatState: 'idle',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: {
        id: 'memory-1',
        type: 'memory_event',
        event: 'saved',
        files: [
          { path: '/Users/test/.claude/projects/example/memory/preferences.md', action: 'saved' },
          { path: '/Users/test/.claude/projects/example/memory/team/MEMORY.md', action: 'saved' },
        ],
        message: 'Saved 2 memories',
        teamCount: 1,
        timestamp: 1,
      },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'memory_event',
        event: 'saved',
        message: 'Saved 2 memories',
        teamCount: 1,
        files: [
          { path: '/Users/test/.claude/projects/example/memory/preferences.md', action: 'saved' },
          { path: '/Users/test/.claude/projects/example/memory/team/MEMORY.md', action: 'saved' },
        ],
      },
    ])
  })

  it('renders live goal notifications as visible goal events', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [],
          chatState: 'idle',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: {
        id: 'goal-1',
        type: 'goal_event',
        action: 'created',
        status: 'active',
        objective: 'ship the smoke test',
        budget: '0 / 2,000 tokens',
        continuations: '0',
        message: 'Goal set: ship the smoke test',
        timestamp: 1,
      },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'goal_event',
        action: 'created',
        status: 'active',
        objective: 'ship the smoke test',
        budget: '0 / 2,000 tokens',
        continuations: '0',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeGoal).toMatchObject({
      action: 'created',
      status: 'active',
      objective: 'ship the smoke test',
      budget: '0 / 2,000 tokens',
      continuations: '0',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: {
        id: 'goal-2',
        type: 'goal_event',
        action: 'created',
        status: 'active',
        objective: 'ship the replacement target',
        budget: '0 / unlimited tokens',
        continuations: '0',
        message: 'Goal set: ship the replacement target',
        timestamp: 2,
      },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeGoal).toMatchObject({
      action: 'created',
      status: 'active',
      objective: 'ship the replacement target',
      budget: '0 / unlimited tokens',
      continuations: '0',
    })
  })

  it('keeps the active goal panel state in sync with /goal lifecycle events', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          messages: [],
          activeGoal: {
            action: 'created',
            status: 'active',
            objective: 'ship the smoke test',
            budget: '0 / 2,000 tokens',
            continuations: '0',
            updatedAt: 1,
          },
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: { id: 'goal-3', type: 'goal_event', action: 'paused', status: 'paused', timestamp: 3 },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeGoal).toMatchObject({
      action: 'paused',
      status: 'paused',
      objective: 'ship the smoke test',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: { id: 'goal-4', type: 'goal_event', action: 'completed', message: 'Goal marked complete.', timestamp: 4 },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeGoal).toMatchObject({
      action: 'completed',
      status: 'complete',
      objective: 'ship the smoke test',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'transcript_item',
      item: { id: 'goal-5', type: 'goal_event', action: 'cleared', message: 'Goal cleared.', timestamp: 5 },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeGoal).toBeNull()
  })

  it('flushes the previous assistant draft before starting a new user turn', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'streaming',
          connectionState: 'connected',
          streamingText: '上一次分析结果 **还在流式区域**',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '你是什么模型？')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: '上一次分析结果 **还在流式区域**',
      },
      {
        type: 'user_text',
        content: '你是什么模型？',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.streamingText).toBe('')
  })

  it('resets completed CLI tasks before continuing the next user turn', () => {
    cliTaskStoreSnapshot.sessionId = TEST_SESSION_ID
    cliTaskStoreSnapshot.tasks = [
      { id: '1', subject: 'Existing completed task', status: 'completed' },
      { id: '2', subject: 'Another completed task', status: 'completed' },
    ]

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '继续下一轮')

    expect(resetCompletedTasksMock).toHaveBeenCalledWith(TEST_SESSION_ID)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'task_summary',
        tasks: [
          { id: '1', subject: 'Existing completed task', status: 'completed' },
          { id: '2', subject: 'Another completed task', status: 'completed' },
        ],
      },
      {
        type: 'user_text',
        content: '继续下一轮',
      },
    ])
  })

  it('does not attach completed tasks from another tracked session to a new user turn', () => {
    cliTaskStoreSnapshot.sessionId = 'session-b'
    cliTaskStoreSnapshot.tasks = [
      { id: '1', subject: 'Session B completed task', status: 'completed' },
    ]

    useChatStore.setState({
      sessions: {
        'session-a': makeSession({ chatState: 'idle' }),
        'session-b': makeSession({ chatState: 'idle' }),
      },
    })

    useChatStore.getState().sendMessage('session-a', '继续 A 会话')

    expect(resetCompletedTasksMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions['session-a']?.messages).toMatchObject([
      {
        type: 'user_text',
        content: '继续 A 会话',
      },
    ])
  })

  it('tracks task tool results independently per session even when tool IDs collide', () => {
    useChatStore.setState({
      sessions: {
        'session-a': makeSession({
          activeToolUseId: 'tool-same',
          activeToolName: 'TaskCreate',
        }),
        'session-b': makeSession({
          activeToolUseId: 'tool-same',
          activeToolName: 'TaskCreate',
        }),
      },
    })

    for (const sessionId of ['session-a', 'session-b']) {
      useChatStore.getState().handleServerMessage(sessionId, {
        type: 'tool_use_complete',
        toolName: 'TaskCreate',
        toolUseId: 'tool-same',
        input: { subject: sessionId },
      })
    }

    useChatStore.getState().handleServerMessage('session-a', {
      type: 'tool_result',
      toolUseId: 'tool-same',
      content: 'created A',
      isError: false,
    })
    useChatStore.getState().handleServerMessage('session-b', {
      type: 'tool_result',
      toolUseId: 'tool-same',
      content: 'created B',
      isError: false,
    })

    expect(refreshTasksMock).toHaveBeenCalledTimes(2)
    expect(refreshTasksMock).toHaveBeenNthCalledWith(1, 'session-a')
    expect(refreshTasksMock).toHaveBeenNthCalledWith(2, 'session-b')
  })

  it('tracks Computer Use approval requests separately from generic tool permissions', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'computer_use_permission_request',
      requestId: 'cu-1',
      request: {
        requestId: 'cu-1',
        reason: 'Open Finder and inspect a file',
        apps: [
          {
            requestedName: 'Finder',
            resolved: {
              bundleId: 'com.apple.finder',
              displayName: 'Finder',
            },
            isSentinel: false,
            alreadyGranted: false,
            proposedTier: 'full',
          },
        ],
        requestedFlags: { clipboardRead: true },
        screenshotFiltering: 'native',
      },
    })

    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingComputerUsePermission,
    ).toMatchObject({
      requestId: 'cu-1',
      request: {
        reason: 'Open Finder and inspect a file',
      },
    })
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState,
    ).toBe('permission_pending')
    expect(notifyDesktopMock).toHaveBeenCalledWith({
      dedupeKey: 'computer-use-permission:cu-1',
      cooldownScope: 'permission-prompt',
      requestAttention: true,
      title: 'DreamCoder 需要你的确认',
      body: 'Open Finder and inspect a file',
      target: { type: 'session', sessionId: TEST_SESSION_ID },
    })
  })

  it('keeps delayed text blocks from one streamed assistant turn in a single message', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '第一段：先到达。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '\r\n第二段：稍后到达，但仍属于同一轮回复。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: '第一段：先到达。\r\n第二段：稍后到达，但仍属于同一轮回复。',
      },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('keeps throttled streaming deltas isolated per session', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        'session-a': makeSession(),
        'session-b': makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage('session-a', {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage('session-a', {
      type: 'content_delta',
      text: 'A-only response',
    })
    useChatStore.getState().handleServerMessage('session-b', {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage('session-b', {
      type: 'content_delta',
      text: 'B-only response',
    })

    useChatStore.getState().handleServerMessage('session-a', {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    useChatStore.getState().handleServerMessage('session-b', {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    expect(useChatStore.getState().sessions['session-a']?.messages).toMatchObject([
      { type: 'assistant_text', content: 'A-only response' },
    ])
    expect(useChatStore.getState().sessions['session-b']?.messages).toMatchObject([
      { type: 'assistant_text', content: 'B-only response' },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('marks the tab idle when a message completes', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ chatState: 'thinking' }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('idle')
    expect(updateTabStatusMock).toHaveBeenCalledWith(TEST_SESSION_ID, 'idle')
  })

  it('flushes pending text before appending a thinking block', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ chatState: 'streaming' }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'visible answer before thinking',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'thinking',
      text: 'internal note',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'assistant_text', content: 'visible answer before thinking' },
      { type: 'thinking', content: 'internal note' },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('flushes pending text before appending an error message', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({ chatState: 'streaming' }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'partial answer before error',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'error',
      message: 'provider failed',
      code: 'provider_error',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'assistant_text', content: 'partial answer before error' },
      { type: 'error', message: 'provider failed' },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('flushes throttled deltas only for the stopped session', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        'session-a': makeSession(),
        'session-b': makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage('session-a', {
      type: 'content_delta',
      text: 'A-only response',
    })
    useChatStore.getState().handleServerMessage('session-b', {
      type: 'content_delta',
      text: 'B-only response',
    })

    useChatStore.getState().stopGeneration('session-a')

    expect(useChatStore.getState().sessions['session-a']?.streamingText).toBe('A-only response')
    expect(useChatStore.getState().sessions['session-b']?.streamingText).toBe('')

    useChatStore.getState().handleServerMessage('session-b', {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    expect(useChatStore.getState().sessions['session-b']?.messages).toMatchObject([
      { type: 'assistant_text', content: 'B-only response' },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('does not flush one session throttled delta into another disconnected session', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        'session-a': makeSession(),
        'session-b': makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage('session-a', {
      type: 'content_delta',
      text: 'A-only response',
    })
    useChatStore.getState().handleServerMessage('session-b', {
      type: 'content_delta',
      text: 'B-only response',
    })

    useChatStore.getState().disconnectSession('session-a')

    expect(useChatStore.getState().sessions['session-a']).toBeUndefined()
    expect(useChatStore.getState().sessions['session-b']?.streamingText).toBe('')

    useChatStore.getState().handleServerMessage('session-b', {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    expect(useChatStore.getState().sessions['session-b']?.messages).toMatchObject([
      { type: 'assistant_text', content: 'B-only response' },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('ignores late throttled deltas after a session has disconnected', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        'session-a': makeSession(),
      },
    })

    useChatStore.getState().handleServerMessage('session-a', {
      type: 'content_delta',
      text: 'before disconnect',
    })
    useChatStore.getState().disconnectSession('session-a')

    useChatStore.getState().handleServerMessage('session-a', {
      type: 'content_delta',
      text: 'late stale delta',
    })
    useChatStore.setState({
      sessions: {
        'session-a': makeSession({ chatState: 'idle' }),
      },
    })

    useChatStore.getState().sendMessage('session-a', 'fresh turn')

    expect(useChatStore.getState().sessions['session-a']?.messages).toMatchObject([
      { type: 'user_text', content: 'fresh turn' },
    ])

    vi.runOnlyPendingTimers()
    expect(useChatStore.getState().sessions['session-a']?.streamingText).toBe('')
    vi.useRealTimers()
  })

  it('does not split one streamed markdown reply when task progress arrives mid-stream', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '1. **`core/audio/waveform.py:19-31`** — 同步阻塞 I/O。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'tool_executing',
      verb: 'Task in progress',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: ' 建议直接用 `subprocess.PIPE` 流式处理。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content:
          '1. **`core/audio/waveform.py:19-31`** — 同步阻塞 I/O。 建议直接用 `subprocess.PIPE` 流式处理。',
      },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('clears transient worktree startup text when normal thinking resumes', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: makeSession({
          chatState: 'idle',
        }),
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'thinking',
      verb: 'Creating worktree',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.statusVerb).toBe('Creating worktree')

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'thinking',
      verb: 'Thinking',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.statusVerb).toBe('')

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'thinking',
      verb: 'Creating worktree',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'thinking',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.statusVerb).toBe('')
  })

  it('sends a desktop notification when the agent finishes a markdown reply', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'user-1', type: 'user_text', content: '总结一下', timestamp: Date.now() },
          ],
          chatState: 'streaming',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '## 结果\n\n- **修复完成**\n- `bun test` 已通过',
    })
    vi.advanceTimersByTime(60)
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(notifyDesktopMock).toHaveBeenCalledWith(expect.objectContaining({
      cooldownScope: 'agent-completion',
      title: 'DreamCoder 已完成回复',
      body: '结果 修复完成 bun test 已通过',
      target: { type: 'session', sessionId: TEST_SESSION_ID },
    }))
    expect(notifyDesktopMock.mock.calls[0]?.[0].dedupeKey).toMatch(
      /^agent-completion:test-session-1:msg-/,
    )

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('does not notify when completion has no assistant text', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 0 },
    })

    expect(notifyDesktopMock).not.toHaveBeenCalled()
  })

  it('does not notify when a completion arrives after the session is already idle', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '用户已停止后的残余文本',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    expect(notifyDesktopMock).not.toHaveBeenCalled()
  })

  it('sends Computer Use approval payloads back over websocket', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: {
            requestId: 'cu-1',
            request: {
              requestId: 'cu-1',
              reason: 'Open Finder',
              apps: [],
              requestedFlags: {},
              screenshotFiltering: 'native',
            },
          },
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().respondToComputerUsePermission(TEST_SESSION_ID, 'cu-1', {
      granted: [],
      denied: [],
      flags: {
        clipboardRead: true,
        clipboardWrite: false,
        systemKeyCombos: false,
      },
      userConsented: true,
    })

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'computer_use_permission_response',
      requestId: 'cu-1',
      response: {
        granted: [],
        denied: [],
        flags: {
          clipboardRead: true,
          clipboardWrite: false,
          systemKeyCombos: false,
        },
        userConsented: true,
      },
    })
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingComputerUsePermission,
    ).toBeNull()
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState,
    ).toBe('tool_executing')
  })

  it('routes member-session messages through team mailbox delivery instead of websocket', async () => {
    const memberSessionId = 'team-member:security-reviewer@test-team'
    getMemberBySessionIdMock.mockReturnValue({
      agentId: 'security-reviewer@test-team',
      role: 'security-reviewer',
      status: 'running',
    })

    useChatStore.setState({
      sessions: {
        [memberSessionId]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().sendMessage(memberSessionId, 'Check the latest regression')
    await Promise.resolve()

    expect(sendMessageToMemberMock).toHaveBeenCalledWith(
      memberSessionId,
      'Check the latest regression',
    )
    expect(sendMock).not.toHaveBeenCalled()
    const sessionMessages = useChatStore.getState().sessions[memberSessionId]?.messages ?? []

    expect(sessionMessages[sessionMessages.length - 1]).toMatchObject({
      type: 'user_text',
      content: 'Check the latest regression',
      pending: true,
    })
  })

  it('refreshes CLI tasks when switching to an already-connected session', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(fetchSessionTasksMock).toHaveBeenCalledWith(TEST_SESSION_ID)
  })

  it('optimistically titles a new placeholder session from the first user message', () => {
    sessionStoreSnapshot.sessions = [{
      id: TEST_SESSION_ID,
      title: 'New Session',
      createdAt: '2026-05-07T00:00:00.000Z',
      modifiedAt: '2026-05-07T00:00:00.000Z',
      messageCount: 0,
      projectPath: '',
      workDir: '/workspace/project',
      workDirExists: true,
    }]

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '开始优化UI')

    expect(updateSessionTitleMock).toHaveBeenCalledWith(TEST_SESSION_ID, '开始优化UI')
    expect(updateTabTitleMock).toHaveBeenCalledWith(TEST_SESSION_ID, '开始优化UI')
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'user_message',
      content: '开始优化UI',
      attachments: undefined,
    })
  })
})
