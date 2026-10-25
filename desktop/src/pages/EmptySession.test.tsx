import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  getRepositoryContext: vi.fn(),
  getTranscript: vi.fn(),
  getSlashCommands: vi.fn(),
  listSkills: vi.fn(),
  search: vi.fn(),
  browse: vi.fn(),
  getTasksForList: vi.fn(),
  resetTaskList: vi.fn(),
  wsClearHandlers: vi.fn(),
  wsConnect: vi.fn(),
  wsOnMessage: vi.fn(),
  wsSend: vi.fn(),
  wsDisconnect: vi.fn(),
  dialogOpen: vi.fn(),
  isMobile: false,
  isDesktopRuntime: false,
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    create: mocks.createSession,
    list: mocks.listSessions,
    getRepositoryContext: mocks.getRepositoryContext,
    getTranscript: mocks.getTranscript,
    getSlashCommands: mocks.getSlashCommands,
  },
}))

vi.mock('../api/skills', () => ({
  skillsApi: {
    list: mocks.listSkills,
  },
}))

vi.mock('../api/filesystem', () => ({
  filesystemApi: {
    search: mocks.search,
    browse: mocks.browse,
  },
}))

vi.mock('../api/cliTasks', () => ({
  cliTasksApi: {
    getTasksForList: mocks.getTasksForList,
    resetTaskList: mocks.resetTaskList,
  },
}))

vi.mock('../api/websocket', () => ({
  wsManager: {
    clearHandlers: mocks.wsClearHandlers,
    connect: mocks.wsConnect,
    onMessage: mocks.wsOnMessage,
    send: mocks.wsSend,
    disconnect: mocks.wsDisconnect,
  },
}))

vi.mock('../hooks/useMobileViewport', () => ({
  useMobileViewport: () => mocks.isMobile,
}))

vi.mock('../lib/desktopRuntime', () => ({
  isDesktopRuntime: () => mocks.isDesktopRuntime,
}))

vi.mock('../lib/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/shell')>()),
  pickFiles: mocks.dialogOpen,
  getFilePath: (file: File) => (file as File & { path?: string }).path,
}))

vi.mock('../components/shared/DirectoryPicker', () => ({
  DirectoryPicker: ({ value, onChange }: { value: string; onChange: (path: string) => void }) => (
    <button type="button" aria-label="Pick project" data-value={value} onClick={() => onChange('/workspace/project')}>
      Pick project
    </button>
  ),
}))

vi.mock('../components/controls/PermissionModeSelector', () => ({
  PermissionModeSelector: ({ compact, value, onChange }: { compact?: boolean; value: string; onChange: (mode: string) => void }) => (
    <button
      type="button"
      data-testid="permission-mode-selector"
      data-compact={compact ? 'true' : 'false'}
      data-value={value}
      onClick={() => onChange('plan')}
    >
      Bypass
    </button>
  ),
}))

vi.mock('../components/controls/ModelSelector', () => ({
  ModelSelector: ({ compact }: { compact?: boolean }) => (
    <button type="button" data-testid="model-selector" data-compact={compact ? 'true' : 'false'}>
      Model
    </button>
  ),
}))

import { EmptySession } from './EmptySession'
import { ApiError } from '../api/client'
import { useChatStore } from '../stores/chatStore'
import { useSessionRuntimeStore } from '../stores/sessionRuntimeStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { usePluginStore } from '../stores/pluginStore'
import { useProviderStore } from '../stores/providerStore'
import type { RepositoryContextResult } from '../api/sessions'

function okRepositoryContext(overrides: Partial<RepositoryContextResult> = {}): RepositoryContextResult {
  return {
    state: 'ok',
    workDir: '/workspace/project',
    repoRoot: '/workspace/project',
    repoName: 'project',
    currentBranch: 'main',
    defaultBranch: 'main',
    dirty: false,
    branches: [{
      name: 'main',
      current: true,
      local: true,
      remote: false,
      checkedOut: true,
      worktreePath: '/workspace/project',
    }],
    worktrees: [{
      path: '/workspace/project',
      branch: 'main',
      current: true,
    }],
    ...overrides,
  }
}

function notGitRepositoryContext(): RepositoryContextResult {
  return {
    state: 'not_git_repo',
    workDir: '/workspace/project',
    repoRoot: null,
    repoName: null,
    currentBranch: null,
    defaultBranch: null,
    dirty: false,
    branches: [],
    worktrees: [],
  }
}

