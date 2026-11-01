import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { act } from 'react'

const viewportMocks = vi.hoisted(() => ({
  isMobile: false,
}))

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  getTranscript: vi.fn(),
  getGitInfo: vi.fn(),
  getSlashCommands: vi.fn(),
  getRepositoryContext: vi.fn(),
  getRecentProjects: vi.fn(),
  getInspection: vi.fn(),
  search: vi.fn(),
  browse: vi.fn(),
  wsSend: vi.fn(),
  dialogOpen: vi.fn(),
  syncMarks: vi.fn(),
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    create: mocks.create,
    delete: mocks.delete,
    list: mocks.list,
    getTranscript: mocks.getTranscript,
    getGitInfo: mocks.getGitInfo,
    getSlashCommands: mocks.getSlashCommands,
    getRepositoryContext: mocks.getRepositoryContext,
    getRecentProjects: mocks.getRecentProjects,
    getInspection: mocks.getInspection,
  },
}))

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    search: mocks.search,
    browse: mocks.browse,
  },
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: mocks.wsSend,
  },
}))

vi.mock('../../lib/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/shell')>()),
  pickFiles: mocks.dialogOpen,
  syncBrowserMarks: mocks.syncMarks,
  getFilePath: (file: File) => (file as File & { path?: string }).path,
}))

vi.mock('../../hooks/useMobileViewport', () => ({
  useMobileViewport: () => viewportMocks.isMobile,
}))

vi.mock('../controls/PermissionModeSelector', () => ({
  PermissionModeSelector: () => <button type="button">Permissions</button>,
}))

vi.mock('../controls/ModelSelector', () => ({
  ModelSelector: () => <button type="button">Model</button>,
}))

import { ChatInput } from './ChatInput'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { parseBrowserReferencePrompt } from '../../lib/browserReferences'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { useProviderStore } from '../../stores/providerStore'
import { useUIStore } from '../../stores/uiStore'
import { toast } from 'sonner'

function okRepositoryContext() {
  return {
    state: 'ok' as const,
    workDir: '/repo',
    repoRoot: '/repo',
    repoName: 'repo',
    currentBranch: 'main',
    defaultBranch: 'main',
    dirty: false,
    branches: [
      {
        name: 'main',
        current: true,
        local: true,
        remote: false,
        checkedOut: true,
        worktreePath: '/repo',
      },
      {
        name: 'feature/a',
        current: false,
        local: true,
        remote: false,
        checkedOut: false,
      },
    ],
    worktrees: [{
      path: '/repo',
      branch: 'main',
      current: true,
    }],
  }
}

