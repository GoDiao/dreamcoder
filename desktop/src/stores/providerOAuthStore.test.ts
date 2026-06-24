import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startMock, statusMock, logoutMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  statusMock: vi.fn(),
  logoutMock: vi.fn(),
}))

vi.mock('../api/providerOAuth', () => ({
  providerOAuthApi: {
    start: startMock,
    status: statusMock,
    logout: logoutMock,
  },
}))

import { useProviderOAuthStore } from './providerOAuthStore'

const initialState = useProviderOAuthStore.getState()

describe('providerOAuthStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    startMock.mockReset()
    statusMock.mockReset()
    logoutMock.mockReset()
    useProviderOAuthStore.setState({
      ...initialState,
      status: null,
      isPolling: false,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    useProviderOAuthStore.getState().stopPolling()
    useProviderOAuthStore.setState(initialState)
    vi.useRealTimers()
  })

  it('login does not start polling until the browser launch succeeds', async () => {
    startMock.mockResolvedValue({
      authorizeUrl: 'http://localhost:3456/api/provider-oauth/callback',
      state: 'state-123',
    })

    const result = await useProviderOAuthStore.getState().login()

    expect(result.authorizeUrl).toContain('/api/provider-oauth/callback')
    expect(useProviderOAuthStore.getState().isPolling).toBe(false)
  })

  it('startPolling stops after the status becomes logged in', async () => {
    statusMock
      .mockResolvedValueOnce({ loggedIn: false })
      .mockResolvedValueOnce({
        loggedIn: true,
        expiresAt: Date.now() + 60_000,
        scopes: ['user:inference'],
        subscriptionType: 'max',
      })

    useProviderOAuthStore.getState().startPolling()
    expect(useProviderOAuthStore.getState().isPolling).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(useProviderOAuthStore.getState().isPolling).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(useProviderOAuthStore.getState().status).toMatchObject({
      loggedIn: true,
      subscriptionType: 'max',
    })
    expect(useProviderOAuthStore.getState().isPolling).toBe(false)
  })
})
