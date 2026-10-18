import { describe, expect, it } from 'vitest'
import type { Tab } from '../stores/tabStore'
import { selectSessionsToRelease } from './useReleaseIdleSessions'

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
