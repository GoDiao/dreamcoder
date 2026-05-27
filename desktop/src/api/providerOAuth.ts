// desktop/src/api/providerOAuth.ts

import { api, getBaseUrl } from './client'

export type ProviderOAuthStatus =
  | { loggedIn: false }
  | {
      loggedIn: true
      expiresAt: number | null
      scopes: string[]
      subscriptionType: 'pro' | 'max' | 'team' | 'enterprise' | null
    }

export function currentServerPort(): number {
  const port = new URL(getBaseUrl()).port
  const parsed = Number.parseInt(port, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Cannot determine server port from baseUrl: ${getBaseUrl()}`)
  }
  return parsed
}

export const providerOAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string; state: string }>(
      '/api/provider-oauth/start',
      { serverPort: currentServerPort() },
    )
  },

  status() {
    return api.get<ProviderOAuthStatus>('/api/provider-oauth')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/provider-oauth')
  },
}