describe('EmptySession', () => {
  const initialSessionState = useSessionStore.getInitialState()
  const initialChatState = useChatStore.getInitialState()
  const initialTabState = useTabStore.getInitialState()
  const initialRuntimeState = useSessionRuntimeStore.getInitialState()
  const initialUiState = useUIStore.getInitialState()
  const initialPluginState = usePluginStore.getInitialState()
  const initialProviderState = useProviderStore.getInitialState()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isMobile = false
    mocks.isDesktopRuntime = false
    useSettingsStore.setState({ locale: 'en', activeProviderName: null })
    useSessionStore.setState(initialSessionState, true)
    useChatStore.setState(initialChatState, true)
    useTabStore.setState(initialTabState, true)
    useSessionRuntimeStore.setState(initialRuntimeState, true)
    useUIStore.setState(initialUiState, true)
    usePluginStore.setState(initialPluginState, true)
    useProviderStore.setState(initialProviderState, true)

    mocks.createSession.mockResolvedValue({ sessionId: 'draft-session' })
    mocks.getRepositoryContext.mockResolvedValue(okRepositoryContext())
    mocks.listSessions.mockResolvedValue({
      sessions: [{
        id: 'draft-session',
        title: 'New Session',
        createdAt: '2026-05-01T00:00:00.000Z',
        modifiedAt: '2026-05-01T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      total: 1,
    })
    mocks.getTranscript.mockResolvedValue({ items: [], agentNotifications: {}, lastTodos: null, hasMessagesAfterTaskCompletion: false })
    mocks.getSlashCommands.mockResolvedValue({ commands: [] })
    mocks.listSkills.mockResolvedValue({ skills: [] })
    mocks.search.mockResolvedValue({
      currentPath: '/workspace/project',
      parentPath: null,
      query: '',
      entries: [],
    })
    mocks.getTasksForList.mockResolvedValue({ tasks: [] })
    mocks.resetTaskList.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    useSessionStore.setState(initialSessionState, true)
    useChatStore.setState(initialChatState, true)
    useTabStore.setState(initialTabState, true)
    useSessionRuntimeStore.setState(initialRuntimeState, true)
    useUIStore.setState(initialUiState, true)
    usePluginStore.setState(initialPluginState, true)
    useProviderStore.setState(initialProviderState, true)
  })

  it('points to provider settings when no provider is configured', async () => {
    useProviderStore.setState({ hasLoadedProviders: true, providers: [] })

    render(<EmptySession />)

    const card = await screen.findByTestId('empty-session-no-provider')
    expect(card).toHaveTextContent('Add a model provider to start chatting')
    expect(screen.queryByTestId('empty-session-composer-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('empty-session-controls')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsTab).toBe('providers')
  })

  it('asks to choose a default provider when providers exist without one', async () => {
    useProviderStore.setState({
      hasLoadedProviders: true,
      activeId: null,
      providers: [{
        id: 'provider-1',
        presetId: 'deepseek',
        name: 'DeepSeek',
        apiKey: 'key',
        baseUrl: 'https://example.invalid',
        apiFormat: 'anthropic',
        models: [{ id: 'm' }],
      }],
    })

    render(<EmptySession />)

    const card = await screen.findByTestId('empty-session-no-provider')
    expect(card).toHaveTextContent('Choose a default provider to start chatting')
    fireEvent.click(screen.getByRole('button', { name: 'Choose provider' }))
    expect(useUIStore.getState().settingsTab).toBe('providers')
  })

  it('keeps the draft when the provider card gives way to the composer', () => {
    useProviderStore.setState({ hasLoadedProviders: false, providers: [] })
    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'unsent draft', selectionStart: 12 },
    })

    act(() => {
      useProviderStore.setState({ hasLoadedProviders: true, activeId: null, providers: [] })
    })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    act(() => {
      useProviderStore.setState({
        activeId: 'provider-1',
        providers: [{
          id: 'provider-1',
          presetId: 'deepseek',
          name: 'DeepSeek',
          apiKey: 'key',
          baseUrl: 'https://example.invalid',
          apiFormat: 'anthropic',
          models: [{ id: 'm' }],
        }],
      })
    })
    expect(screen.getByRole('textbox')).toHaveValue('unsent draft')
  })

  it('hides the provider hint until providers load and once one exists', () => {
    useProviderStore.setState({ hasLoadedProviders: false, providers: [] })
    const { rerender } = render(<EmptySession />)
    expect(screen.queryByTestId('empty-session-no-provider')).not.toBeInTheDocument()

    act(() => {
      useProviderStore.setState({
        hasLoadedProviders: true,
        activeId: 'provider-1',
        providers: [{
          id: 'provider-1',
          presetId: 'deepseek',
          name: 'DeepSeek',
          apiKey: 'key',
          baseUrl: 'https://example.invalid',
          apiFormat: 'anthropic',
          models: [{ id: 'm' }],
        }],
      })
    })
    rerender(<EmptySession />)
    expect(screen.queryByTestId('empty-session-no-provider')).not.toBeInTheDocument()
  })

  it('uses compact composer controls on phone-sized H5 browsers', async () => {
    mocks.isMobile = true

    render(<EmptySession />)

    await waitFor(() => {
      expect(screen.getByTestId('permission-mode-selector')).toHaveAttribute('data-compact', 'true')
    })
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-compact', 'true')
    expect(screen.getByRole('button', { name: 'Run' })).toHaveClass('h-11', 'w-11')
    expect(screen.getByTestId('empty-session-composer-shell')).toHaveClass('px-3')
    expect(screen.getByTestId('empty-session-composer-panel')).toHaveClass('rounded-2xl')
  })

  it('refreshes empty-session slash commands after plugin reloads', async () => {
    mocks.listSkills
      .mockResolvedValueOnce({ skills: [] })
      .mockResolvedValueOnce({
        skills: [
          {
            name: 'draw:render',
            description: 'Render with the drawing plugin.',
            userInvocable: true,
          },
        ],
      })

    render(<EmptySession />)

    await waitFor(() => {
      expect(mocks.listSkills).toHaveBeenCalledTimes(1)
    })

    act(() => {
      usePluginStore.setState({
        lastReloadSummary: {
          enabled: 1,
          disabled: 0,
          skills: 1,
          agents: 0,
          hooks: 0,
          mcpServers: 0,
          lspServers: 0,
          errors: 0,
        },
      })
    })

    await waitFor(() => {
      expect(mocks.listSkills).toHaveBeenCalledTimes(2)
    })
  })

  it('prioritizes enabled plugin slash commands by command name when filtering', async () => {
    mocks.listSkills.mockResolvedValueOnce({
      skills: [
        {
          name: 'agent-team-orchestrator',
          description: 'Agent Teams can use Subagent orchestration.',
          userInvocable: true,
        },
        {
          name: 'lark-calendar',
          description: 'Includes suggestion helpers.',
          userInvocable: true,
        },
        {
          name: 'superpowers:brainstorming',
          description: 'Creative work planning.',
          userInvocable: true,
        },
      ],
    })

    render(<EmptySession />)

    await waitFor(() => {
      expect(mocks.listSkills).toHaveBeenCalledTimes(1)
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

  it('integrates repository launch controls into the desktop composer panel', async () => {
    render(<EmptySession />)

    const panel = screen.getByTestId('empty-session-composer-panel')
    expect(panel).toHaveClass('rounded-2xl')
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '1')

    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    const branchButton = await screen.findByRole('button', { name: 'Select branch: main' })
    const launchBar = branchButton.parentElement
    expect(launchBar).toBeTruthy()
    expect(launchBar).toHaveClass('bg-transparent')
    expect(launchBar).not.toHaveClass('rounded-b-xl')
    expect(panel).not.toContainElement(launchBar)
    expect(screen.getByTestId('empty-session-controls')).toContainElement(launchBar)
    expect(screen.getByTestId('empty-session-controls')).toContainElement(screen.getByTestId('permission-mode-selector'))
  })

  it('creates a session with the selected project and branch when submitted', async () => {
    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    expect(mocks.createSession).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument()
    })

    const runButton = screen.getByRole('button', { name: /Run/i })
    await waitFor(() => {
      expect(runButton).not.toBeDisabled()
    })

    fireEvent.click(runButton)

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({
        workDir: '/workspace/project',
        repository: { branch: 'main', worktree: false },
        permissionMode: 'default',
      })
    })

    expect(useTabStore.getState().activeTabId).toBe('draft-session')
    expect(useTabStore.getState().tabs).toEqual([
      { sessionId: 'draft-session', title: 'draft question', type: 'session', status: 'idle' },
    ])
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'draft-session',
      workDir: '/workspace/project',
    })
    const messages = useChatStore.getState().sessions['draft-session']?.messages ?? []
    expect(messages[messages.length - 1]).toMatchObject({
      type: 'user_text',
      content: 'draft question',
    })
    expect(mocks.wsSend).toHaveBeenCalledWith('draft-session', {
      type: 'user_message',
      id: expect.any(String),
      content: 'draft question',
      attachments: [],
    })
    expect(mocks.wsConnect).toHaveBeenCalledWith('draft-session')
    expect(useSessionRuntimeStore.getState().selections['draft-session']).toBeUndefined()
  })

  it('creates the session in the mode picked for it, without changing the default for new sessions', async () => {
    const setDefault = vi.fn(async () => {})
    const { permissionMode, setPermissionMode } = useSettingsStore.getState()
    useSettingsStore.setState({ permissionMode: 'acceptEdits', setPermissionMode: setDefault })

    render(<EmptySession />)

    const selector = screen.getByTestId('permission-mode-selector')
    expect(selector).toHaveAttribute('data-value', 'acceptEdits')
    fireEvent.click(selector)
    expect(selector).toHaveAttribute('data-value', 'plan')
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({ permissionMode: 'plan' })
    })
    expect(setDefault).not.toHaveBeenCalled()
    useSettingsStore.setState({ permissionMode, setPermissionMode })
  })

  it('creates the session with the draft runtime only when the user explicitly selected one', async () => {
    useSessionRuntimeStore.getState().setSelection('__draft__', {
      providerId: 'provider-explicit',
      modelId: 'model-explicit',
    })

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })

    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({
        permissionMode: 'default',
        runtime: { providerId: 'provider-explicit', modelId: 'model-explicit' },
      })
    })

    expect(useSessionRuntimeStore.getState().selections).toEqual({})
    expect(mocks.wsSend).not.toHaveBeenCalledWith('draft-session', expect.objectContaining({ type: 'set_runtime_config' }))
  })

  it('uses native desktop file paths for draft attachments', async () => {
    mocks.isDesktopRuntime = true
    mocks.dialogOpen.mockResolvedValueOnce([
      'C:\\Users\\Nanmi\\Desktop\\huge-a.log',
      '/Users/nanmi/tmp/huge-b.zip',
    ])

    render(<EmptySession />)

    fireEvent.click(screen.getByLabelText('Open composer tools'))
    fireEvent.click(screen.getByText('Add files or photos'))

    expect(await screen.findByText('huge-a.log')).toBeInTheDocument()
    expect(await screen.findByText('huge-b.zip')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'check these files', selectionStart: 'check these files'.length },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({ permissionMode: 'default' })
    })
    expect(mocks.wsSend).toHaveBeenCalledWith('draft-session', {
      type: 'user_message',
      id: expect.any(String),
      content: 'check these files',
      attachments: [
        expect.objectContaining({
          type: 'file',
          name: 'huge-a.log',
          path: 'C:\\Users\\Nanmi\\Desktop\\huge-a.log',
          data: undefined,
        }),
        expect.objectContaining({
          type: 'file',
          name: 'huge-b.zip',
          path: '/Users/nanmi/tmp/huge-b.zip',
          data: undefined,
        }),
      ],
    })
  })

  it('shows a drop affordance and sends dropped desktop files as path attachments', async () => {
    mocks.isDesktopRuntime = true
    const droppedFile = new File(['large file'], 'ignored-name.log', { type: 'text/plain' })
    Object.defineProperty(droppedFile, 'path', {
      configurable: true,
      value: '/Users/nanmi/drop/session-context.log',
    })
    const dataTransfer = {
      types: ['Files'],
      files: [droppedFile],
      dropEffect: '',
    }

    render(<EmptySession />)

    const panel = screen.getByTestId('empty-session-composer-panel')
    fireEvent.dragEnter(panel, { dataTransfer })
    expect(screen.getByTestId('empty-session-drop-overlay')).toBeInTheDocument()

    fireEvent.drop(panel, { dataTransfer })

    expect(await screen.findByText('session-context.log')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-session-drop-overlay')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'use this context', selectionStart: 'use this context'.length },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({ permissionMode: 'default' })
    })
    expect(mocks.wsSend).toHaveBeenCalledWith('draft-session', {
      type: 'user_message',
      id: expect.any(String),
      content: 'use this context',
      attachments: [
        expect.objectContaining({
          type: 'file',
          name: 'session-context.log',
          path: '/Users/nanmi/drop/session-context.log',
          data: undefined,
        }),
      ],
    })
  })

  it('keeps slash and @ popovers visible above the empty-session drop target', async () => {
    mocks.search.mockResolvedValueOnce({
      currentPath: '/workspace/project',
      parentPath: null,
      query: '',
      entries: [
        { name: 'README.md', path: '/workspace/project/README.md', isDirectory: false },
      ],
    })

    render(<EmptySession />)

    const panel = screen.getByTestId('empty-session-composer-panel')
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

  it('starts in a selected non-Git project without showing a repository warning', async () => {
    mocks.getRepositoryContext.mockResolvedValueOnce(notGitRepositoryContext())

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Run/i })).not.toBeDisabled()
    })

    expect(screen.queryByText('Current project is not a Git repository.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Select branch:/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Run in a new worktree')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({
        workDir: '/workspace/project',
        permissionMode: 'default',
      })
    })
  })

  it('shows an actionable repository error when direct branch switching is blocked', async () => {
    mocks.createSession.mockRejectedValueOnce(new ApiError(400, {
      error: 'REPOSITORY_DIRTY_WORKTREE',
      message: 'Working tree has uncommitted changes.',
    }))

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    const notice = await screen.findByTestId('repo-launch-notice-launch-dirty')
    expect(notice).toHaveTextContent(
      'Current project has uncommitted changes. Direct branch switching was blocked; turn on "Run in a new worktree" in the branch menu, or commit/stash your changes first.',
    )
    expect(screen.getByRole('button', { name: 'Use a new worktree' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('draft question')
    expect(useTabStore.getState().activeTabId).toBeNull()
  })

  it('keeps Run disabled until repository context resolves for a selected project', async () => {
    let resolveContext: (context: RepositoryContextResult) => void = () => {}
    mocks.getRepositoryContext.mockImplementationOnce(() => new Promise<RepositoryContextResult>((resolve) => {
      resolveContext = resolve
    }))

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Run/i })).toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Run/i }))
    expect(mocks.createSession).not.toHaveBeenCalled()

    resolveContext(okRepositoryContext())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Run/i })).not.toBeDisabled()
    })
  })

  it('falls back to a visible branch when the current branch is an internal desktop worktree branch', async () => {
    mocks.getRepositoryContext.mockResolvedValueOnce(okRepositoryContext({
      currentBranch: 'worktree-desktop-feature-a-12345678',
      defaultBranch: 'main',
      branches: [
        {
          name: 'main',
          current: false,
          local: true,
          remote: false,
          checkedOut: false,
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
        path: '/workspace/project/.claude/worktrees/desktop-feature-a-12345678',
        branch: 'worktree-desktop-feature-a-12345678',
        current: true,
      }],
    }))

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument()
    })

    expect(screen.queryByText('worktree-desktop-feature-a-12345678')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({
        workDir: '/workspace/project',
        repository: { branch: 'main', worktree: false },
        permissionMode: 'default',
      })
    })
  })

  it('keeps the repository launch context on one row and truncates long branch names', async () => {
    const longBranch = 'feature/super-long-branch-name-for-repository-launch-controls-e2e'
    mocks.getRepositoryContext.mockResolvedValueOnce(okRepositoryContext({
      currentBranch: longBranch,
      defaultBranch: 'main',
      branches: [{
        name: longBranch,
        current: true,
        local: true,
        remote: false,
        checkedOut: true,
        worktreePath: '/workspace/project',
      }],
      worktrees: [{
        path: '/workspace/project',
        branch: longBranch,
        current: true,
      }],
    }))

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    const branchButton = await screen.findByRole('button', { name: new RegExp(`Select branch: ${longBranch}`) })
    const branchClasses = branchButton.className.split(/\s+/)
    expect(branchButton.parentElement?.className).toContain('flex-nowrap')
    expect(branchButton.parentElement?.className).not.toContain('flex-wrap')
    expect(branchClasses).toContain('max-w-[200px]')
    expect(branchClasses).not.toContain('max-w-full')
    expect(branchButton.querySelector('span')?.className).toContain('truncate')
  })

  it('keeps current worktree selectable when the fallback branch is checked out elsewhere', async () => {
    mocks.getRepositoryContext.mockResolvedValueOnce(okRepositoryContext({
      currentBranch: null,
      defaultBranch: 'main',
      branches: [
        {
          name: 'main',
          current: false,
          local: true,
          remote: false,
          checkedOut: true,
          worktreePath: '/workspace/project',
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
        path: '/workspace/project/.codex/worktrees/detached/project',
        branch: null,
        current: true,
      }],
    }))

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft question', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick project' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select branch: main' })).toBeInTheDocument()
    })

    expect(screen.getByText('Selected branch is already checked out in another worktree. Direct launch may be blocked by Git; run in a new worktree to avoid changing directories.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select branch: main' }))
    const worktreeSwitch = await screen.findByRole('switch', { name: 'Run in a new worktree' })
    expect(worktreeSwitch).not.toBeDisabled()
    expect(worktreeSwitch).toHaveAttribute('aria-checked', 'false')
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({
        workDir: '/workspace/project',
        repository: { branch: 'main', worktree: false },
        permissionMode: 'default',
      })
    })
  })
})
