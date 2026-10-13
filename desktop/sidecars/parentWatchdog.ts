/**
 * 桌面主进程崩溃（例如未捕获的 NSException）时来不及 kill sidecar，
 * sidecar 会被 launchd/init 收养并一直占着端口。主进程启动 sidecar 时
 * 通过 DREAMCODER_PARENT_PID 传入自己的 pid，这里定期检查它是否还在，
 * 不在了就退出。
 */

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
    // EPERM: the process exists but belongs to another user.
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
