import { useEffect, useState } from 'react'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (elapsedSeconds === 0) return null

  return (
    <span className="text-[10px] text-[var(--color-text-tertiary)]">
      {formatElapsed(elapsedSeconds)}
    </span>
  )
}
