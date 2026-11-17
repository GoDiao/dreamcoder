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
  createArtifact: vi.fn(),
  installSystem: vi.fn(),
}))

vi.mock('../../api/design', () => ({
  designApi: { createArtifact: mocks.createArtifact, installSystem: mocks.installSystem },
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

vi.mock('../shared/DirectoryPicker', () => ({
  DirectoryPicker: ({ onChange }: { onChange: (path: string) => void }) => (
    <button type="button" onClick={() => onChange('/other')}>Pick project</button>
  ),
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
import { artifactEditReference } from '../../lib/artifactEditReference'
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
    mocks.delete.mockResolvedValue({ ok: true, sideChatFailures: [] })
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

    const view = render(<ChatInput sessionId={sessionId} variant="hero" />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: { value: 'new tab draft', selectionStart: 13 },
    })
    expect(input.value).toBe('new tab draft')

    view.rerender(<ChatInput sessionId={historySessionId} variant="hero" />)

    await waitFor(() => {
      expect(input.value).toBe('')
    })

    fireEvent.change(input, {
      target: { value: 'history tab draft', selectionStart: 17 },
    })

    view.rerender(<ChatInput sessionId={sessionId} variant="hero" />)

    await waitFor(() => {
      expect(input.value).toBe('new tab draft')
    })

    view.rerender(<ChatInput sessionId={historySessionId} variant="hero" />)

    await waitFor(() => {
      expect(input.value).toBe('history tab draft')
    })
  })

  it('restores an unsent composer draft after the composer unmounts', async () => {
    const { unmount } = render(<ChatInput sessionId={sessionId} compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: { value: 'keep this prompt while I inspect another tab', selectionStart: 43 },
    })
    expect(input.value).toBe('keep this prompt while I inspect another tab')

    unmount()
    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} variant="hero" />)

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

  it('never offers new-session launch controls in a side chat whose history has not loaded yet', async () => {
    const sideId = 'side-loading'
    useChatStore.setState((state) => ({
      sessions: { ...state.sessions, [sideId]: { ...state.sessions[sessionId]!, messages: [] } },
    }))

    render(<ChatInput sessionId={sideId} variant="hero" primary={false} />)

    await waitFor(() => expect(mocks.getGitInfo).toHaveBeenCalledWith(sideId))
    expect(screen.queryByRole('button', { name: /Select branch/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Select a project...')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask Claude to edit, debug or explain...')
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

    render(<ChatInput sessionId={sessionId} variant="hero" />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} />)

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

    render(<ChatInput sessionId={sessionId} />)

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

    render(<ChatInput sessionId={sessionId} variant="hero" />)

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

    render(<ChatInput sessionId={sessionId} variant="hero" />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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
    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalled())
    const sent = mocks.wsSend.mock.calls[0]?.[1] as { content: string }
    expect(sent.content).not.toContain('stale')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('shows one chip for an artifact the user edited in the panel, tells the model to check it when sent and then drops the chip', async () => {
    useWorkspaceChatContextStore.getState().addReference(sessionId, artifactEditReference({ dir: '/repo/dc_artifacts/talk', title: 'Talk', files: ['artifact.json'], slides: true }))
    useWorkspaceChatContextStore.getState().addReference(sessionId, artifactEditReference({ dir: '/repo/dc_artifacts/talk', title: 'Talk', files: ['artifact.json'], slides: true }))
    render(<ChatInput sessionId={sessionId} compact />)
    expect(screen.getAllByText('Edited: Talk')).toHaveLength(1)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'continue' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalled())
    const sent = mocks.wsSend.mock.calls[0]?.[1] as { content: string; attachments: unknown[] }
    expect(sent.content).toContain('The user changed these artifacts in the app')
    expect(sent.content).toContain('/repo/dc_artifacts/talk')
    expect(sent.content.endsWith('continue')).toBe(true)
    expect(sent.attachments).toEqual([])
    expect(useWorkspaceChatContextStore.getState().referencesBySession[sessionId]).toEqual([])
    const messages = useChatStore.getState().sessions[sessionId]?.messages ?? []
    expect(messages[messages.length - 1]).toMatchObject({ type: 'user_text', content: 'continue', attachments: [{ type: 'artifact', name: 'Edited: Talk' }] })
  })

  it('says nothing about the artifact once its chip is removed', async () => {
    useWorkspaceChatContextStore.getState().addReference(sessionId, artifactEditReference({ dir: '/repo/dc_artifacts/talk', title: 'Talk', files: ['artifact.json'], slides: true }))
    render(<ChatInput sessionId={sessionId} compact />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Edited: Talk' }))
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'continue' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mocks.wsSend).toHaveBeenCalled())
    expect((mocks.wsSend.mock.calls[0]?.[1] as { content: string }).content).toBe('continue')
  })

  it('does not wait for the page when no element was picked', async () => {
    useWorkspaceChatContextStore.getState().addReference(sessionId, {
      kind: 'browser',
      path: 'https://example.com/a',
      name: 'Example',
      browser: { url: 'https://example.com/a', title: 'Example', text: 'quoted', truncated: false },
    })

    render(<ChatInput sessionId={sessionId} compact />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalled()
    expect(mocks.syncMarks).not.toHaveBeenCalled()
  })

  it('sends to the session it is given, not to the active tab', async () => {
    const sideId = 'side-session'
    useChatStore.setState((state) => ({
      sessions: { ...state.sessions, [sideId]: { ...state.sessions[sessionId]!, messages: [{ id: 'side', type: 'assistant_text', content: 'side', timestamp: 1 }] } },
    }))

    render(<ChatInput sessionId={sideId} compact primary={false} />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'side question' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.wsSend).toHaveBeenCalledWith(sideId, expect.objectContaining({ type: 'user_message', content: 'side question' }))
    expect(mocks.wsSend).not.toHaveBeenCalledWith(sessionId, expect.anything())
  })

  it('takes the focus in a side chat when asked to', () => {
    const sideId = 'side-focus'
    useChatStore.setState((state) => ({ sessions: { ...state.sessions, [sideId]: state.sessions[sessionId]! } }))
    render(
      <>
        <button type="button">elsewhere</button>
        <ChatInput sessionId={sideId} compact primary={false} autoFocus />
      </>,
    )

    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it.each([
    ['the main composer', true, true],
    ['a side chat composer', false, false],
  ] as const)('shows the tools menu and the controls row in %s: %s', (_name, primary, shown) => {
    render(<ChatInput sessionId={sessionId} compact primary={primary} />)

    expect(screen.queryByRole('button', { name: 'Open composer tools' }) !== null).toBe(shown)
    expect(screen.queryByTestId('chat-input-controls') !== null).toBe(shown)
  })

  it.each([
    ['the main composer', true, true],
    ['a side chat composer', false, false],
  ] as const)('takes dropped and pasted files in %s: %s', async (_name, primary, accepted) => {
    Object.defineProperty(window, 'dreamcoderShell', { configurable: true, value: {} })
    const droppedFile = new File(['log'], 'dropped.log', { type: 'text/plain' })
    Object.defineProperty(droppedFile, 'path', { configurable: true, value: '/tmp/dropped.log' })
    const dataTransfer = { types: ['Files'], files: [droppedFile], dropEffect: '' }
    const image = new File(['png'], 'shot.png', { type: 'image/png' })
    const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => image }
    render(<ChatInput sessionId={sessionId} compact primary={primary} />)

    const panel = screen.getByTestId('chat-input-panel')
    fireEvent.dragOver(panel, { dataTransfer })
    expect(screen.queryByTestId('chat-input-drop-overlay') !== null).toBe(accepted)
    fireEvent.drop(panel, { dataTransfer })
    const imagePasteKept = fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [imageItem] } })
    const textPasteKept = fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } })

    expect(imagePasteKept).toBe(!accepted)
    expect(textPasteKept).toBe(true)
    if (accepted) expect(await screen.findByText('dropped.log')).toBeInTheDocument()
    else {
      await act(async () => { await Promise.resolve() })
      expect(screen.queryByText('dropped.log')).not.toBeInTheDocument()
      expect(screen.queryByText(/pasted-image/)).not.toBeInTheDocument()
    }
  })

  it('leaves typing elsewhere on the page alone in a side chat', () => {
    const sideId = 'side-typing'
    useChatStore.setState((state) => ({ sessions: { ...state.sessions, [sideId]: state.sessions[sessionId]! } }))
    render(<ChatInput sessionId={sideId} compact primary={false} />)

    fireEvent.keyDown(document.body, { key: 'a' })

    expect(screen.getByRole('textbox')).not.toHaveFocus()
  })

  it('keeps focus where it is when a side chat starts or finishes a reply', () => {
    const sideId = 'side-running'
    useChatStore.setState((state) => ({ sessions: { ...state.sessions, [sideId]: state.sessions[sessionId]! } }))
    render(
      <>
        <button type="button">elsewhere</button>
        <ChatInput sessionId={sideId} compact primary={false} />
      </>,
    )
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' })
    elsewhere.focus()

    act(() => useChatStore.setState((state) => ({ sessions: { ...state.sessions, [sideId]: { ...state.sessions[sideId]!, chatState: 'streaming' } } })))
    expect(elsewhere).toHaveFocus()
    act(() => useChatStore.setState((state) => ({ sessions: { ...state.sessions, [sideId]: { ...state.sessions[sideId]!, chatState: 'idle' } } })))
    expect(elsewhere).toHaveFocus()
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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} compact />)

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

    render(<ChatInput sessionId={sessionId} />)

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
    expect(screen.getByTestId('chat-input-shell').className).toContain('pb-safe-2.5')
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
    render(<ChatInput sessionId={sessionId} />)

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
    render(<ChatInput sessionId={sessionId} />)

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

    render(<ChatInput sessionId={sessionId} />)

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

  describe('with a start from the Design or Slides page', () => {
    const grove = { command: '/slides' as const, template: { id: 'grove', title: 'Grove', project: '/repo' } }
    const lastMessage = () => useChatStore.getState().sessions[sessionId]?.messages.at(-1)

    beforeEach(() => {
      mocks.createArtifact.mockResolvedValue({ dir: '/repo/dc_artifacts/grove' })
      mocks.installSystem.mockResolvedValue({ dir: '/repo/dc_artifacts/systems/paper' })
    })

    it('shows the start as a chip with a question for it in an empty chat, and takes the focus', async () => {
      useSessionStore.setState({
        sessions: [{ ...useSessionStore.getState().sessions[0]!, messageCount: 0 }],
      })
      useChatStore.setState({ sessions: { [sessionId]: { ...useChatStore.getState().sessions[sessionId]!, messages: [] } } })
      useWorkspaceChatContextStore.getState().setStart(sessionId, grove)

      render(<ChatInput sessionId={sessionId} variant="hero" />)

      expect(screen.getByText('Slides · Grove')).toBeInTheDocument()
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'What is this deck about, and who is it for?')
      expect(input).toHaveFocus()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
      expect(mocks.wsSend).not.toHaveBeenCalled()
      expect(mocks.createArtifact).not.toHaveBeenCalled()
    })

    it('keeps the chip when picking another branch replaces the empty session, and sends it from the new one', async () => {
      mocks.create.mockResolvedValueOnce({ sessionId: 'created-direct', workDir: '/repo' })
      useSessionStore.setState({
        sessions: [{ ...useSessionStore.getState().sessions[0]!, messageCount: 0 }],
      })
      useChatStore.setState({ sessions: { [sessionId]: { ...useChatStore.getState().sessions[sessionId]!, messages: [] } } })
      useWorkspaceChatContextStore.getState().setStart(sessionId, grove)
      render(<ChatInput sessionId={sessionId} variant="hero" />)

      fireEvent.click(await screen.findByRole('button', { name: /Select branch: main/ }))
      fireEvent.click(await screen.findByRole('option', { name: /feature\/a/ }))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Q3 results', selectionStart: 10 } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(mocks.wsSend).toHaveBeenCalledWith('created-direct', expect.objectContaining({
        content: '/slides /repo/dc_artifacts/grove Q3 results',
        title: 'Q3 results',
      })))
      expect(useWorkspaceChatContextStore.getState().startsBySession['created-direct']).toBeUndefined()
    })

    it('carries the chip over when picking another folder replaces the empty session', async () => {
      mocks.create.mockResolvedValueOnce({ sessionId: 'created-elsewhere', workDir: '/other' })
      useSessionStore.setState({
        sessions: [{ ...useSessionStore.getState().sessions[0]!, messageCount: 0 }],
      })
      useChatStore.setState({ sessions: { [sessionId]: { ...useChatStore.getState().sessions[sessionId]!, messages: [] } } })
      useWorkspaceChatContextStore.getState().setStart(sessionId, grove)
      const { rerender } = render(<ChatInput sessionId={sessionId} variant="hero" />)

      fireEvent.click(await screen.findByRole('button', { name: 'Pick project' }))
      await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ workDir: '/other' })))
      rerender(<ChatInput sessionId="created-elsewhere" variant="hero" />)

      expect(useWorkspaceChatContextStore.getState().startsBySession['created-elsewhere']).toEqual(grove)
      expect(screen.getByText('Slides · Grove')).toBeInTheDocument()
    })

    it('asks a question that fits the design start and the clone', () => {
      useWorkspaceChatContextStore.getState().setStart(sessionId, { command: '/design' })
      const { unmount } = render(<ChatInput sessionId={sessionId} />)
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'What should this page do, and who is it for?')
      unmount()

      useWorkspaceChatContextStore.getState().setStart(sessionId, { command: '/design', cloneAddress: 'https://example.com/' })
      render(<ChatInput sessionId={sessionId} />)
      expect(screen.getByText('Clone example.com')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Anything to change in the copy?')
    })

    it('creates the artifact only when sent, and sends the same command as before when nothing was typed', async () => {
      useWorkspaceChatContextStore.getState().setStart(sessionId, grove)
      render(<ChatInput sessionId={sessionId} />)
      expect(mocks.createArtifact).not.toHaveBeenCalled()

      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

      await waitFor(() => expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, {
        type: 'user_message',
        id: expect.any(String),
        content: '/slides /repo/dc_artifacts/grove',
        attachments: [],
        title: 'Slides · Grove',
      }))
      expect(mocks.createArtifact).toHaveBeenCalledWith({ project: '/repo', templateId: 'grove', title: 'Grove' })
      expect(lastMessage()).toMatchObject({ type: 'user_text', content: '', attachments: [{ type: 'artifact', name: 'Slides · Grove' }] })
      expect(useWorkspaceChatContextStore.getState().startsBySession[sessionId]).toBeUndefined()
      expect(screen.queryByText('Slides · Grove')).not.toBeInTheDocument()
    })

    it('puts the command first and the typed words after it, and shows the chip and the words in the chat', async () => {
      useWorkspaceChatContextStore.getState().setStart(sessionId, grove)
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')

      fireEvent.change(input, { target: { value: 'Q3 results for the board' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, expect.objectContaining({
        content: '/slides /repo/dc_artifacts/grove Q3 results for the board',
        title: 'Q3 results for the board',
      })))
      expect(lastMessage()).toMatchObject({
        content: 'Q3 results for the board',
        modelContent: '/slides /repo/dc_artifacts/grove Q3 results for the board',
        attachments: [{ type: 'artifact', name: 'Slides · Grove' }],
      })
      expect(input).toHaveValue('')
    })

    it('starts each design entry the same way: from scratch, with a design system, and as a clone', async () => {
      useWorkspaceChatContextStore.getState().setStart(sessionId, { command: '/design', designSystem: { id: 'paper', name: 'Paper' } })
      render(<ChatInput sessionId={sessionId} />)
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
      await waitFor(() => expect(mocks.wsSend).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ content: '/design /repo/dc_artifacts/systems/paper' })))
      expect(mocks.installSystem).toHaveBeenCalledWith(sessionId, 'paper')

      act(() => useWorkspaceChatContextStore.getState().setStart(sessionId, { command: '/design', cloneAddress: 'https://example.com/' }))
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
      await waitFor(() => expect(mocks.wsSend).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ content: '/design Clone a website https://example.com/' })))

      act(() => useWorkspaceChatContextStore.getState().setStart(sessionId, { command: '/design' }))
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
      await waitFor(() => expect(mocks.wsSend).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ content: '/design', title: 'Design' })))
    })

    it('keeps the chip and the typed words when the artifact could not be created, so the user can send again', async () => {
      mocks.createArtifact.mockRejectedValueOnce(new Error('disk full'))
      useWorkspaceChatContextStore.getState().setStart(sessionId, grove)
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Q3 results' } })

      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('disk full'))
      expect(mocks.wsSend).not.toHaveBeenCalled()
      expect(input).toHaveValue('Q3 results')
      expect(screen.getByText('Slides · Grove')).toBeInTheDocument()

      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, expect.objectContaining({ content: '/slides /repo/dc_artifacts/grove Q3 results' })))
    })

    it('sends a plain message once the chip is removed', async () => {
      useWorkspaceChatContextStore.getState().setStart(sessionId, grove)
      render(<ChatInput sessionId={sessionId} />)

      fireEvent.click(screen.getByRole('button', { name: 'Remove Slides · Grove' }))
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask Claude to edit, debug or explain...')
      expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'hello' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, { type: 'user_message', id: expect.any(String), content: 'hello', attachments: [] })
      expect(mocks.createArtifact).not.toHaveBeenCalled()
      expect(useWorkspaceChatContextStore.getState().startsBySession[sessionId]).toBeUndefined()
    })
  })

  describe('typing /slides or /design', () => {
    const startOf = () => useWorkspaceChatContextStore.getState().startsBySession[sessionId]

    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn()
      useChatStore.setState({
        sessions: {
          [sessionId]: {
            ...useChatStore.getState().sessions[sessionId]!,
            slashCommands: [
              { name: 'slides', description: 'Make a slide deck' },
              { name: 'design', description: 'Design a page' },
            ],
          },
        },
      })
    })

    const expectChip = (input: HTMLElement, name: string, value: string, placeholder: string) => {
      expect(screen.getByText(name)).toBeInTheDocument()
      expect(input).toHaveValue(value)
      expect(input).toHaveAttribute('placeholder', placeholder)
      expect(input).toHaveFocus()
      expect(mocks.wsSend).not.toHaveBeenCalled()
    }

    it('turns the command picked with the mouse in the slash menu into a chip', async () => {
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '/sli', selectionStart: 4 } })

      fireEvent.click(await screen.findByRole('button', { name: /\/slides/ }))

      expectChip(input, 'Slides', '', 'What is this deck about, and who is it for?')
      expect(startOf()).toEqual({ command: '/slides' })
    })

    it('turns the command picked with Tab or Enter in the slash menu into a chip', async () => {
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '/desi', selectionStart: 5 } })
      await screen.findByRole('button', { name: /\/design/ })
      fireEvent.keyDown(input, { key: 'Tab' })
      expectChip(input, 'Design', '', 'What should this page do, and who is it for?')
      await act(() => new Promise(requestAnimationFrame))

      fireEvent.change(input, { target: { value: '/sli', selectionStart: 4 } })
      await screen.findByRole('button', { name: /\/slides/ })
      fireEvent.keyDown(input, { key: 'Enter' })
      expectChip(input, 'Slides', '', 'What is this deck about, and who is it for?')
    })

    it('turns a whole command followed by Enter into a chip instead of sending it', async () => {
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '/slides', selectionStart: 7 } })
      await screen.findByRole('button', { name: /\/slides/ })

      fireEvent.keyDown(input, { key: 'Enter' })

      expectChip(input, 'Slides', '', 'What is this deck about, and who is it for?')
    })

    it('turns a whole command and Enter into a chip even when the list does not have it, instead of picking a similar command', async () => {
      useChatStore.setState({
        sessions: {
          [sessionId]: {
            ...useChatStore.getState().sessions[sessionId]!,
            slashCommands: [{ name: 'design-interview', description: 'Interview about a design' }],
          },
        },
      })
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '/design', selectionStart: 7 } })
      await screen.findByRole('button', { name: /\/design-interview/ })

      fireEvent.keyDown(input, { key: 'Enter' })

      expectChip(input, 'Design', '', 'What should this page do, and who is it for?')
      expect(input).not.toHaveValue('/design-interview ')
    })

    it('turns the command into a chip at the space after it and keeps what follows as the words', async () => {
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')

      fireEvent.change(input, { target: { value: '/slides ', selectionStart: 8 } })
      expectChip(input, 'Slides', '', 'What is this deck about, and who is it for?')

      fireEvent.change(input, { target: { value: 'Q3 results', selectionStart: 10 } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, expect.objectContaining({ content: '/slides Q3 results', title: 'Q3 results' })))
      expect(useChatStore.getState().sessions[sessionId]?.messages.at(-1)).toMatchObject({
        content: 'Q3 results',
        attachments: [{ type: 'artifact', name: 'Slides' }],
      })
    })

    it('turns pasted text that starts with the command into a chip and the words', () => {
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')

      fireEvent.paste(input, { clipboardData: { items: [], getData: () => '/design' } })
      fireEvent.change(input, { target: { value: '/design', selectionStart: 7 } })
      expectChip(input, 'Design', '', 'What should this page do, and who is it for?')

      act(() => useWorkspaceChatContextStore.getState().clearStart(sessionId))
      fireEvent.paste(input, { clipboardData: { items: [], getData: () => '/slides about the launch' } })
      fireEvent.change(input, { target: { value: '/slides about the launch', selectionStart: 24 } })
      expectChip(input, 'Slides', 'about the launch', 'What is this deck about, and who is it for?')
    })

    it('replaces a chip that is already there', () => {
      useWorkspaceChatContextStore.getState().setStart(sessionId, { command: '/slides', template: { id: 'grove', title: 'Grove', project: '/repo' } })
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')

      fireEvent.change(input, { target: { value: '/design ', selectionStart: 8 } })

      expect(screen.queryByText('Slides · Grove')).not.toBeInTheDocument()
      expectChip(input, 'Design', '', 'What should this page do, and who is it for?')
      expect(startOf()).toEqual({ command: '/design' })
    })

    it('leaves other slash commands as they were', async () => {
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '/review', selectionStart: 7 } })
      await screen.findByRole('button', { name: /\/review/ })

      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, { type: 'user_message', id: expect.any(String), content: '/review', attachments: [] })
      expect(startOf()).toBeUndefined()
    })

    it('works while a turn is running and sends the chip as a command, not as a queued message', async () => {
      useChatStore.setState({ sessions: { [sessionId]: { ...useChatStore.getState().sessions[sessionId]!, chatState: 'streaming' } } })
      render(<ChatInput sessionId={sessionId} />)
      const input = screen.getByRole('textbox')

      fireEvent.change(input, { target: { value: '/slides Q3 results', selectionStart: 18 } })
      expect(screen.getByText('Slides')).toBeInTheDocument()
      expect(input).toHaveValue('Q3 results')
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(mocks.wsSend).toHaveBeenCalledWith(sessionId, expect.objectContaining({ content: '/slides Q3 results', title: 'Q3 results' })))
      expect(useChatStore.getState().sessions[sessionId]?.messages.at(-1)).toMatchObject({ type: 'user_text', content: 'Q3 results' })
    })
  })
})
