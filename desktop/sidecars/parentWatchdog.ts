export const PARENT_PID_ENV = 'DREAMCODER_PARENT_PID'
const DEFAULT_INTERVAL_MS = 2_000

export function parseParentPid(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const pid = Number(value)
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function startParentWatchdog(options: {
  parentPid: number | null
  isAlive?: (pid: number) => boolean
  onParentExit?: () => void
  intervalMs?: number
}): (() => void) | null {
  const { parentPid } = options
  if (parentPid === null) return null

  const isAlive = options.isAlive ?? isProcessAlive
  const onParentExit = options.onParentExit ?? (() => process.exit(0))
  const timer = setInterval(() => {
    if (isAlive(parentPid)) return
    clearInterval(timer)
    console.error(`[dreamcoder-sidecar] parent process ${parentPid} is gone, exiting`)
    onParentExit()
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS)
  timer.unref?.()

  return () => clearInterval(timer)
}
