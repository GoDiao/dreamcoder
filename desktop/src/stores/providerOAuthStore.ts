// desktop/src/stores/providerOAuthStore.ts

import { create } from 'zustand'
import { providerOAuthApi, type ProviderOAuthStatus } from '../api/providerOAuth'

const POLL_INTERVAL_MS = 2_000

export type OAuthStoreState<TStatus> = {
  status: TStatus | null
  isPolling: boolean
  isLoading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  login: () => Promise<{ authorizeUrl: string }>
  logout: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export type OAuthApi<TStatus> = {
  start: () => Promise<{ authorizeUrl: string; state: string }>
  status: () => Promise<TStatus>
  logout: () => Promise<{ ok: boolean }>
}

export function createOAuthStore<TStatus>(api: OAuthApi<TStatus>) {
  return create<OAuthStoreState<TStatus>>((set, get) => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    return {
      status: null,
      isPolling: false,
      isLoading: false,
      error: null,

      fetchStatus: async () => {
        try {
          const status = await api.status()
          set({ status, error: null })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) })
        }
      },

      login: async () => {
        set({ isLoading: true, error: null })
        try {
          const res = await api.start()
          set({ isLoading: false })
          return { authorizeUrl: res.authorizeUrl }
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      },

      logout: async () => {
        get().stopPolling()
        set({ isLoading: true, error: null })
        try {
          await api.logout()
          set({ status: { loggedIn: false } as TStatus, isLoading: false })
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      },

      startPolling: () => {
        if (pollTimer) return
        set({ isPolling: true })

        const scheduleNext = () => {
          pollTimer = setTimeout(async () => {
            pollTimer = null
            await get().fetchStatus()
            const cur = get().status
            if (cur && (cur as { loggedIn: boolean }).loggedIn) {
              get().stopPolling()
              return
            }
            if (get().isPolling) {
              scheduleNext()
            }
          }, POLL_INTERVAL_MS)
        }
        scheduleNext()
      },

      stopPolling: () => {
        if (pollTimer) {
          clearTimeout(pollTimer)
          pollTimer = null
        }
        set({ isPolling: false })
      },
    }
  })
}

export const useProviderOAuthStore = createOAuthStore<ProviderOAuthStatus>(providerOAuthApi)
