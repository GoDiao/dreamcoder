import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from '../api/sessions'
import type { SessionListItem } from '../types/session'
import { useTabStore } from './tabStore'

describe('tabStore', () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    localStorage.clear()
  })

  afterEach(() => vi.restoreAllMocks())

  function session(id: string): SessionListItem {
    return {
      id, title: `Server title ${id}`, createdAt: '2026-09-01T00:00:00Z',
      modifiedAt: '2026-09-01T00:00:00Z', messageCount: 2,
      projectPath: '/project', workDir: '/project', workDirExists: true,
    }
  }

  it('restores a quick-switched tab beyond 200 sessions with its title and active selection', async () => {
    useTabStore.getState().openTab('session-2', 'Cached recent title')
    useTabStore.getState().openTab('session-204', 'Cached old title')
    useTabStore.setState({ tabs: [], activeTabId: null })
    const sessions = Array.from({ length: 450 }, (_, i) => session(`session-${i}`))
    const list = vi.spyOn(sessionsApi, 'list').mockImplementation(async (params) => ({
      sessions: sessions.slice(params?.offset ?? 0, (params?.offset ?? 0) + (params?.limit ?? 200)),
      total: sessions.length,
    }))

    await useTabStore.getState().restoreTabs()

    expect(useTabStore.getState().tabs).toEqual([
      { sessionId: 'session-2', title: 'Server title session-2', type: 'session', status: 'idle' },
      { sessionId: 'session-204', title: 'Server title session-204', type: 'session', status: 'idle' },
    ])
    expect(useTabStore.getState().activeTabId).toBe('session-204')
    // All requested IDs are resolved; do not scan the remaining page.
    expect(list.mock.calls.map(([params]) => params)).toEqual([
      { limit: 200, offset: 0 }, { limit: 200, offset: 200 },
    ])
  })

  it('stops after the first page when every persisted session has been found', async () => {
    useTabStore.getState().openTab('recent', 'Cached title')
    useTabStore.setState({ tabs: [], activeTabId: null })
    const list = vi.spyOn(sessionsApi, 'list').mockResolvedValue({ sessions: [session('recent')], total: 900 })

    await useTabStore.getState().restoreTabs()

    expect(list).toHaveBeenCalledTimes(1)
    expect(useTabStore.getState().activeTabId).toBe('recent')
  })

  it('continues through empty pages, exhausts the server total, and removes only missing sessions', async () => {
    useTabStore.getState().openTab('__settings__', 'Settings', 'settings')
    useTabStore.getState().openTab('old', 'Cached old title')
    useTabStore.getState().openTab('deleted', 'Missing session')
    useTabStore.setState({ tabs: [], activeTabId: null })
    const list = vi.spyOn(sessionsApi, 'list')
      .mockResolvedValueOnce({ sessions: [session('unrelated')], total: 401 })
      .mockResolvedValueOnce({ sessions: [], total: 401 })
      .mockResolvedValueOnce({ sessions: [session('old')], total: 401 })

    await useTabStore.getState().restoreTabs()

    expect(list.mock.calls.map(([params]) => params?.offset)).toEqual([0, 200, 400])
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toEqual(['__settings__', 'old'])
    expect(useTabStore.getState().activeTabId).toBe('__settings__')
  })

  it('restores only special tabs without listing sessions', async () => {
    useTabStore.getState().openTab('__settings__', 'Settings', 'settings')
    useTabStore.getState().openTab('__scheduled__', 'Scheduled', 'scheduled')
    useTabStore.setState({ tabs: [], activeTabId: null })
    const list = vi.spyOn(sessionsApi, 'list')

    await useTabStore.getState().restoreTabs()

    expect(list).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toEqual(['__settings__', '__scheduled__'])
    expect(useTabStore.getState().activeTabId).toBe('__scheduled__')
  })

  it('keeps persisted tabs intact when a later page fails so restore can be retried', async () => {
    useTabStore.getState().openTab('recent', 'Recent')
    useTabStore.getState().openTab('old', 'Old')
    const persisted = localStorage.getItem('dreamcoder-open-tabs')
    useTabStore.setState({ tabs: [], activeTabId: null })
    vi.spyOn(sessionsApi, 'list')
      .mockResolvedValueOnce({ sessions: [session('recent')], total: 201 })
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce({ sessions: [session('recent'), session('old')], total: 2 })

    await useTabStore.getState().restoreTabs()

    expect(localStorage.getItem('dreamcoder-open-tabs')).toBe(persisted)
    expect(useTabStore.getState().tabs).toEqual([])
    await useTabStore.getState().restoreTabs()
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toEqual(['recent', 'old'])
    expect(useTabStore.getState().activeTabId).toBe('old')
  })

  it('refreshes an existing tab title when opening the same session again', () => {
    useTabStore.getState().openTab('session-1', '```json {"title":')
    useTabStore.getState().openTab('session-1', '使用bash写一个shell，随便写点什么东西')

    expect(useTabStore.getState().tabs).toHaveLength(1)
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      sessionId: 'session-1',
      title: '使用bash写一个shell，随便写点什么东西',
      type: 'session',
    })
    expect(useTabStore.getState().activeTabId).toBe('session-1')
  })

  it('stores a promoted terminal runtime id on new terminal tabs', () => {
    const tabId = useTabStore.getState().openTerminalTab('/tmp/project', '__session_terminal__session-1')

    expect(useTabStore.getState().tabs).toEqual([
      {
        sessionId: tabId,
        title: 'Terminal 1',
        type: 'terminal',
        status: 'idle',
        terminalCwd: '/tmp/project',
        terminalRuntimeId: '__session_terminal__session-1',
      },
    ])
    expect(useTabStore.getState().activeTabId).toBe(tabId)
  })
})
