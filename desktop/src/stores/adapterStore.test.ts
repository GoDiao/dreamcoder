import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('adapterStore IM pairing behavior', () => {
  const adaptersApi = {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    startWechatLogin: vi.fn(),
    pollWechatLogin: vi.fn(),
    unbindWechat: vi.fn(),
    unbindDingtalk: vi.fn(),
    beginDingtalkRegistration: vi.fn(),
    pollDingtalkRegistration: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    adaptersApi.updateConfig.mockImplementation(async (patch) => patch)
    vi.doMock('../api/adapters', () => ({ adaptersApi }))
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
  })

  it('removes a WeChat paired user without clearing the bound account', async () => {
    const { useAdapterStore } = await import('./adapterStore')
    useAdapterStore.setState({
      config: {
        wechat: {
          accountId: 'wx-account',
          botToken: '****oken',
          userId: 'wx-login-user',
          pairedUsers: [
            { userId: 'wx-user-1', displayName: 'User 1', pairedAt: 1 },
            { userId: 'wx-user-2', displayName: 'User 2', pairedAt: 2 },
          ],
        },
      },
    })

    await useAdapterStore.getState().removePairedUser('wechat', 'wx-user-1')

    expect(adaptersApi.unbindWechat).not.toHaveBeenCalled()
    expect(adaptersApi.updateConfig).toHaveBeenCalledWith({
      wechat: {
        accountId: 'wx-account',
        botToken: '****oken',
        userId: 'wx-login-user',
        pairedUsers: [{ userId: 'wx-user-2', displayName: 'User 2', pairedAt: 2 }],
      },
    })
  })

  it('unbinds the WeChat account only through the explicit account action', async () => {
    const nextConfig = { wechat: { pairedUsers: [] } }
    adaptersApi.unbindWechat.mockResolvedValue(nextConfig)

    const { useAdapterStore } = await import('./adapterStore')

    await useAdapterStore.getState().unbindWechatAccount()

    expect(adaptersApi.unbindWechat).toHaveBeenCalledTimes(1)
    expect(useAdapterStore.getState().config).toBe(nextConfig)
  })

  it('unbinds the DingTalk bot through the explicit bot action', async () => {
    const nextConfig = { dingtalk: { pairedUsers: [], allowedUsers: [] } }
    adaptersApi.unbindDingtalk.mockResolvedValue(nextConfig)

    const { useAdapterStore } = await import('./adapterStore')

    await useAdapterStore.getState().unbindDingtalkBot()

    expect(adaptersApi.updateConfig).not.toHaveBeenCalled()
    expect(adaptersApi.unbindDingtalk).toHaveBeenCalledTimes(1)
    expect(useAdapterStore.getState().config).toBe(nextConfig)
  })
})