describe('ChatInput file mentions', () => {
  const sessionId = 'session-file-mention'
  const initialChatState = useChatStore.getInitialState()
  const initialSessionState = useSessionStore.getInitialState()
  const initialTabState = useTabStore.getInitialState()
  const initialWorkspaceContextState = useWorkspaceChatContextStore.getInitialState()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.syncMarks.mockReset().mockImplementation(async ({ refs }: { refs: Array<{ ref: string }> }) => refs.map((request) => request.ref))
    delete (window as Window & { dreamcoderShell?: unknown }).dreamcoderShell
    viewportMocks.isMobile = false
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState(initialChatState, true)
    useSessionStore.setState(initialSessionState, true)
    useTabStore.setState(initialTabState, true)
    useWorkspaceChatContextStore.setState(initialWorkspaceContextState, true)

    useTabStore.setState({
      activeTabId: sessionId,
      tabs: [{ sessionId, title: 'Project', type: 'session', status: 'idle' }],
    })
    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Project',
        createdAt: '2026-05-01T00:00:00.000Z',
        modifiedAt: '2026-05-01T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/repo',
        workDir: '/repo',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'existing', type: 'assistant_text', content: 'ready', timestamp: 1 }],
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
    mocks.getGitInfo.mockResolvedValue({ branch: 'main', repoName: 'repo', workDir: '/repo', changedFiles: 0 })
    mocks.getRepositoryContext.mockResolvedValue(okRepositoryContext())
    mocks.getRecentProjects.mockResolvedValue({ projects: [] })
    mocks.create.mockResolvedValue({ sessionId: 'created-session', workDir: '/repo' })
    mocks.delete.mockResolvedValue({ ok: true })
    mocks.list.mockResolvedValue({ sessions: [], total: 0 })
    mocks.getTranscript.mockResolvedValue({ items: [], agentNotifications: {}, lastTodos: null, hasMessagesAfterTaskCompletion: false })
    mocks.getInspection.mockResolvedValue({ errors: {} })
    mocks.getSlashCommands.mockResolvedValue({ commands: [] })
  })

  it('keeps unsent composer drafts isolated when switching between session tabs', async () => {
    const historySessionId = 'history-session'
    useTabStore.setState({
      activeTabId: sessionId,
      tabs: [
        { sessionId, title: 'New session', type: 'session', status: 'idle' },
        { sessionId: historySessionId, title: 'History session', type: 'session', status: 'idle' },
      ],
    })
    useSessionStore.setState({
      sessions: [
        {
          id: sessionId,
          title: 'New session',
          createdAt: '2026-05-01T00:00:00.000Z',
          modifiedAt: '2026-05-01T00:00:00.000Z',
          messageCount: 0,
          projectPath: '/repo',
          workDir: '/repo',
          workDirExists: true,
        },
        {
          id: historySessionId,
          title: 'History session',
          createdAt: '2026-05-01T00:00:00.000Z',
          modifiedAt: '2026-05-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/repo',
          workDir: '/repo',
          workDirExists: true,
        },
      ],
      activeSessionId: sessionId,
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
        [historySessionId]: {
          messages: [{ id: 'history-message', type: 'assistant_text', content: 'ready', timestamp: 1 }],
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

    render(<ChatInput variant="hero" />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: { value: 'new tab draft', selectionStart: 13 },
    })
    expect(input.value).toBe('new tab draft')

    act(() => {
      useTabStore.setState({ activeTabId: historySessionId })
    })

    await waitFor(() => {
      expect(input.value).toBe('')
    })

    fireEvent.change(input, {
      target: { value: 'history tab draft', selectionStart: 17 },
    })

    act(() => {
      useTabStore.setState({ activeTabId: sessionId })
    })

    await waitFor(() => {
      expect(input.value).toBe('new tab draft')
    })

    act(() => {
      useTabStore.setState({ activeTabId: historySessionId })
    })

    await waitFor(() => {
      expect(input.value).toBe('history tab draft')
    })
  })

  it('restores an unsent composer draft after the composer unmounts', async () => {
    const { unmount } = render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: { value: 'keep this prompt while I inspect another tab', selectionStart: 43 },
    })
    expect(input.value).toBe('keep this prompt while I inspect another tab')

    unmount()
    render(<ChatInput compact />)

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('keep this prompt while I inspect another tab')
    })
  })

  it('shows branch and worktree launch controls for an empty active Git session', async () => {
    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Project',
        createdAt: '2026-05-01T00:00:00.000Z',
        modifiedAt: '2026-05-01T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/repo',
        workDir: '/repo',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
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

    render(<ChatInput variant="hero" />)

    const panel = screen.getByTestId('chat-input-panel')
    expect(panel).toHaveClass('rounded-2xl')
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '1')

    expect(await screen.findByRole('button', { name: /Select branch: main/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /worktree/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Select a project...')).not.toBeInTheDocument()
    const branchButton = screen.getByRole('button', { name: /Select branch: main/ })
    const controls = screen.getByTestId('chat-input-controls')
    expect(panel).not.toContainElement(branchButton)
    expect(controls).toContainElement(branchButton)
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Permissions' }))
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Model' }))
    expect(branchButton.parentElement).toHaveClass('bg-transparent')
  })

  it('uses the persisted message count to keep reopened sessions in context mode while history loads', async () => {
    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Project',
        createdAt: '2026-05-01T00:00:00.000Z',
        modifiedAt: '2026-05-01T00:00:00.000Z',
        messageCount: 2,
        projectPath: '/repo',
        workDir: '/repo',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
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

    render(<ChatInput variant="hero" />)

    expect(await screen.findByText('repo')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Select branch:/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Run in a new worktree')).not.toBeInTheDocument()
  })

  it('shows the context details as a hover card, not a drawer, in the narrow desktop composer', async () => {
    mocks.getInspection.mockResolvedValue({
      active: true,
      status: { sessionId, workDir: '/repo', cwd: '/repo', permissionMode: 'default', model: 'kimi-k2.6' },
      context: {
        categories: [{ name: 'Messages', tokens: 42_000, color: '#2D628F' }],
        totalTokens: 42_000,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 21,
        gridRows: [],
        model: 'kimi-k2.6',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
      },
    })

    render(<ChatInput compact />)

    const trigger = await screen.findByRole('button', { name: /21%/ })
    fireEvent.click(trigger)
    fireEvent.focus(trigger)

    expect(await screen.findByRole('progressbar', { name: 'Context' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Context' })).toBeNull()
  })

  it('keeps the context details in a drawer on a phone', async () => {
    viewportMocks.isMobile = true
    mocks.getInspection.mockResolvedValue({
      active: true,
      status: { sessionId, workDir: '/repo', cwd: '/repo', permissionMode: 'default', model: 'kimi-k2.6' },
      context: {
        categories: [{ name: 'Messages', tokens: 42_000, color: '#2D628F' }],
        totalTokens: 42_000,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 21,
        gridRows: [],
        model: 'kimi-k2.6',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
      },
    })

    render(<ChatInput />)

    fireEvent.click(await screen.findByRole('button', { name: /21%/ }))

    expect(await screen.findByRole('dialog', { name: 'Context' })).toBeVisible()
  })

  it('names the missing working directory at the input and keeps sending disabled', async () => {
    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Project',
        createdAt: '2026-05-01T00:00:00.000Z',
        modifiedAt: '2026-05-01T00:00:00.000Z',
        messageCount: 2,
        projectPath: '/repo/deleted-app',
        workDir: '/repo/deleted-app',
        workDirExists: false,
      }],
      activeSessionId: sessionId,
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

    render(<ChatInput />)

    const notice = await screen.findByTestId('workspace-missing-notice')
    expect(notice).toHaveTextContent('/repo/deleted-app')
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  })

  it('starts an empty active session on the selected branch without an isolated worktree', async () => {
    mocks.create.mockResolvedValueOnce({ sessionId: 'created-direct', workDir: '/repo' })
    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Project',
        createdAt: '2026-05-01T00:00:00.000Z',
        modifiedAt: '2026-05-01T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/repo',
        workDir: '/repo',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
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
          permissionMode: 'plan',
        },
      },
    })

    render(<ChatInput variant="hero" />)

    fireEvent.click(await screen.findByRole('button', { name: /Select branch: main/ }))
    fireEvent.click(await screen.findByRole('option', { name: /feature\/a/ }))
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'run on feature branch', selectionStart: 21 } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith({
        workDir: '/repo',
        repository: { branch: 'feature/a', worktree: false },
        permissionMode: 'plan',
      })
    })
    expect(mocks.delete).toHaveBeenCalledWith(sessionId)
    expect(mocks.wsSend).toHaveBeenCalledWith('created-direct', {
      type: 'user_message',
      id: expect.any(String),
      content: 'run on feature branch',
      attachments: [],
    })
  })

  it('starts an empty active session on the selected branch inside an isolated worktree', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    mocks.create.mockResolvedValueOnce({
      sessionId: 'created-worktree',
      workDir: '/repo/.claude/worktrees/desktop-feature-a-12345678',
    })
    mocks.list.mockImplementationOnce(() => new Promise(() => {}))
    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Project',
        createdAt: '2026-05-01T00:00:00.000Z',
        modifiedAt: '2026-05-01T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/repo',
        workDir: '/repo',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
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

    render(<ChatInput variant="hero" />)

    fireEvent.click(await screen.findByRole('button', { name: /Select branch: main/ }))
    fireEvent.click(await screen.findByRole('option', { name: /feature\/a/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Select branch: feature/a' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Run in a new worktree' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Select branch: feature/a · Run in a new worktree' })).toBeInTheDocument()
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'run in a worktree', selectionStart: 17 } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith({
        workDir: '/repo',
        repository: { branch: 'feature/a', worktree: true },
      })
    })
    expect(mocks.delete).toHaveBeenCalledWith(sessionId)
    expect(mocks.wsSend).toHaveBeenCalledWith('created-worktree', {
      type: 'user_message',
      id: expect.any(String),
      content: 'run in a worktree',
      attachments: [],
    })
    expect(useSessionStore.getState().sessions[0]?.workDir)
      .toBe('/repo/.claude/worktrees/desktop-feature-a-12345678')
  })

  it('turns a selected @ file into a chip without corrupting the typed path', async () => {
    mocks.search.mockResolvedValueOnce({
      currentPath: '/repo/backend/src',
      parentPath: '/repo/backend',
      query: 'conditions.py',
      entries: [
        { name: 'conditions.py', path: '/repo/backend/src/conditions.py', isDirectory: false },
      ],
    })

    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    const mention = '@backend/src/conditions.py'
    fireEvent.change(input, {
      target: {
        value: `${mention} 记一下这个文件讲了什么东西。`,
        selectionStart: mention.length,
      },
    })

    fireEvent.click(await screen.findByText('backend/src/conditions.py'))

    await waitFor(() => {
      expect(input.value).toBe('记一下这个文件讲了什么东西。')
    })
    expect(screen.getByText('conditions.py')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, {
      type: 'user_message',
      id: expect.any(String),
      content: '记一下这个文件讲了什么东西。',
      attachments: [{
        type: 'file',
        name: 'conditions.py',
        path: '/repo/backend/src/conditions.py',
        isDirectory: false,
        lineStart: undefined,
        lineEnd: undefined,
        note: undefined,
        quote: undefined,
      }],
    })
    const messages = useChatStore.getState().sessions[sessionId]?.messages ?? []
    expect(messages[messages.length - 1]).toMatchObject({
      type: 'user_text',
      content: '记一下这个文件讲了什么东西。',
      modelContent: '@"/repo/backend/src/conditions.py" 记一下这个文件讲了什么东西。',
      attachments: [{ name: 'conditions.py', path: '/repo/backend/src/conditions.py' }],
    })
  })

  it('inserts queued inline workspace citations at the current cursor and keeps file context attached', async () => {
    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: {
        value: '请看实现',
        selectionStart: 2,
        selectionEnd: 2,
      },
    })
    input.setSelectionRange(2, 2)

    act(() => {
      useChatStore.getState().queueComposerInsertion(sessionId, {
        text: '@"src/App.tsx"',
        reference: {
          kind: 'file',
          path: 'src/App.tsx',
          absolutePath: '/repo/src/App.tsx',
          name: 'App.tsx',
        },
      })
    })

    await waitFor(() => {
      expect(input.value).toBe('请看 @"src/App.tsx" 实现')
    })
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    expect(useWorkspaceChatContextStore.getState().referencesBySession[sessionId]).toMatchObject([
      {
        kind: 'file',
        path: 'src/App.tsx',
        absolutePath: '/repo/src/App.tsx',
        name: 'App.tsx',
      },
    ])

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, {
      type: 'user_message',
      id: expect.any(String),
      content: '请看 @"src/App.tsx" 实现',
      attachments: [{
        type: 'file',
        name: 'App.tsx',
        path: '/repo/src/App.tsx',
        isDirectory: undefined,
        lineStart: undefined,
        lineEnd: undefined,
        note: undefined,
        quote: undefined,
      }],
    })
    const messages = useChatStore.getState().sessions[sessionId]?.messages ?? []
    expect(messages[messages.length - 1]).toMatchObject({
      type: 'user_text',
      content: '请看 @"src/App.tsx" 实现',
      modelContent: '@"/repo/src/App.tsx" 请看 @"src/App.tsx" 实现',
      attachments: [{ name: 'App.tsx', path: 'src/App.tsx' }],
    })
  })

  it('turns a selected @ directory into a workspace chip and model path reference', async () => {
    mocks.search.mockResolvedValueOnce({
      currentPath: '/repo',
      parentPath: '/',
      query: 'backend',
      entries: [
        { name: 'backend', path: '/repo/backend', relativePath: 'backend', isDirectory: true },
      ],
    })

    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: {
        value: '@backend 讲一下这个目录。',
        selectionStart: '@backend'.length,
      },
    })

    fireEvent.click(await screen.findByRole('option', { name: /backend/i }))

    await waitFor(() => {
      expect(input.value).toBe('讲一下这个目录。')
    })
    expect(screen.getByText('backend/')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove backend/' })).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, {
      type: 'user_message',
      id: expect.any(String),
      content: '讲一下这个目录。',
      attachments: [{
        type: 'file',
        name: 'backend/',
        path: '/repo/backend',
        isDirectory: true,
        lineStart: undefined,
        lineEnd: undefined,
        note: undefined,
        quote: undefined,
      }],
    })
    const messages = useChatStore.getState().sessions[sessionId]?.messages ?? []
    expect(messages[messages.length - 1]).toMatchObject({
      type: 'user_text',
      content: '讲一下这个目录。',
      modelContent: '@"/repo/backend" 讲一下这个目录。',
      attachments: [{ name: 'backend/', path: '/repo/backend' }],
    })
  })

  function pickedElement(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'browser' as const,
      path: 'https://example.com/a',
      name: 'button.buy',
      note: 'make it red',
      browser: {
        url: 'https://example.com/a',
        title: 'Example',
        tabId: 'tab-1',
        text: 'Buy now',
        truncated: false,
        element: {
          ref: '12',
          generation: 0,
          tag: 'button',
          label: 'button.buy',
          role: 'button',
          name: 'Buy',
          selector: 'main > button',
          html: '<button class="buy">Buy now</button>',
          sensitive: false,
          stale: false,
          screenshot: { data: 'data:image/webp;base64,AAAA', mimeType: 'image/webp' },
          ...overrides,
        },
      },
    }
  }

  it('sends a picked element as fenced context plus its screenshot, not as a file path', async () => {
    mocks.syncMarks.mockResolvedValue(['12'])
    useWorkspaceChatContextStore.getState().addReference(sessionId, pickedElement())

    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalled())
    const sent = mocks.wsSend.mock.calls[0]?.[1] as { content: string; attachments: Array<Record<string, unknown>> }
    const parsed = parseBrowserReferencePrompt(sent.content)
    expect(parsed?.rest).toBe('fix this')
    expect(parsed?.references[0]).toMatchObject({
      note: 'make it red',
      hasScreenshot: true,
      browser: { url: 'https://example.com/a', element: { ref: '12', selector: 'main > button', stale: false } },
    })
    expect(sent.attachments).toHaveLength(1)
    expect(sent.attachments[0]).toMatchObject({ type: 'image', data: 'data:image/webp;base64,AAAA', mimeType: 'image/webp' })
    expect(sent.attachments[0]?.name).toMatch(/\.webp$/)
    expect(sent.attachments[0]).not.toHaveProperty('path')

    const messages = useChatStore.getState().sessions[sessionId]?.messages ?? []
    expect(messages[messages.length - 1]).toMatchObject({
      type: 'user_text',
      content: 'fix this',
      attachments: [{ type: 'image', name: 'button.buy', data: 'data:image/webp;base64,AAAA' }],
    })
    expect(useWorkspaceChatContextStore.getState().referencesBySession[sessionId]).toEqual([])
  })

  it('checks the picked elements once more right before sending and flags the ones that are gone', async () => {
    mocks.syncMarks.mockResolvedValue([])
    useWorkspaceChatContextStore.getState().addReference(sessionId, pickedElement())

    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalled())
    expect(mocks.syncMarks).toHaveBeenCalledWith({ tabId: 'tab-1', refs: [{ ref: '12', generation: 0 }] })
    const sent = mocks.wsSend.mock.calls[0]?.[1] as { content: string }
    expect(sent.content).toContain('[1] element tab=tab-1 ref=12 screenshot stale')
    expect(parseBrowserReferencePrompt(sent.content)?.references[0]?.browser.element?.stale).toBe(true)
  })

  it('still sends when the final check of the picked elements fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.syncMarks.mockRejectedValue(new Error('the sidecar is not connected'))
    useWorkspaceChatContextStore.getState().addReference(sessionId, pickedElement())

    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalled())
    const sent = mocks.wsSend.mock.calls[0]?.[1] as { content: string }
    expect(sent.content).not.toContain('stale')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not wait for the page when no element was picked', async () => {
    useWorkspaceChatContextStore.getState().addReference(sessionId, {
      kind: 'browser',
      path: 'https://example.com/a',
      name: 'Example',
      browser: { url: 'https://example.com/a', title: 'Example', text: 'quoted', truncated: false },
    })

    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalled()
    expect(mocks.syncMarks).not.toHaveBeenCalled()
  })

  it('blocks sending while a picked element is still being read, and says why', async () => {
    useWorkspaceChatContextStore.getState().addReference(sessionId, pickedElement())
    useWorkspaceChatContextStore.getState().addReference(sessionId, {
      id: 'browser-pick:p1',
      kind: 'browser',
      path: '',
      name: '',
      browser: { url: '', title: '', tabId: 'tab-1', text: '', truncated: false, pendingPickId: 'p1' },
    })

    render(<ChatInput compact />)

    expect(screen.getByText('Picking…')).toBeInTheDocument()
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('An element you picked is still being read. Send again in a moment.')
    expect(useWorkspaceChatContextStore.getState().referencesBySession[sessionId]).toHaveLength(2)

    act(() => {
      useWorkspaceChatContextStore.getState().replaceReference(sessionId, 'browser-pick:p1', null)
    })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalledTimes(1))
  })

  it('blocks sending when a pick starts while the picked elements are being checked, and keeps the draft', async () => {
    let finishCheck: (alive: string[]) => void = () => undefined
    mocks.syncMarks.mockReturnValue(new Promise<string[]>((resolve) => { finishCheck = resolve }))
    useWorkspaceChatContextStore.getState().addReference(sessionId, pickedElement())

    render(<ChatInput compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mocks.syncMarks).toHaveBeenCalled())

    act(() => {
      useWorkspaceChatContextStore.getState().addReference(sessionId, {
        id: 'browser-pick:p2',
        kind: 'browser',
        path: '',
        name: '',
        browser: { url: '', title: '', tabId: 'tab-1', text: '', truncated: false, pendingPickId: 'p2' },
      })
    })
    await act(async () => {
      finishCheck(['12'])
    })

    expect(mocks.wsSend).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('An element you picked is still being read. Send again in a moment.')
    expect(input.value).toBe('fix this')
    expect(useWorkspaceChatContextStore.getState().referencesBySession[sessionId]).toHaveLength(2)
  })

  it('says on the card that a sensitive element was not carried, and sends no screenshot for it', async () => {
    mocks.syncMarks.mockResolvedValue(['9'])
    useWorkspaceChatContextStore.getState().addReference(sessionId, {
      kind: 'browser',
      path: 'https://example.com/login',
      name: 'input.pw',
      browser: {
        url: 'https://example.com/login',
        title: 'Log in',
        tabId: 'tab-1',
        text: '',
        truncated: false,
        element: { ref: '9', generation: 0, tag: 'input', label: 'input.pw', role: '', name: '', selector: 'form > input.pw', sensitive: true, stale: false },
      },
    })

    render(<ChatInput compact />)

    expect(screen.getByText('Password and card fields are never carried; only where the element is.')).toBeInTheDocument()
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'why is this red' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalled())
    const sent = mocks.wsSend.mock.calls[0]?.[1] as { content: string; attachments: unknown[] }
    expect(sent.attachments).toEqual([])
    expect(sent.content).toContain('[1] element tab=tab-1 ref=9 sensitive')
    expect(sent.content).toContain('tag: input')
    expect(sent.content).not.toContain('role:')
  })

  it('uses native desktop file paths instead of inlining selected files', async () => {
    Object.defineProperty(window, 'dreamcoderShell', {
      configurable: true,
      value: {},
    })
    mocks.dialogOpen.mockResolvedValueOnce([
      '/Users/nanmi/tmp/large-a.log',
      'C:\\Users\\Nanmi\\Desktop\\large-b.zip',
    ])

    render(<ChatInput compact />)

    fireEvent.keyDown(screen.getByLabelText('Open composer tools'), { key: 'Enter' })
    fireEvent.click(screen.getByText('Add files or photos'))

    expect(await screen.findByText('large-a.log')).toBeInTheDocument()
    expect(await screen.findByText('large-b.zip')).toBeInTheDocument()

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: {
        value: 'analyze these',
        selectionStart: 'analyze these'.length,
      },
    })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, {
      type: 'user_message',
      id: expect.any(String),
      content: 'analyze these',
      attachments: [
        expect.objectContaining({
          type: 'file',
          name: 'large-a.log',
          path: '/Users/nanmi/tmp/large-a.log',
          data: undefined,
        }),
        expect.objectContaining({
          type: 'file',
          name: 'large-b.zip',
          path: 'C:\\Users\\Nanmi\\Desktop\\large-b.zip',
          data: undefined,
        }),
      ],
    })
  })

  it('accepts desktop file drops on the active session composer as path-only attachments', async () => {
    Object.defineProperty(window, 'dreamcoderShell', {
      configurable: true,
      value: {},
    })
    const droppedFile = new File(['large file'], 'ignored-name.log', { type: 'text/plain' })
    Object.defineProperty(droppedFile, 'path', {
      configurable: true,
      value: '/Users/nanmi/drop/large-a.log',
    })
    const dataTransfer = { types: ['Files'], files: [droppedFile], dropEffect: '' }

    render(<ChatInput compact />)

    const panel = screen.getByTestId('chat-input-panel')
    fireEvent.dragOver(panel, { dataTransfer })
    expect(screen.getByTestId('chat-input-drop-overlay')).toBeInTheDocument()

    fireEvent.drop(panel, { dataTransfer })

    expect(await screen.findByText('large-a.log')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-input-drop-overlay')).not.toBeInTheDocument()

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: {
        value: 'analyze dropped file',
        selectionStart: 'analyze dropped file'.length,
      },
    })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, {
      type: 'user_message',
      id: expect.any(String),
      content: 'analyze dropped file',
      attachments: [
        expect.objectContaining({
          type: 'file',
          name: 'large-a.log',
          path: '/Users/nanmi/drop/large-a.log',
          data: undefined,
        }),
      ],
    })
  })

  it('keeps slash and @ popovers outside the drop target clipping context', async () => {
    mocks.search.mockResolvedValueOnce({
      currentPath: '/repo',
      parentPath: null,
      query: '',
      entries: [
        { name: 'README.md', path: '/repo/README.md', isDirectory: false },
      ],
    })

    render(<ChatInput compact />)

    const panel = screen.getByTestId('chat-input-panel')
    const input = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.change(input, {
      target: {
        value: '/',
        selectionStart: 1,
      },
    })
    expect(await screen.findByText('/mcp')).toBeInTheDocument()
    expect(panel).toHaveClass('overflow-visible')
    expect(panel).not.toHaveClass('overflow-hidden')

    fireEvent.change(input, {
      target: {
        value: '@readme',
        selectionStart: 7,
      },
    })
    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(panel).toHaveClass('overflow-visible')
    expect(panel).not.toHaveClass('overflow-hidden')
  })

  it('uses larger icon-only mobile action buttons for browser H5 access', async () => {
    viewportMocks.isMobile = true
    mocks.search.mockResolvedValueOnce({
      currentPath: '/repo',
      parentPath: null,
      query: 'cond',
      entries: [
        { name: 'conditions.py', path: '/repo/conditions.py', isDirectory: false },
      ],
    })

    render(<ChatInput />)

    await waitFor(() => {
      expect(mocks.getGitInfo).toHaveBeenCalledWith(sessionId)
    })

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'ship it', selectionStart: 7 },
    })

    expect(screen.getByRole('button', { name: 'Open composer tools' })).toHaveClass('size-11')
    expect(screen.getByRole('button', { name: 'Run' })).toHaveClass('size-11')
    expect(screen.queryByText('Run')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-input-toolbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-input-shell')).toHaveClass('px-3')
    expect(screen.getByTestId('chat-input-shell').className).toContain('safe-area-inset-bottom')
    expect(screen.getByTestId('chat-input-panel')).toHaveClass('rounded-2xl')
    expect(screen.getByTestId('chat-input-panel')).not.toHaveClass('rounded-b-none')

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '@cond', selectionStart: 5 },
    })

    expect(await screen.findByText('conditions.py')).toBeInTheDocument()
    const fileSearchMenu = document.getElementById('file-search-menu')
    expect(fileSearchMenu).toHaveClass('min-w-0')
    expect(fileSearchMenu).not.toHaveClass('min-w-[480px]')
    expect(fileSearchMenu).not.toHaveTextContent('Navigate')
  })

  it('keeps the controls row below the input box so a multiline caret cannot render behind it', async () => {
    render(<ChatInput />)

    await waitFor(() => {
      expect(mocks.getGitInfo).toHaveBeenCalledWith(sessionId)
    })

    const input = screen.getByRole('textbox')
    const panel = screen.getByTestId('chat-input-panel')
    const controls = screen.getByTestId('chat-input-controls')

    expect(panel).toContainElement(input)
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Open composer tools' }))
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Run' }))
    expect(panel).not.toContainElement(controls)
    expect(controls).not.toHaveClass('absolute')
    expect(input).toHaveAttribute('rows', '1')
    expect(input).not.toHaveClass('pb-12')
  })

  it('replaces the composer with the provider card and keeps the draft', async () => {
    render(<ChatInput />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'unsent draft', selectionStart: 12 },
    })

    act(() => {
      useProviderStore.setState({ hasLoadedProviders: true, activeId: null, providers: [] })
    })

    expect(screen.getByTestId('provider-required-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-input-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-input-controls')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsTab).toBe('providers')

    act(() => {
      useProviderStore.setState({ activeId: 'provider-1' })
    })

    expect(screen.getByRole('textbox')).toHaveValue('unsent draft')
    act(() => {
      useProviderStore.setState(useProviderStore.getInitialState(), true)
      useUIStore.setState({ settingsOpen: false })
    })
  })

  it('prioritizes active-session slash commands by command name when filtering', async () => {
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          ...useChatStore.getState().sessions[sessionId]!,
          slashCommands: [
            {
              name: 'agent-team-orchestrator',
              description: 'Agent Teams can use Subagent orchestration.',
            },
            {
              name: 'lark-calendar',
              description: 'Includes suggestion helpers.',
            },
            {
              name: 'superpowers:brainstorming',
              description: 'Creative work planning.',
            },
          ],
        },
      },
    })

    render(<ChatInput />)

    await waitFor(() => {
      expect(mocks.getGitInfo).toHaveBeenCalledWith(sessionId)
    })

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '/su', selectionStart: 3 },
    })

    await waitFor(() => {
      const commandButtons = screen
        .getAllByRole('button')
        .filter((button) => button.textContent?.startsWith('/'))
      expect(commandButtons[0]).toHaveTextContent('/superpowers:brainstorming')
    })
  })
})
