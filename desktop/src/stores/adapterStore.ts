import { create } from 'zustand'
import { adaptersApi } from '../api/adapters'
import type { AdapterFileConfig } from '../types/adapter'
import type { DingtalkRegistrationBegin, DingtalkRegistrationPoll } from '../api/adapters'

async function notifyTauriRestartAdapters(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('restart_adapters_sidecar')
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[adapterStore] restart_adapters_sidecar failed:', err)
    }
  }
}

const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const CODE_TTL_MS = 60 * 60 * 1000

function generateCode(): string {
  const maxValid = Math.floor(256 / SAFE_ALPHABET.length) * SAFE_ALPHABET.length
  let code = ''
  while (code.length < CODE_LENGTH) {
    const array = new Uint8Array(1)
    crypto.getRandomValues(array)
    if (array[0]! < maxValid) {
      code += SAFE_ALPHABET[array[0]! % SAFE_ALPHABET.length]
    }
  }
  return code
}

type AdapterStore = {
  config: AdapterFileConfig
  isLoading: boolean
  error: string | null

  fetchConfig: () => Promise<void>
  updateConfig: (patch: Partial<AdapterFileConfig>) => Promise<void>
  generatePairingCode: () => Promise<string>
  startWechatLogin: () => Promise<{ qrcodeUrl?: string; message: string; sessionKey: string }>
  pollWechatLogin: (sessionKey: string) => Promise<{ connected: boolean; status?: string; message?: string }>
  removePairedUser: (platform: 'telegram' | 'feishu' | 'wechat' | 'dingtalk', userId: string | number) => Promise<void>
  beginDingtalkRegistration: () => Promise<DingtalkRegistrationBegin>
  pollDingtalkRegistration: (deviceCode: string) => Promise<DingtalkRegistrationPoll>
  unbindWechatAccount: () => Promise<void>
  unbindDingtalkBot: () => Promise<void>
}

export const useAdapterStore = create<AdapterStore>((set, get) => ({
  config: {},
  isLoading: false,
  error: null,

  fetchConfig: async () => {
    set({ isLoading: true, error: null })
    try {
      const config = await adaptersApi.getConfig()
      set({ config, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load config'
      set({ isLoading: false, error: message })
    }
  },

  updateConfig: async (patch) => {
    const config = await adaptersApi.updateConfig(patch)
    set({ config })
    void notifyTauriRestartAdapters()
  },

  generatePairingCode: async () => {
    const code = generateCode()
    const now = Date.now()
    await get().updateConfig({
      pairing: {
        code,
        expiresAt: now + CODE_TTL_MS,
        createdAt: now,
      },
    })
    return code
  },

  startWechatLogin: async () => {
    return adaptersApi.startWechatLogin()
  },

  pollWechatLogin: async (sessionKey) => {
    const result = await adaptersApi.pollWechatLogin(sessionKey)
    if ('connected' in result && result.connected === false) {
      return { connected: false, status: result.status, message: result.message }
    }
    if ('wechat' in result || 'telegram' in result || 'feishu' in result || 'dingtalk' in result) {
      set({ config: result })
      void notifyTauriRestartAdapters()
      return { connected: true }
    }
    return { connected: false }
  },

  beginDingtalkRegistration: () => adaptersApi.beginDingtalkRegistration(),

  pollDingtalkRegistration: async (deviceCode) => {
    const result = await adaptersApi.pollDingtalkRegistration(deviceCode)
    if (result.config) {
      set({ config: result.config })
      void notifyTauriRestartAdapters()
    }
    return result
  },

  unbindWechatAccount: async () => {
    const config = await adaptersApi.unbindWechat()
    set({ config })
    void notifyTauriRestartAdapters()
  },

  unbindDingtalkBot: async () => {
    const config = await adaptersApi.unbindDingtalk()
    set({ config })
    void notifyTauriRestartAdapters()
  },

  removePairedUser: async (platform, userId) => {
    const { config } = get()
    const platformConfig = config[platform]
    if (!platformConfig) return

    const pairedUsers = (platformConfig.pairedUsers ?? []).filter(
      (u) => String(u.userId) !== String(userId),
    )

    await get().updateConfig({
      [platform]: { ...platformConfig, pairedUsers },
    })
  },
}))
