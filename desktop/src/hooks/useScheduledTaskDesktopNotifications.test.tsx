import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useScheduledTaskDesktopNotifications } from './useScheduledTaskDesktopNotifications'
import { useUIStore } from '../stores/uiStore'

const { listMock, getRecentRunsMock, notifyDesktopMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getRecentRunsMock: vi.fn(),
  notifyDesktopMock: vi.fn(),
}))

vi.mock('../api/tasks', () => ({
  tasksApi: {
    list: listMock,
    getRecentRuns: getRecentRunsMock,
  },
}))

vi.mock('../lib/desktopNotifications', () => ({
  notifyDesktop: notifyDesktopMock,
}))

function Harness() {
  useScheduledTaskDesktopNotifications()
  return null
}

describe('useScheduledTaskDesktopNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    listMock.mockReset()
    getRecentRunsMock.mockReset()
    notifyDesktopMock.mockReset()
    notifyDesktopMock.mockResolvedValue(true)
  })

  it('does not notify old runs on first poll and notifies new desktop-enabled task runs later', async () => {
    listMock.mockResolvedValue({
      tasks: [{
        id: 'task-1',
        name: 'Daily review',
        cron: '* * * * *',
        prompt: 'review',
        enabled: true,
        createdAt: 1,
        notification: { enabled: true, channels: ['desktop'] },
      }],
    })
    getRecentRunsMock
      .mockResolvedValueOnce({
        runs: [{
          id: 'run-old',
          taskId: 'task-1',
          taskName: 'Daily review',
          startedAt: '2026-05-03T00:00:00.000Z',
          completedAt: '2026-05-03T00:00:01.000Z',
          status: 'completed',
          prompt: 'review',
          output: 'old result',
        }],
      })
      .mockResolvedValueOnce({
        runs: [
          {
            id: 'run-old',
            taskId: 'task-1',
            taskName: 'Daily review',
            startedAt: '2026-05-03T00:00:00.000Z',
            completedAt: '2026-05-03T00:00:01.000Z',
            status: 'completed',
            prompt: 'review',
            output: 'old result',
          },
          {
            id: 'run-new',
            taskId: 'task-1',
            taskName: 'Daily review',
            startedAt: '2026-05-03T00:01:00.000Z',
            completedAt: '2026-05-03T00:01:01.000Z',
            status: 'failed',
            prompt: 'review',
            error: 'provider timeout',
          },
        ],
      })

    render(<Harness />)
    await vi.waitFor(() => expect(getRecentRunsMock).toHaveBeenCalledTimes(1))
    expect(notifyDesktopMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(notifyDesktopMock).toHaveBeenCalledTimes(1))
    expect(notifyDesktopMock).toHaveBeenCalledWith({
      dedupeKey: 'scheduled-task:run-new',
      title: '定时任务 Daily review',
      body: '失败: provider timeout',
      target: { type: 'scheduled' },
    })
  })

  it('targets the run session when a scheduled task run has a session id', async () => {
    listMock.mockResolvedValue({
      tasks: [{
        id: 'task-1',
        name: 'Daily review',
        cron: '* * * * *',
        prompt: 'review',
        enabled: true,
        createdAt: 1,
        notification: { enabled: true, channels: ['desktop'] },
      }],
    })
    getRecentRunsMock
      .mockResolvedValueOnce({ runs: [] })
      .mockResolvedValueOnce({
        runs: [{
          id: 'run-new',
          taskId: 'task-1',
          taskName: 'Daily review',
          startedAt: '2026-05-03T00:01:00.000Z',
          completedAt: '2026-05-03T00:01:01.000Z',
          status: 'completed',
          prompt: 'review',
          output: 'done',
          sessionId: 'session-task-run',
        }],
      })

    render(<Harness />)
    await vi.waitFor(() => expect(getRecentRunsMock).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(notifyDesktopMock).toHaveBeenCalledTimes(1))
    expect(notifyDesktopMock).toHaveBeenCalledWith({
      dedupeKey: 'scheduled-task:run-new',
      title: '定时任务 Daily review',
      body: '完成: done',
      target: {
        type: 'session',
        sessionId: 'session-task-run',
        title: 'Daily review',
      },
    })
  })

  it('ignores task runs without the desktop notification channel', async () => {
    listMock.mockResolvedValue({
      tasks: [{
        id: 'task-1',
        name: 'IM only',
        cron: '* * * * *',
        prompt: 'review',
        enabled: true,
        createdAt: 1,
        notification: { enabled: true, channels: ['telegram'] },
      }],
    })
    getRecentRunsMock.mockResolvedValue({
      runs: [{
        id: 'run-1',
        taskId: 'task-1',
        taskName: 'IM only',
        startedAt: '2026-05-03T00:00:00.000Z',
        completedAt: '2026-05-03T00:00:01.000Z',
        status: 'completed',
        prompt: 'review',
      }],
    })

    render(<Harness />)
    // Batch C short-circuit: when no task has the desktop channel enabled,
    // the hook skips the getRecentRuns call entirely and backs off to slow
    // polling. Wait for the task list call to land, then verify the recent
    // runs request was never issued and no desktop notification fired.
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(30_000)

    expect(getRecentRunsMock).not.toHaveBeenCalled()
    expect(notifyDesktopMock).not.toHaveBeenCalled()
  })

  it('does not mark a run as notified when desktop notification delivery fails', async () => {
    notifyDesktopMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    listMock.mockResolvedValue({
      tasks: [{
        id: 'task-1',
        name: 'Daily review',
        cron: '* * * * *',
        prompt: 'review',
        enabled: true,
        createdAt: 1,
        notification: { enabled: true, channels: ['desktop'] },
      }],
    })
    getRecentRunsMock
      .mockResolvedValueOnce({ runs: [] })
      .mockResolvedValue({
        runs: [{
          id: 'run-new',
          taskId: 'task-1',
          taskName: 'Daily review',
          startedAt: '2026-05-03T00:01:00.000Z',
          completedAt: '2026-05-03T00:01:01.000Z',
          status: 'completed',
          prompt: 'review',
        }],
      })

    render(<Harness />)
    await vi.waitFor(() => expect(getRecentRunsMock).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(notifyDesktopMock).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(notifyDesktopMock).toHaveBeenCalledTimes(2))
  })

  it('shows a toast warning after consecutive poll failures', async () => {
    // Three consecutive failures should surface a single toast.
    listMock.mockRejectedValue(new Error('network down'))

    // Replace addToast with a spy. Restore after the test so we don't
    // leak between cases.
    const originalAddToast = useUIStore.getState().addToast
    const addToastSpy = vi.fn()
    useUIStore.setState({ addToast: addToastSpy })

    try {
      render(<Harness />)
      await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(30_000)
      await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))

      await vi.advanceTimersByTimeAsync(30_000)
      await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(3))

      expect(addToastSpy).toHaveBeenCalledTimes(1)
      expect(addToastSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning',
        message: expect.stringContaining('轮询失败'),
      }))

      // Subsequent failures should NOT pile on additional toasts.
      addToastSpy.mockClear()
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(4))
      expect(addToastSpy).not.toHaveBeenCalled()
    } finally {
      useUIStore.setState({ addToast: originalAddToast })
    }
  })
})
