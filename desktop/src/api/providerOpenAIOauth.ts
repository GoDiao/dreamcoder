// desktop/src/api/providerOpenAIOauth.ts

import { api, getBaseUrl } from './client'

import { currentServerPort } from './providerOAuth'

export type ProviderOpenAIOAuthStatus =
  | { loggedIn: false }
  | {
      loggedIn: true
      expiresAt: number | null
      email: string | null
      accountId: string | null
    }

export const providerOpenAIOAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string; state: string }>(
      '/api/provider-openai-oauth/start',
      { serverPort: currentServerPort() },
    )
  },

  status() {
    return api.get<ProviderOpenAIOAuthStatus>('/api/provider-openai-oauth')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/provider-openai-oauth')
  },
}
