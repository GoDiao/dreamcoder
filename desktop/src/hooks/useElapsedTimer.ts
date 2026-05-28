import { useState, useEffect, useRef } from 'react'

/**
 * Custom hook for elapsed timer that runs outside of Zustand state.
 * This eliminates the per-second updateSessionIn calls that were causing
 * unnecessary re-renders of the entire sessions record.
 */
export function useElapsedTimer(sessionId: string | undefined, active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!active || !sessionId) {
      setSeconds(0)
      return
    }

    // Reset seconds when starting a new session
    setSeconds(0)

    intervalRef.current = setInterval(() => {
      setSeconds(prev => prev + 1)
    }, 1000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [sessionId, active])

  return seconds
}
