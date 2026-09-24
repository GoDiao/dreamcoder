import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { branchMock, createMock, listMock, deleteMock, batchDeleteMock } = vi.hoisted(() => ({
  branchMock: vi.fn(),
  createMock: vi.fn(),
  listMock: vi.fn(),
  deleteMock: vi.fn(),
  batchDeleteMock: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    branch: branchMock,
    create: createMock,
    list: listMock,
    delete: deleteMock,
    batchDelete: batchDeleteMock,
    rename: vi.fn(),
  },
}))

import { useSessionStore } from './sessionStore'
import { useTabStore } from './tabStore'
import type { SessionListItem } from '../types/session'

const initialState = useSessionStore.getState()

function session(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id,
    title: `Session ${id}`,
    createdAt: '2026-05-01T00:00:00.000Z',
    modifiedAt: '2026-05-01T00:00:00.000Z',
    messageCount: 2,
    projectPath: '/workspace/project',
    projectRoot: '/workspace/project',
    workDir: '/workspace/project',
    workDirExists: true,
    ...overrides,
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('sessionStore', () => {
  beforeEach(() => {
    branchMock.mockReset()
    createMock.mockReset()
    listMock.mockReset()
    deleteMock.mockReset()
    batchDeleteMock.mockReset()
    useSessionStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  afterEach(() => {
    useSessionStore.setState(initialState)
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('returns a new session id before the background refresh completes', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-optimistic-1' })
    listMock.mockImplementation(() => new Promise(() => {}))

    const result = await Promise.race([
      useSessionStore.getState().createSession('D:/workspace/code/myself_code/dreamcoder'),
      delay(100).then(() => 'timed-out'),
    ])

    expect(result).toBe('session-optimistic-1')
    expect(useSessionStore.getState().activeSessionId).toBe('session-optimistic-1')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-optimistic-1',
      title: 'New Session',
      workDir: 'D:/workspace/code/myself_code/dreamcoder',
      workDirExists: true,
    })
    expect(createMock).toHaveBeenCalledWith({
      workDir: 'D:/workspace/code/myself_code/dreamcoder',
    })
    expect(listMock).toHaveBeenCalledOnce()
  })

  it('keeps an optimistic local title when a background refresh still returns a placeholder', async () => {
    const refresh = createDeferred<{
      sessions: Array<{
        id: string
        title: string
        createdAt: string
        modifiedAt: string
        messageCount: number
        projectPath: string
        workDir: string | null
        workDirExists: boolean
      }>
      total: number
    }>()
    createMock.mockResolvedValue({ sessionId: 'session-title-1', workDir: '/workspace/project' })
    listMock.mockReturnValue(refresh.promise)

    await useSessionStore.getState().createSession('/workspace/project')
    useSessionStore.getState().updateSessionTitle('session-title-1', '开始优化UI')

    refresh.resolve({
      sessions: [{
        id: 'session-title-1',
        title: 'Untitled Session',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: '2026-05-07T00:00:01.000Z',
        messageCount: 0,
        projectPath: '',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      total: 1,
    })
    await refresh.promise
    await delay(0)

    expect(useSessionStore.getState().sessions[0]?.title).toBe('开始优化UI')
  })

  it('syncs refreshed session titles into already-open tabs', async () => {
    useTabStore.getState().openTab('session-title-2', '```json {"title":')
    listMock.mockResolvedValue({
      sessions: [{
        id: 'session-title-2',
        title: '使用bash写一个shell，随便写点什么东西',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: '2026-05-07T00:00:01.000Z',
        messageCount: 3,
        projectPath: '',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      total: 1,
    })

    await useSessionStore.getState().fetchSessions()

    expect(useTabStore.getState().tabs[0]?.title).toBe('使用bash写一个shell，随便写点什么东西')
  })

  it('keeps an open older session and its workspace metadata when refreshing the first page', async () => {
    const recentSessions = Array.from({ length: 100 }, (_, index) => session(`recent-${index}`))
    const olderSession = session('older-open', {
      title: 'Older searchable conversation',
      workDir: '/workspace/older-project',
      projectRoot: '/workspace/older-project',
    })
    useSessionStore.setState({ sessions: [...recentSessions, olderSession, session('older-closed')] })
    useTabStore.getState().openTab(olderSession.id, olderSession.title)
    listMock.mockResolvedValue({ sessions: recentSessions, total: 102 })

    await useSessionStore.getState().fetchSessions()

    expect(listMock).toHaveBeenCalledWith({ project: undefined, limit: 100 })
    expect(useSessionStore.getState().sessions).toHaveLength(101)
    expect(useSessionStore.getState().sessions.find((item) => item.id === olderSession.id))
      .toEqual(olderSession)
    expect(useSessionStore.getState().sessions.some((item) => item.id === 'older-closed')).toBe(false)
  })

  it('prefers refreshed server metadata over a retained open session without duplicating it', async () => {
    const oldSession = session('open', { title: 'Previous title', workDir: '/workspace/old' })
    const refreshedSession = session('open', {
      title: 'Current title',
      modifiedAt: '2026-05-02T00:00:00.000Z',
      workDir: '/workspace/current',
      messageCount: 12,
    })
    useSessionStore.setState({ sessions: [oldSession] })
    useTabStore.getState().openTab(oldSession.id, oldSession.title)
    listMock.mockResolvedValue({ sessions: [refreshedSession], total: 1 })

    await useSessionStore.getState().fetchSessions()

    expect(useSessionStore.getState().sessions).toEqual([refreshedSession])
    expect(useTabStore.getState().tabs[0]?.title).toBe('Current title')
  })

  it('does not retain open sessions outside an explicitly filtered project list', async () => {
    const otherSession = session('other-project', { workDir: '/workspace/other' })
    const matchingSession = session('matching-project')
    useSessionStore.setState({ sessions: [otherSession] })
    useTabStore.getState().openTab(otherSession.id, otherSession.title)
    listMock.mockResolvedValue({ sessions: [matchingSession], total: 1 })

    await useSessionStore.getState().fetchSessions('/workspace/project')

    expect(useSessionStore.getState().sessions).toEqual([matchingSession])
  })

  it.each(['single', 'batch'] as const)('does not resurrect an open older session after a %s deletion during refresh', async (mode) => {
    const olderSession = session('older-deleted')
    const recentSession = session('recent')
    useSessionStore.setState({ sessions: [recentSession, olderSession] })
    useTabStore.getState().openTab(olderSession.id, olderSession.title)
    const refresh = createDeferred<{ sessions: SessionListItem[]; total: number }>()
    listMock.mockReturnValue(refresh.promise)
    deleteMock.mockResolvedValue({ ok: true })
    batchDeleteMock.mockResolvedValue({ successes: [olderSession.id], failures: [] })
    const pendingRefresh = useSessionStore.getState().fetchSessions()

    if (mode === 'single') await useSessionStore.getState().deleteSession(olderSession.id)
    else await useSessionStore.getState().deleteSessions([olderSession.id])
    // Leave the tab open to prove refresh cannot resurrect metadata from the tab alone.
    expect(useTabStore.getState().tabs[0]?.sessionId).toBe(olderSession.id)
    refresh.resolve({ sessions: [recentSession], total: 101 })
    await pendingRefresh

    expect(useSessionStore.getState().sessions).toEqual([recentSession])
  })

  it('forwards direct branch switch repository options when creating a session', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-branch-switch', workDir: '/workspace/repo' })
    listMock.mockImplementation(() => new Promise(() => {}))

    await useSessionStore.getState().createSession('/workspace/repo', {
      repository: { branch: 'feature/rail', worktree: false },
    })

    expect(createMock).toHaveBeenCalledWith({
      workDir: '/workspace/repo',
      repository: { branch: 'feature/rail', worktree: false },
    })
  })

  it('forwards isolated worktree repository options when creating a session', async () => {
    createMock.mockResolvedValue({
      sessionId: 'session-worktree-launch',
      workDir: '/workspace/repo/.claude/worktrees/desktop-feature-rail-12345678',
    })
    listMock.mockImplementation(() => new Promise(() => {}))

    await useSessionStore.getState().createSession('/workspace/repo', {
      repository: { branch: 'feature/rail', worktree: true },
    })

    expect(createMock).toHaveBeenCalledWith({
      workDir: '/workspace/repo',
      repository: { branch: 'feature/rail', worktree: true },
    })
    expect(useSessionStore.getState().sessions[0]?.workDir)
      .toBe('/workspace/repo/.claude/worktrees/desktop-feature-rail-12345678')
  })

  it('returns the branched session before the background refresh completes', async () => {
    branchMock.mockResolvedValue({
      sessionId: 'session-branch-1',
      title: 'Branch from here',
      workDir: '/workspace/repo/branches/session-branch-1',
      sourceSessionId: 'session-source-1',
      targetMessageId: 'transcript-message-1',
    })
    listMock.mockImplementation(() => new Promise(() => {}))
    useSessionStore.setState({
      sessions: [{
        id: 'session-source-1',
        title: 'Source session',
        createdAt: '2026-05-19T00:00:00.000Z',
        modifiedAt: '2026-05-19T00:00:00.000Z',
        messageCount: 4,
        projectPath: '/workspace/repo',
        projectRoot: '/workspace/repo',
        workDir: '/workspace/repo',
        workDirExists: true,
      }],
    })

    const result = await Promise.race([
      useSessionStore.getState().branchSession('session-source-1', 'transcript-message-1'),
      delay(100).then(() => 'timed-out'),
    ])

    expect(result).toMatchObject({
      sessionId: 'session-branch-1',
      title: 'Branch from here',
      workDir: '/workspace/repo/branches/session-branch-1',
    })
    expect(branchMock).toHaveBeenCalledWith('session-source-1', {
      targetMessageId: 'transcript-message-1',
    })
    expect(useSessionStore.getState().activeSessionId).toBe('session-branch-1')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-branch-1',
      title: 'Branch from here',
      projectPath: '/workspace/repo',
      workDir: '/workspace/repo/branches/session-branch-1',
      projectRoot: '/workspace/repo',
      workDirExists: true,
    })
    expect(listMock).toHaveBeenCalledOnce()
  })

  it('updates an existing optimistic branch row when the branch session id is already present', async () => {
    branchMock.mockResolvedValue({
      sessionId: 'session-branch-existing',
      title: 'Updated branch',
      workDir: '/workspace/repo/branches/session-branch-existing',
      sourceSessionId: 'session-source-1',
      targetMessageId: 'transcript-message-2',
    })
    listMock.mockImplementation(() => new Promise(() => {}))
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-branch-existing',
          title: 'Old branch title',
          createdAt: '2026-05-18T00:00:00.000Z',
          modifiedAt: '2026-05-18T00:00:00.000Z',
          messageCount: 3,
          projectPath: '/workspace/old',
          projectRoot: '/workspace/old',
          workDir: '/workspace/old',
          workDirExists: true,
        },
        {
          id: 'session-source-1',
          title: 'Source session',
          createdAt: '2026-05-19T00:00:00.000Z',
          modifiedAt: '2026-05-19T00:00:00.000Z',
          messageCount: 4,
          projectPath: '/workspace/repo',
          projectRoot: '/workspace/repo',
          workDir: '/workspace/repo',
          workDirExists: true,
        },
      ],
    })

    await useSessionStore.getState().branchSession('session-source-1', 'transcript-message-2')

    expect(useSessionStore.getState().sessions).toHaveLength(2)
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-branch-existing',
      title: 'Updated branch',
      projectPath: '/workspace/repo',
      projectRoot: '/workspace/repo',
      workDir: '/workspace/repo/branches/session-branch-existing',
    })
  })
})
