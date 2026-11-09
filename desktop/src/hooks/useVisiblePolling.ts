import { useCallback, useEffect, useRef } from 'react'

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

export function useVisiblePolling(
  poll: () => Promise<void>,
  { intervalMs, focusMinMs }: { intervalMs: number; focusMinMs: number },
): () => Promise<void> {
  const inFlightRef = useRef<Promise<void> | null>(null)
  const lastStartedAtRef = useRef(0)

  const run = useCallback((force = false) => {
    if (inFlightRef.current) return inFlightRef.current

    const now = Date.now()
    if (!force && now - lastStartedAtRef.current < focusMinMs) {
      return Promise.resolve()
    }

    lastStartedAtRef.current = now
    const request = Promise.resolve()
      .then(() => poll())
      .catch((error: unknown) => console.warn('[polling] Refresh failed', error))
      .finally(() => {
        if (inFlightRef.current === request) {
          inFlightRef.current = null
        }
      })
    inFlightRef.current = request
    return request
  }, [poll, focusMinMs])

  useEffect(() => {
    void run(true)

    const runIfVisible = () => {
      if (!isDocumentVisible()) return
      void run()
    }

    window.addEventListener('focus', runIfVisible)
    document.addEventListener('visibilitychange', runIfVisible)
    const timer = window.setInterval(() => {
      if (!isDocumentVisible()) return
      void run(true)
    }, intervalMs)

    return () => {
      window.removeEventListener('focus', runIfVisible)
      document.removeEventListener('visibilitychange', runIfVisible)
      window.clearInterval(timer)
    }
  }, [run, intervalMs])

  return useCallback(() => run(true), [run])
}
