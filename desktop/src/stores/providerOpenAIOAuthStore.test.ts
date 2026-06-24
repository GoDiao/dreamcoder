import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startMock, statusMock, logoutMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  statusMock: vi.fn(),
  logoutMock: vi.fn(),
}))

vi.mock('../api/providerOpenAIOauth', () => ({
  providerOpenAIOAuthApi: {
    start: startMock,
    status: statusMock,
    logout: logoutMock,
  },
}))

import { useProviderOpenAIOAuthStore } from './providerOpenAIOAuthStore'

const initialState = useProviderOpenAIOAuthStore.getState()

describe('providerOpenAIOAuthStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    startMock.mockReset()
    statusMock.mockReset()
    logoutMock.mockReset()
    useProviderOpenAIOAuthStore.setState({
      ...initialState,
      status: null,
      isPolling: false,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    useProviderOpenAIOAuthStore.getState().stopPolling()
    useProviderOpenAIOAuthStore.setState(initialState)
    vi.useRealTimers()
  })

  it('login returns authorizeUrl without starting polling', async () => {
    startMock.mockResolvedValue({
      authorizeUrl: 'http://localhost:3456/callback/openai?state=openai-state',
      state: 'openai-state',
    })

    const result = await useProviderOpenAIOAuthStore.getState().login()

    expect(result.authorizeUrl).toContain('/callback/openai')
    expect(useProviderOpenAIOAuthStore.getState().isPolling).toBe(false)
  })

  it('startPolling stops after OpenAI OAuth status becomes logged in', async () => {
    statusMock
      .mockResolvedValueOnce({ loggedIn: false })
      .mockResolvedValueOnce({
        loggedIn: true,
        expiresAt: Date.now() + 60_000,
        email: 'user@example.com',
        accountId: 'acct_123',
      })

    useProviderOpenAIOAuthStore.getState().startPolling()
    expect(useProviderOpenAIOAuthStore.getState().isPolling).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(useProviderOpenAIOAuthStore.getState().isPolling).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(useProviderOpenAIOAuthStore.getState().status).toMatchObject({
      loggedIn: true,
      email: 'user@example.com',
      accountId: 'acct_123',
    })
    expect(useProviderOpenAIOAuthStore.getState().isPolling).toBe(false)
  })

  it('logout clears status and stops polling', async () => {
    logoutMock.mockResolvedValue({ ok: true })
    useProviderOpenAIOAuthStore.setState({
      status: {
        loggedIn: true,
        expiresAt: Date.now() + 60_000,
        email: 'user@example.com',
        accountId: 'acct_123',
      },
    })
    useProviderOpenAIOAuthStore.getState().startPolling()

    await useProviderOpenAIOAuthStore.getState().logout()

    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(useProviderOpenAIOAuthStore.getState().status).toEqual({ loggedIn: false })
    expect(useProviderOpenAIOAuthStore.getState().isPolling).toBe(false)
  })
})
