import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSessionLink } from './sessionNavigation'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import type { SessionListItem } from '../types/session'

const item = (id: string, title: string): SessionListItem => ({
  id, title, createdAt: '', modifiedAt: '', messageCount: 1,
  projectPath: '/p', workDir: '/p', workDirExists: true,
})

describe('useSessionLink', () => {
  const connectToSession = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [item('a', 'Alpha'), item('b', 'Beta')] })
    useChatStore.setState({ sessions: {}, connectToSession } as Partial<ReturnType<typeof useChatStore.getState>>)
  })

  afterEach(() => cleanup())

  it('prefers the known title, then the title at send time, then the untitled label', () => {
    expect(renderHook(() => useSessionLink({ sessionId: 'a', sentTitle: 'old title' })).result.current.title).toBe('Alpha')
    expect(renderHook(() => useSessionLink({ sessionId: 'zzz', sentTitle: 'old title' })).result.current.title).toBe('old title')
    expect(renderHook(() => useSessionLink({ sessionId: 'zzz' })).result.current.title).toBe('Untitled Session')
  })

  it('follows a rename of the linked session', () => {
    const { result } = renderHook(() => useSessionLink({ sessionId: 'a', sentTitle: 'Alpha' }))

    act(() => useSessionStore.setState({ sessions: [item('a', 'Project manager'), item('b', 'Beta')] }))

    expect(result.current.title).toBe('Project manager')
  })

  it('opens a tab titled with the known title and connects', () => {
    const { result } = renderHook(() => useSessionLink({ sessionId: 'a', sentTitle: 'old title' }))
    act(() => result.current.open())

    expect(useTabStore.getState().tabs.find((tab) => tab.sessionId === 'a')?.title).toBe('Alpha')
    expect(connectToSession).toHaveBeenCalledWith('a')
  })

  it('does not re-render when another session changes', () => {
    let renders = 0
    renderHook(() => {
      renders += 1
      return useSessionLink({ sessionId: 'a' })
    })
    const before = renders

    act(() => useSessionStore.setState({ sessions: [item('a', 'Alpha'), item('b', 'Beta renamed')] }))

    expect(renders).toBe(before)
  })
})
