import { create } from 'zustand'
import {
  claudeCodeImportApi,
  type ClaudeCodeImportJob,
  type ClaudeCodeImportStatus,
} from '../api/claudeCodeImport'
import { useProviderStore } from './providerStore'
import { useSessionStore } from './sessionStore'
import { useSettingsStore } from './settingsStore'

const POLL_INTERVAL_MS = 500
const MAX_POLL_INTERVAL_MS = 10_000

type ClaudeCodeImportStore = {
  status: ClaudeCodeImportStatus | null
  job: ClaudeCodeImportJob | null
  error: string | null
  /** The first-launch prompt is open: offered at startup, until skipped or finished. */
  promptOpen: boolean

  /** Loads the status; opens the first-launch prompt when the import is offered. */
  fetchStatus: (options?: { openPrompt?: boolean }) => Promise<void>
  startImport: () => Promise<void>
  skip: () => Promise<void>
  closePrompt: () => void
}

let pollTimer: ReturnType<typeof setTimeout> | null = null

export const useClaudeCodeImportStore = create<ClaudeCodeImportStore>((set, get) => ({
  status: null,
  job: null,
  error: null,
  promptOpen: false,

  fetchStatus: async (options) => {
    try {
      const status = await claudeCodeImportApi.getStatus()
      set((state) => ({
        status,
        job: status.job ?? state.job,
        promptOpen: state.promptOpen || (!!options?.openPrompt && status.offer),
      }))
      // An import started before the page was reloaded keeps reporting progress.
      if (status.job?.state === 'running' && !pollTimer) schedulePoll(get, set)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  startImport: async () => {
    set({ error: null })
    try {
      const { job } = await claudeCodeImportApi.start()
      set({ job })
      if (job.state === 'running') schedulePoll(get, set)
      else if (job.state === 'done') await reloadImportedData()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  skip: async () => {
    set({ error: null })
    try {
      await claudeCodeImportApi.skip()
      set({ promptOpen: false })
      await get().fetchStatus()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  closePrompt: () => set({ promptOpen: false }),
}))

/** Polls until the job ends. A failed poll is retried with backoff, so the prompt never stays stuck on a running job. */
function schedulePoll(
  get: () => ClaudeCodeImportStore,
  set: (partial: Partial<ClaudeCodeImportStore>) => void,
  delay = POLL_INTERVAL_MS,
) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(async () => {
    pollTimer = null
    try {
      const status = await claudeCodeImportApi.getStatus()
      set({ status, job: status.job, error: null })
      if (status.job?.state === 'running') {
        schedulePoll(get, set)
      } else if (status.job?.state === 'done') {
        await reloadImportedData()
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      schedulePoll(get, set, Math.min(delay * 2, MAX_POLL_INTERVAL_MS))
    }
  }, delay)
}

/** Shows the imported providers, sessions and settings without a restart. */
async function reloadImportedData() {
  await Promise.allSettled([
    useProviderStore.getState().fetchProviders(),
    useSessionStore.getState().fetchSessions(),
    useSettingsStore.getState().fetchAll(),
  ])
}
