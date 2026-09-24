import { useCallback, useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { sessionsApi } from '../api/sessions'
import type { SessionListItem } from '../types/session'

const PAGE_SIZE = 100
const RESULT_LIMIT = 10

/** Load search metadata on demand, without hydrating every conversation's history. */
export function useSessionSearch(query: string) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setSessions([])

    async function load() {
      try {
        const byId = new Map<string, SessionListItem>()
        let offset = 0
        let total = 0
        do {
          const page = await sessionsApi.list({
            limit: PAGE_SIZE,
            offset,
            includeLastAssistantMessage: true,
          })
          if (cancelled) return
          for (const session of page.sessions) {
            const previous = byId.get(session.id)
            if (!previous || Date.parse(session.modifiedAt) >= Date.parse(previous.modifiedAt)) {
              byId.set(session.id, session)
            }
          }
          total = page.total
          // The server may skip unreadable files; advance by page size, not result count.
          offset += PAGE_SIZE
        } while (offset < total)

        setSessions([...byId.values()].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt)))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(typeof err === 'string' ? err : ''))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [attempt])

  const index = useMemo(() => new Fuse(sessions, {
    keys: [{ name: 'title', weight: 2 }, { name: 'lastAssistantMessage', weight: 1 }],
    threshold: 0.35,
    ignoreLocation: true,
    ignoreFieldNorm: true,
  }), [sessions])

  const results = useMemo(() => {
    const trimmed = query.trim()
    return trimmed
      ? index.search(trimmed, { limit: RESULT_LIMIT }).map(({ item }) => item)
      : sessions.slice(0, RESULT_LIMIT)
  }, [index, query, sessions])

  return { results, isLoading, error, retry }
}
