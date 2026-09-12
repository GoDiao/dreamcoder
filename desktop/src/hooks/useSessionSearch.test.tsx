import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from '../api/sessions'
import type { SessionListItem } from '../types/session'
import { useSessionSearch } from './useSessionSearch'

function session(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id,
    title: `Session ${id}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    modifiedAt: '2026-09-01T00:00:00.000Z',
    messageCount: 2,
    projectPath: '/project',
    workDir: '/project',
    workDirExists: true,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type SessionPage = Awaited<ReturnType<typeof sessionsApi.list>>

describe('useSessionSearch', () => {
  beforeEach(() => {
    vi.spyOn(sessionsApi, 'list').mockResolvedValue({ sessions: [], total: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads globally and tolerates a typo in a session title without refetching for every query', async () => {
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [
        session('auth', { title: 'Authentication flow' }),
        session('other', { title: 'Database migration' }),
      ],
      total: 2,
    })
    const { result, rerender } = renderHook(({ query }) => useSessionSearch(query), {
      initialProps: { query: 'authenticaton' },
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.results.map((item) => item.id)).toEqual(['auth'])
    expect(sessionsApi.list).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      includeLastAssistantMessage: true,
    })

    rerender({ query: 'database' })
    expect(result.current.results.map((item) => item.id)).toEqual(['other'])
    expect(sessionsApi.list).toHaveBeenCalledTimes(1)
  })

  it('searches the last assistant message, including matches far into a long message', async () => {
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [
        session('answer', {
          title: 'Untitled conversation',
          lastAssistantMessage: `${'An earlier paragraph. '.repeat(300)}quasar deployment`,
        }),
        session('missing-message', { title: 'Weather report' }),
      ],
      total: 2,
    })
    const { result } = renderHook(() => useSessionSearch('quasar'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.results.map((item) => item.id)).toEqual(['answer'])
    expect(result.current.error).toBe(false)
  })

  it('shows the ten most recently modified sessions for empty and whitespace queries', async () => {
    const sessions = Array.from({ length: 14 }, (_, index) => session(String(index), {
      modifiedAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
      // Recency is based on modifiedAt, not creation time or the API order.
      createdAt: new Date(Date.UTC(2026, 8, 28 - index)).toISOString(),
    }))
    vi.mocked(sessionsApi.list).mockResolvedValue({ sessions, total: sessions.length })
    const { result, rerender } = renderHook(({ query }) => useSessionSearch(query), {
      initialProps: { query: '' },
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const expectedIds = ['13', '12', '11', '10', '9', '8', '7', '6', '5', '4']
    expect(result.current.results.map((item) => item.id)).toEqual(expectedIds)

    rerender({ query: ' \t ' })
    expect(result.current.results.map((item) => item.id)).toEqual(expectedIds)
  })

  it('limits nonempty search results to ten and returns nothing for an unmatched query', async () => {
    const sessions = Array.from({ length: 20 }, (_, index) => session(String(index), {
      title: `Matching project ${index}`,
    }))
    vi.mocked(sessionsApi.list).mockResolvedValue({ sessions, total: sessions.length })
    const { result, rerender } = renderHook(({ query }) => useSessionSearch(query), {
      initialProps: { query: 'matching' },
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.results).toHaveLength(10)

    rerender({ query: 'zzzzzzzzzzzzzzzzzzzzzz' })
    expect(result.current.results).toEqual([])
  })

  it('finds sessions beyond the first page of one hundred results', async () => {
    const sessions = Array.from({ length: 205 }, (_, index) => session(String(index), {
      title: index === 204 ? 'Hidden quasar conversation' : `Ordinary session ${index}`,
    }))
    vi.mocked(sessionsApi.list).mockImplementation(async (params) => ({
      sessions: sessions.slice(params?.offset ?? 0, (params?.offset ?? 0) + (params?.limit ?? 100)),
      total: sessions.length,
    }))
    const { result } = renderHook(() => useSessionSearch('quasar'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.results.map((item) => item.id)).toEqual(['204'])
    expect(vi.mocked(sessionsApi.list).mock.calls.map(([params]) => params?.offset)).toEqual([0, 100, 200])
  })

  it('continues through sparse and empty pages using the server total, and removes duplicate sessions', async () => {
    vi.mocked(sessionsApi.list)
      .mockResolvedValueOnce({ sessions: [session('shared', { title: 'Quasar first' })], total: 301 })
      .mockResolvedValueOnce({ sessions: [], total: 301 })
      .mockResolvedValueOnce({ sessions: [session('shared', { title: 'Quasar first' })], total: 301 })
      .mockResolvedValueOnce({ sessions: [session('last', { title: 'Quasar last' })], total: 301 })
    const { result } = renderHook(() => useSessionSearch('quasar'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.results.map((item) => item.id).sort()).toEqual(['last', 'shared'])
    expect(vi.mocked(sessionsApi.list).mock.calls.map(([params]) => params?.offset)).toEqual([0, 100, 200, 300])
  })

  it('keeps results in a loading state until the complete searchable list is available', async () => {
    const secondPage = deferred<SessionPage>()
    vi.mocked(sessionsApi.list)
      .mockResolvedValueOnce({ sessions: [session('first')], total: 101 })
      .mockReturnValueOnce(secondPage.promise)
    const { result } = renderHook(() => useSessionSearch(''))

    await waitFor(() => expect(sessionsApi.list).toHaveBeenCalledTimes(2))
    expect(result.current.isLoading).toBe(true)
    expect(result.current.results).toEqual([])

    await act(async () => {
      secondPage.resolve({ sessions: [session('last')], total: 101 })
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.results).toHaveLength(2)
  })

  it('reports a later page failure and retries from the first page without keeping partial results', async () => {
    vi.mocked(sessionsApi.list)
      .mockResolvedValueOnce({ sessions: [session('stale')], total: 101 })
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ sessions: [session('fresh')], total: 1 })
    const { result } = renderHook(() => useSessionSearch(''))

    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.results).toEqual([])

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.results.map((item) => item.id)).toEqual(['fresh']))
    expect(result.current.error).toBe(false)
    expect(vi.mocked(sessionsApi.list).mock.calls.map(([params]) => params?.offset)).toEqual([0, 100, 0])
  })

  it('does not request further pages after the search is unmounted', async () => {
    const page = deferred<SessionPage>()
    vi.mocked(sessionsApi.list).mockReturnValueOnce(page.promise)
    const { unmount } = renderHook(() => useSessionSearch(''))
    expect(sessionsApi.list).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      page.resolve({ sessions: [session('late')], total: 500 })
    })
    expect(sessionsApi.list).toHaveBeenCalledTimes(1)
  })

  it('ignores an older in-flight request when a retry has already loaded newer data', async () => {
    const oldPage = deferred<SessionPage>()
    vi.mocked(sessionsApi.list)
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ sessions: [session('fresh')], total: 1 })
    const { result } = renderHook(() => useSessionSearch(''))

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.results.map((item) => item.id)).toEqual(['fresh']))

    await act(async () => {
      oldPage.resolve({ sessions: [session('stale')], total: 500 })
    })
    expect(result.current.results.map((item) => item.id)).toEqual(['fresh'])
    expect(sessionsApi.list).toHaveBeenCalledTimes(2)
  })
})
