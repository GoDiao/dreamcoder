import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { act } from 'react'
import type { GroupProps, PanelImperativeHandle, PanelProps } from 'react-resizable-panels'

const viewportMocks = vi.hoisted(() => ({
  isMobile: false,
}))

const windowMocks = vi.hoisted(() => ({
  desktop: false,
}))

vi.mock('../lib/desktopRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/desktopRuntime')>()),
  isDesktopRuntime: () => windowMocks.desktop,
}))

const panelMocks = vi.hoisted(() => ({
  onLayoutChanged: undefined as GroupProps['onLayoutChanged'],
  workspacePanelRef: undefined as { current: PanelImperativeHandle | null } | undefined,
  panelProps: {} as Record<string, PanelProps>,
}))

vi.mock('react-resizable-panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-resizable-panels')>()
  return {
    ...actual,
    Group: (props: GroupProps) => {
      panelMocks.onLayoutChanged = props.onLayoutChanged
      return <actual.Group {...props} />
    },
    Panel: (props: PanelProps) => {
      if (props.id) panelMocks.panelProps[props.id] = props
      if (props.id === 'workspace-panel') panelMocks.workspacePanelRef = props.panelRef as { current: PanelImperativeHandle | null }
      return <actual.Panel {...props} />
    },
  }
})

vi.mock('../hooks/useMobileViewport', () => ({
  useMobileViewport: () => viewportMocks.isMobile,
  useViewportQuery: () => viewportMocks.isMobile,
}))

vi.mock('../components/chat/MessageList', () => ({
  MessageList: ({ compact }: { compact?: boolean }) => (
    <div data-testid="message-list" data-compact={compact ? 'true' : 'false'} />
  ),
}))

vi.mock('../components/chat/ChatInput', () => ({
  ChatInput: ({ compact, variant }: { compact?: boolean; variant?: string }) => (
    <div data-testid="chat-input" data-compact={compact ? 'true' : 'false'} data-variant={variant} />
  ),
}))

vi.mock('../components/teams/TeamStatusBar', () => ({
  TeamStatusBar: () => <div data-testid="team-status-bar" />,
}))

vi.mock('../components/chat/SessionTaskBar', () => ({
  SessionTaskBar: () => <div data-testid="session-task-bar" />,
}))

vi.mock('../components/workspace/WorkspacePanel', () => ({
  WorkspacePanel: ({
    sessionId,
    sessionTitle,
    titleRowStyle,
    terminalCwd,
    contextLabel,
  }: {
    sessionId: string
    sessionTitle: string
    titleRowStyle?: { paddingLeft?: string }
    terminalCwd?: string
    contextLabel?: string
  }) => (
    <div
      data-testid="workspace-panel"
      data-title={sessionTitle}
      data-inset={titleRowStyle?.paddingLeft ? 'true' : 'false'}
      data-cwd={terminalCwd ?? ''}
      data-context={contextLabel ?? ''}
    >
      workspace:{sessionId}
    </div>
  ),
}))

import { ActiveSession } from './ActiveSession'
import { useChatStore } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useTeamStore } from '../stores/teamStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { useUIStore } from '../stores/uiStore'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  panelMocks.panelProps = {}
  viewportMocks.isMobile = false
  windowMocks.desktop = false
  useTabStore.setState({ tabs: [], activeTabId: null })
  useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
  useChatStore.setState({ sessions: {} })
  useTeamStore.setState({ teams: [], activeTeam: null, memberColors: new Map(), error: null })
  useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
  localStorage.clear()
})

