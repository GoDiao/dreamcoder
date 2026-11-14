import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useBrowserStore } from '../stores/browserStore'
import { useChatStore } from '../stores/chatStore'
import { useTabStore, type Tab } from '../stores/tabStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { MAX_LIVE_SESSIONS, selectSessionsToRelease, useReleaseIdleSessions } from './useReleaseIdleSessions'

function tab(sessionId: string, status: Tab['status'] = 'idle', type: Tab['type'] = 'session'): Tab {
  return { sessionId, title: sessionId, type, status }
}

describe('selectSessionsToRelease', () => {
  it('keeps everything while under the limit', () => {
    expect(selectSessionsToRelease([tab('a'), tab('b')], 'b', () => false, 3)).toEqual([])
  })

  it('releases the oldest idle sessions beyond the limit', () => {
    const tabs = [tab('a'), tab('b'), tab('c'), tab('d')]
    expect(selectSessionsToRelease(tabs, 'd', () => false, 2)).toEqual(['a', 'b'])
  })

  it('never releases the active, running or busy sessions', () => {
    const tabs = [tab('active'), tab('running', 'running'), tab('busy'), tab('old'), tab('new')]
    const released = selectSessionsToRelease(tabs, 'active', (id) => id === 'busy', 4)
    expect(released).toEqual(['old'])
  })

  it('ignores non-session pages', () => {
    const tabs = [tab('__scheduled__', 'idle', 'scheduled'), tab('a'), tab('b')]
    expect(selectSessionsToRelease(tabs, 'b', () => false, 2)).toEqual([])
  })
})

describe('useReleaseIdleSessions', () => {
  afterEach(() => {
    useTabStore.setState(useTabStore.getInitialState(), true)
    useBrowserStore.setState(useBrowserStore.getInitialState(), true)
    useWorkspacePanelStore.setState({ panelByTab: {} })
    useChatStore.setState({ sessions: {} })
    localStorage.clear()
  })

  it('keeps a parent whose side chat is running', () => {
    const ids = Array.from({ length: MAX_LIVE_SESSIONS + 1 }, (_, index) => `session-${index}`)
    useTabStore.setState({ tabs: ids.map((id) => tab(id)), activeTabId: ids[ids.length - 1] })
    useWorkspacePanelStore.getState().openTab('session-0', { kind: 'sideChat', sessionId: 'side' })
    useChatStore.setState({
      sessions: {
        'session-0': { ...useChatStore.getState().getSession('session-0'), chatState: 'idle' },
        side: { ...useChatStore.getState().getSession('side'), chatState: 'streaming' },
      },
    })

    renderHook(() => useReleaseIdleSessions())

    expect(useTabStore.getState().tabs.map((candidate) => candidate.sessionId)).toContain('session-0')
    expect(useTabStore.getState().tabs.map((candidate) => candidate.sessionId)).not.toContain('session-1')
  })

  it('closes the browser of a released session but keeps its tab for later', () => {
    const ids = Array.from({ length: MAX_LIVE_SESSIONS + 1 }, (_, index) => `session-${index}`)
    useTabStore.setState({ tabs: ids.map((id) => tab(id)), activeTabId: ids[ids.length - 1] })
    const { openTab } = useWorkspacePanelStore.getState()
    const released = openTab('session-0', { kind: 'browser', url: 'https://old.test/' })
    const kept = openTab('session-1', { kind: 'browser', url: 'https://kept.test/' })
    useBrowserStore.getState().patchPage(released, { loading: true })
    useBrowserStore.getState().patchPage(kept, { loading: true })

    renderHook(() => useReleaseIdleSessions())

    expect(Object.keys(useBrowserStore.getState().pageByTab)).toEqual([kept])
    expect(useWorkspacePanelStore.getState().panelByTab['session-0']?.tabs).toEqual([
      { id: released, kind: 'browser', url: 'https://old.test/', title: '' },
    ])
  })
})
