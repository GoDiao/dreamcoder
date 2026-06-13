import { useEffect } from 'react'
import { tasksApi } from '../api/tasks'
import { notifyDesktop } from '../lib/desktopNotifications'
import { devWarn } from '../lib/devLog'
import { useUIStore } from '../stores/uiStore'
import type { CronTask, TaskRun } from '../types/task'

const POLL_FAST_MS = 30_000
const POLL_SLOW_MS = 5 * 60_000
const NOTIFIED_RUNS_STORAGE_KEY = 'dreamcoder.notifiedDesktopTaskRuns.v1'
const MAX_STORED_RUN_IDS = 200

// After this many consecutive poll failures, surface a toast so the user
// knows scheduled-task notifications have stopped working. We keep the
// threshold above 1 to ride out transient blips (e.g. backend restart).
const POLL_FAILURE_TOAST_THRESHOLD = 3

function isTerminalRun(run: TaskRun): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'timeout'
}

function hasDesktopNotification(task: CronTask | undefined): boolean {
  return !!task?.notification?.enabled && task.notification.channels.includes('desktop')
}

function readNotifiedRunIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_RUNS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeNotifiedRunIds(runIds: Set<string>): void {
  try {
    const trimmed = [...runIds].slice(-MAX_STORED_RUN_IDS)
    localStorage.setItem(NOTIFIED_RUNS_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Notification dedupe is best-effort; storage failures should not break the app.
  }
}

function formatTaskRunNotification(run: TaskRun): { title: string; body: string } {
  const status = run.status === 'completed'
    ? '完成'
    : run.status === 'failed'
      ? '失败'
      : '超时'
  const detail = run.error || run.output || run.prompt
  const body = detail
    ? `${status}: ${detail.slice(0, 160)}`
    : `状态: ${status}`

  return {
    title: `定时任务 ${run.taskName || run.taskId}`,
    body,
  }
}

export function collectDesktopNotifiableRuns(
  tasks: CronTask[],
  runs: TaskRun[],
  notifiedRunIds: Set<string>,
): TaskRun[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  return runs
    .filter((run) => isTerminalRun(run))
    .filter((run) => hasDesktopNotification(taskById.get(run.taskId)))
    .filter((run) => !notifiedRunIds.has(run.id))
    .sort((a, b) => Date.parse(a.completedAt ?? a.startedAt) - Date.parse(b.completedAt ?? b.startedAt))
}

export function useScheduledTaskDesktopNotifications(): void {
  useEffect(() => {
    let stopped = false
    let initialized = false
    let nextDelay = POLL_FAST_MS
    let timerId: number | null = null
    let consecutiveFailures = 0
    let toastedFailure = false

    const poll = async () => {
      try {
        // First fetch the task list. If no tasks have desktop notifications
        // enabled, skip the second request and back off to slow polling.
        const { tasks } = await tasksApi.list()
        if (stopped) return

        const desktopEnabledTasks = tasks.filter(hasDesktopNotification)
        if (desktopEnabledTasks.length === 0) {
          nextDelay = POLL_SLOW_MS
          consecutiveFailures = 0
          return
        }
        nextDelay = POLL_FAST_MS

        const { runs } = await tasksApi.getRecentRuns(50)
        if (stopped) return

        const notifiedRunIds = readNotifiedRunIds()
        const pendingRuns = collectDesktopNotifiableRuns(tasks, runs, notifiedRunIds)

        if (!initialized) {
          for (const run of pendingRuns) notifiedRunIds.add(run.id)
          writeNotifiedRunIds(notifiedRunIds)
          initialized = true
          consecutiveFailures = 0
          return
        }

        for (const run of pendingRuns) {
          const notification = formatTaskRunNotification(run)
          const sent = await notifyDesktop({
            dedupeKey: `scheduled-task:${run.id}`,
            title: notification.title,
            body: notification.body,
            target: run.sessionId
              ? { type: 'session', sessionId: run.sessionId, title: run.taskName || run.taskId }
              : { type: 'scheduled' },
          })
          if (sent) notifiedRunIds.add(run.id)
        }
        writeNotifiedRunIds(notifiedRunIds)

        // Successful poll — reset failure tracking and let future failures
        // trigger a fresh toast if they cross the threshold again.
        consecutiveFailures = 0
        toastedFailure = false
      } catch (err) {
        if (typeof console !== 'undefined') {
          devWarn('[scheduledTaskNotifications] failed to poll task runs:', err)
        }
        consecutiveFailures += 1
        if (consecutiveFailures >= POLL_FAILURE_TOAST_THRESHOLD && !toastedFailure) {
          toastedFailure = true
          try {
            useUIStore.getState().addToast({
              type: 'warning',
              message: '定时任务通知轮询失败，请检查后端服务连接。',
              duration: 8000,
            })
          } catch {
            // Toast subsystem failure should not crash the poller.
          }
        }
      }
    }

    const schedule = () => {
      timerId = window.setTimeout(async () => {
        await poll()
        if (!stopped) schedule()
      }, nextDelay)
    }

    // Kick off immediately, then schedule subsequent polls based on `nextDelay`.
    void poll().then(() => {
      if (!stopped) schedule()
    })

    return () => {
      stopped = true
      if (timerId !== null) window.clearTimeout(timerId)
    }
  }, [])
}
