import { useCallback, useEffect, useMemo, useState } from 'react'
import type Fuse from 'fuse.js'
import { sessionsApi } from '../api/sessions'
import type { SessionListItem } from '../types/session'

const PAGE_SIZE = 100
const RESULT_LIMIT = 10

type FuseConstructor = typeof Fuse

let fusePromise: Promise<FuseConstructor> | null = null

// Fuse is only needed once the session search opens, so keep it out of the startup bundle.
function loadFuse(): Promise<FuseConstructor> {
  fusePromise ??= import('fuse.js').then(
    ({ default: FuseClass }) => FuseClass,
    (err: unknown) => {
      fusePromise = null
      throw err
    },
  )
  return fusePromise
}

export function useSessionSearch(query: string) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [FuseClass, setFuseClass] = useState<FuseConstructor | null>(null)
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
      const fuseLoad = loadFuse()
      // Observed below; this only stops an early failure from being reported as unhandled.
      fuseLoad.catch(() => {})
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
          offset += PAGE_SIZE
        } while (offset < total)

        const LoadedFuse = await fuseLoad
        if (cancelled) return
        setFuseClass(() => LoadedFuse)
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

  const index = useMemo(() => FuseClass && new FuseClass(sessions, {
    keys: [{ name: 'title', weight: 2 }, { name: 'lastAssistantMessage', weight: 1 }],
    threshold: 0.35,
    ignoreLocation: true,
    ignoreFieldNorm: true,
  }), [FuseClass, sessions])

  const results = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return sessions.slice(0, RESULT_LIMIT)
    return index ? index.search(trimmed, { limit: RESULT_LIMIT }).map(({ item }) => item) : []
  }, [index, query, sessions])

  return { results, isLoading, error, retry }
}