describe('ActiveSession task polling', () => {
  it('treats a persisted historical session as non-empty before messages finish loading', () => {
    const sessionId = 'history-loading-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'History Loading Session',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: '2026-05-07T00:00:00.000Z',
        messageCount: 2,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'History Loading Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [],
          chatState: 'idle',
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
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.getByTestId('message-list')).toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-variant', 'default')
  })

  it('renders the current goal as a strip at the top of the chat column', () => {
    const sessionId = 'goal-visible-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Goal Visible Session',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: '2026-05-07T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Goal Visible Session', type: 'session', status: 'running' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{
            id: 'goal-event',
            type: 'goal_event',
            action: 'created',
            status: 'active',
            objective: 'ship the smoke test',
            budget: '0 / 2,000 tokens',
            continuations: '0',
            timestamp: 1,
          }],
          activeGoal: {
            action: 'created',
            status: 'active',
            objective: 'ship the smoke test',
            budget: '0 / 2,000 tokens',
            continuations: '0',
            updatedAt: 1,
          },
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
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.queryByTestId('active-goal-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-goal-strip')).toBeInTheDocument()
    expect(screen.getByTestId('active-goal-strip')).toHaveTextContent('ship the smoke test')
    expect(within(screen.getByTestId('active-session-chat-column')).getByTestId('active-goal-strip')).toBeInTheDocument()
    expect(within(screen.getByTestId('session-header')).queryByTestId('active-goal-strip')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('does not keep a completed goal pinned in the header', () => {
    const sessionId = 'goal-completed-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Goal Completed Session',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: '2026-05-07T00:00:00.000Z',
        messageCount: 3,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Goal Completed Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{
            id: 'goal-completed-event',
            type: 'goal_event',
            action: 'completed',
            status: 'complete',
            message: 'Goal marked complete.',
            timestamp: 3,
          }],
          activeGoal: {
            action: 'completed',
            status: 'complete',
            message: 'Goal marked complete.',
            updatedAt: 3,
          },
          chatState: 'idle',
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
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.queryByTestId('active-goal-strip')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('does not render background agent progress as a page-level panel', () => {
    const sessionId = 'background-agent-visible-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Background Agent Session',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: '2026-05-07T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Background Agent Session', type: 'session', status: 'running' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [],
          activeGoal: {
            action: 'created',
            status: 'active',
            objective: 'ship the smoke test',
            updatedAt: 1,
          },
          backgroundAgentTasks: {
            'agent-task-1': {
              taskId: 'agent-task-1',
              toolUseId: 'agent-tool-1',
              status: 'running',
              taskType: 'local_agent',
              description: 'Verify the todo app',
              summary: 'Running Playwright checks',
              usage: {
                totalTokens: 1200,
                toolUses: 4,
                durationMs: 45000,
              },
              startedAt: 1,
              updatedAt: 2,
            },
          },
          chatState: 'tool_executing',
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
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.queryByTestId('background-agent-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('keeps the session header active while a background task is still running after the turn completes', () => {
    const sessionId = 'background-shell-running-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Background Shell Session',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: new Date().toISOString(),
        messageCount: 1,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Background Shell Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'task started', timestamp: 1 }],
          backgroundAgentTasks: {
            'bash-task-1': {
              taskId: 'bash-task-1',
              toolUseId: 'bash-tool-1',
              status: 'running',
              taskType: 'local_bash',
              description: 'Run page integration checks',
              startedAt: 1,
              updatedAt: 2,
            },
          },
          chatState: 'idle',
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
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.getByText(/session active|会话活跃中/)).toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-variant', 'default')
  })

  it('refreshes CLI tasks repeatedly while a turn is active', async () => {
    vi.useFakeTimers()

    const sessionId = 'polling-session'
    const originalCliTaskState = useCLITaskStore.getState()
    const fetchSessionTasks = vi.fn().mockResolvedValue(undefined)

    useCLITaskStore.setState({
      sessionId,
      tasks: [],
      fetchSessionTasks,
    })

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Polling Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Polling Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
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
        },
      },
    })

    const { unmount } = render(<ActiveSession />)

    expect(fetchSessionTasks).toHaveBeenCalledWith(sessionId)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200)
    })

    expect(
      fetchSessionTasks.mock.calls.filter(([currentSessionId]) => currentSessionId === sessionId),
    ).toHaveLength(4)

    unmount()
    useCLITaskStore.setState(originalCliTaskState)
  })

  it('keeps member sessions interactive and skips leader task polling', () => {
    const memberSessionId = 'team-member:security-reviewer@test-team'
    const originalCliTaskState = useCLITaskStore.getState()
    const fetchSessionTasks = vi.fn().mockResolvedValue(undefined)

    useCLITaskStore.setState({
      sessionId: null,
      tasks: [],
      fetchSessionTasks,
    })

    useTeamStore.setState({
      teams: [],
      activeTeam: {
        name: 'test-team',
        leadAgentId: 'team-lead@test-team',
        leadSessionId: 'leader-session',
        members: [
          {
            agentId: 'team-lead@test-team',
            role: 'team-lead',
            status: 'running',
            sessionId: 'leader-session',
          },
          {
            agentId: 'security-reviewer@test-team',
            role: 'security-reviewer',
            status: 'running',
          },
        ],
      },
      memberColors: new Map(),
      error: null,
    })

    useTabStore.setState({
      tabs: [{ sessionId: memberSessionId, title: 'security-reviewer', type: 'session', status: 'idle' }],
      activeTabId: memberSessionId,
    })

    useChatStore.setState({
      sessions: {
        [memberSessionId]: {
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
        },
      },
    })

    const { queryByTestId, unmount } = render(<ActiveSession />)

    expect(queryByTestId('chat-input')).toBeInTheDocument()
    expect(queryByTestId('session-task-bar')).not.toBeInTheDocument()
    expect(fetchSessionTasks).not.toHaveBeenCalled()

    unmount()
    useCLITaskStore.setState(originalCliTaskState)
  })

  it('renders the workspace panel to the right of chat with an accessible resize separator', async () => {
    const sessionId = 'workspace-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Workspace Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: '/tmp/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Workspace Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'hello', timestamp: 1 }],
          chatState: 'idle',
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
        },
      },
    })
    useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'changes' })

    render(<ActiveSession />)
    await screen.findByTestId('workspace-panel')

    const contentRow = screen.getByTestId('active-session-content-row')
    const chatColumn = screen.getByTestId('active-session-chat-column')
    const sidePanel = screen.getByTestId('session-side-panel')
    const resizeHandle = screen.getByTestId('workspace-resize-handle')

    expect(within(contentRow).getByTestId('message-list')).toBeInTheDocument()
    expect(within(contentRow).getByTestId('message-list')).toHaveAttribute('data-compact', 'true')
    expect(within(contentRow).getByTestId('workspace-panel')).toHaveTextContent(`workspace:${sessionId}`)
    expect(within(chatColumn).getByTestId('chat-input')).toBeInTheDocument()
    expect(within(chatColumn).getByTestId('chat-input')).toHaveAttribute('data-compact', 'true')
    expect(panelMocks.panelProps['conversation-panel']).toMatchObject({ minSize: 320, maxSize: undefined })
    expect(panelMocks.panelProps['workspace-panel']).toMatchObject({ minSize: 280, maxSize: 680 })
    expect(contentRow.children[0]).toContainElement(chatColumn)
    expect(contentRow.children[1]).toBe(resizeHandle)
    expect(contentRow.children[2]).toBe(sidePanel)
    expect(sidePanel).toContainElement(screen.getByTestId('workspace-panel'))
    expect(resizeHandle).toHaveAttribute('role', 'separator')
    expect(resizeHandle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('saves the workspace panel width after the user resizes it', async () => {
    const sessionId = 'workspace-session'
    useSessionStore.setState({
      sessions: [{ id: sessionId, title: 'Workspace Session', createdAt: '2026-04-26T00:00:00.000Z', modifiedAt: '2026-04-26T00:00:00.000Z', messageCount: 1, projectPath: '', workDir: '/tmp/project', workDirExists: true }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({ tabs: [{ sessionId, title: 'Workspace Session', type: 'session', status: 'idle' }], activeTabId: sessionId })
    useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'changes' })
    useWorkspacePanelStore.getState().setWidth(400)

    render(<ActiveSession />)
    await screen.findByTestId('workspace-resize-handle')
    panelMocks.workspacePanelRef!.current = { getSize: () => ({ asPercentage: 40, inPixels: 520 }) } as unknown as PanelImperativeHandle
    act(() => panelMocks.onLayoutChanged!({}, { isUserInteraction: true } as Parameters<NonNullable<GroupProps['onLayoutChanged']>>[1]))

    await waitFor(() => expect(useWorkspacePanelStore.getState().width).toBe(520))
  })

  it('does not render the workspace panel when closed or for member sessions', () => {
    const regularSessionId = 'regular-session'

    useSessionStore.setState({
      sessions: [{
        id: regularSessionId,
        title: 'Regular Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: '',
        workDir: '/tmp/project',
        workDirExists: true,
      }],
      activeSessionId: regularSessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId: regularSessionId, title: 'Regular Session', type: 'session', status: 'idle' }],
      activeTabId: regularSessionId,
    })
    useChatStore.setState({
      sessions: {
        [regularSessionId]: {
          messages: [],
          chatState: 'idle',
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
        },
      },
    })

    const { rerender } = render(<ActiveSession />)
    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()

    const memberSessionId = 'team-member:security-reviewer@test-team'
    act(() => {
      useTeamStore.setState({
        teams: [],
        activeTeam: {
          name: 'test-team',
          leadAgentId: 'team-lead@test-team',
          leadSessionId: 'leader-session',
          members: [
            {
              agentId: 'team-lead@test-team',
              role: 'team-lead',
              status: 'running',
              sessionId: 'leader-session',
            },
            {
              agentId: 'security-reviewer@test-team',
              role: 'security-reviewer',
              status: 'running',
            },
          ],
        },
        memberColors: new Map(),
        error: null,
      })
      useTabStore.setState({
        tabs: [{ sessionId: memberSessionId, title: 'security-reviewer', type: 'session', status: 'idle' }],
        activeTabId: memberSessionId,
      })
      useChatStore.setState({
        sessions: {
          [memberSessionId]: {
            messages: [{ id: 'msg-2', type: 'assistant_text', content: 'hello', timestamp: 1 }],
            chatState: 'idle',
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
          },
        },
      })
      useWorkspacePanelStore.getState().openTab(memberSessionId, { kind: 'changes' })
      rerender(<ActiveSession />)
    })

    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('keeps chat as the primary surface on mobile by hiding workspace and terminal panels', () => {
    const sessionId = 'mobile-session'
    viewportMocks.isMobile = true

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Mobile Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/tmp/project-root',
        workDir: '/tmp/project-root',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Mobile Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'hello', timestamp: 1 }],
          chatState: 'idle',
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
        },
      },
    })
    useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'terminal' })

    render(<ActiveSession />)

    expect(screen.getByTestId('active-session-chat-column')).toHaveClass('min-w-0')
    expect(screen.getByTestId('message-list')).toHaveAttribute('data-compact', 'false')
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-compact', 'false')
    expect(screen.queryByRole('heading', { name: 'Mobile Session' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-resize-handle')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Terminal' })).not.toBeInTheDocument()
  })

  it('opens one side panel from the header button and passes the session context', async () => {
    windowMocks.desktop = true
    const sessionId = 'terminal-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Terminal Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/tmp/project-root',
        projectRoot: '/tmp/project-root',
        workDir: '/tmp/project-root/packages/app',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Terminal Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'hello', timestamp: 1 }],
          chatState: 'idle',
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
        },
      },
    })
    useWorkspacePanelStore.setState({
      statusBySession: {
        [sessionId]: {
          state: 'ok',
          workDir: '/tmp/project-root/packages/app',
          repoName: 'project-root',
          branch: 'feat/panel',
          isGitRepo: true,
          changedFiles: [],
        },
      },
    })

    render(<ActiveSession />)

    // One row: the title and buttons; project and branch live under the input.
    const header = screen.getByTestId('session-header')
    expect(header).toHaveTextContent('Terminal Session')
    expect(header).not.toHaveTextContent('project-root')
    expect(header).not.toHaveTextContent('feat/panel')
    expect(screen.queryByTestId('session-header-meta')).not.toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Terminal' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open side panel' }))
    })
    expect(useWorkspacePanelStore.getState().getActiveTab(sessionId)?.kind).toBe('files')
    expect(screen.queryByRole('button', { name: 'Open side panel' })).not.toBeInTheDocument()
    const panel = await screen.findByTestId('workspace-panel')
    expect(panel).toHaveAttribute('data-title', 'Terminal Session')
    expect(panel).toHaveAttribute('data-cwd', '/tmp/project-root/packages/app')
    expect(panel).toHaveAttribute('data-context', 'project-root · feat/panel')
    expect(screen.getByTestId('active-session-chat-column')).toContainElement(header)
    expect(screen.getByTestId('session-side-panel')).not.toContainElement(header)
  })

  it('makes the session header a window drag region', () => {
    windowMocks.desktop = true
    const sessionId = 'drag-session'
    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Drag Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Drag Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })

    render(<ActiveSession />)

    expect(screen.getByTestId('session-header')).toHaveClass('window-drag-region')
  })

  it('hides the chat column while the panel is expanded and restores side by side', async () => {
    windowMocks.desktop = true
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    useUIStore.setState({ sidebarOpen: false })
    const sessionId = 'expanded-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Expanded Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/tmp/project-root',
        workDir: '/tmp/project-root',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Expanded Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'terminal' })
    useWorkspacePanelStore.getState().toggleExpanded(sessionId)

    render(<ActiveSession />)

    expect(screen.getByTestId('active-session-chat-column')).not.toBeVisible()
    expect(panelMocks.panelProps['conversation-panel']).toMatchObject({ maxSize: 0 })
    expect(panelMocks.panelProps['workspace-panel']).toMatchObject({ minSize: 0, maxSize: '100%' })
    expect(screen.queryByTestId('workspace-resize-handle')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Expanded Session' })).not.toBeInTheDocument()
    expect(await screen.findByTestId('workspace-panel')).toHaveAttribute('data-inset', 'true')

    act(() => {
      useWorkspacePanelStore.getState().toggleExpanded(sessionId)
    })
    expect(screen.getByTestId('active-session-chat-column')).toBeVisible()
    expect(panelMocks.panelProps['conversation-panel']).toMatchObject({ minSize: 320, maxSize: undefined })
    expect(panelMocks.panelProps['workspace-panel']).toMatchObject({ minSize: 280, maxSize: 680 })
    expect(screen.getByTestId('workspace-resize-handle')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-panel')).toHaveAttribute('data-inset', 'false')
    expect(screen.getByRole('heading', { name: 'Expanded Session' })).toBeInTheDocument()
    useUIStore.setState({ sidebarOpen: true })
  })

  it('keeps the header on an empty session and shows a title-and-hint hero', () => {
    const sessionId = 'empty-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Empty Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/tmp/project-root',
        workDir: '/tmp/project-root',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Empty Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })

    render(<ActiveSession />)

    expect(screen.getByRole('heading', { level: 1, name: 'Empty Session' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open side panel' })).toBeInTheDocument()
    expect(screen.queryByTestId('message-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-variant', 'hero')
  })
})
