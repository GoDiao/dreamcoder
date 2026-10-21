import { api } from './client'
import type { DefaultPermissionMode, UserSettings } from '../types/settings'

export type CliLauncherStatus = {
  supported: boolean
  command: string
  installed: boolean
  launcherPath: string
  binDir: string
  pathConfigured: boolean
  pathInCurrentShell: boolean
  availableInNewTerminals: boolean
  needsTerminalRestart: boolean
  configTarget: string | null
  lastError: string | null
}

export const settingsApi = {
  getUser() {
    return api.get<UserSettings>('/api/settings/user')
  },

  updateUser(settings: Partial<UserSettings>) {
    return api.put<{ ok: true }>('/api/settings/user', settings)
  },

  getPermissionMode() {
    return api.get<{ mode: DefaultPermissionMode }>('/api/permissions/mode')
  },

  setPermissionMode(mode: DefaultPermissionMode) {
    return api.put<{ ok: true; mode: DefaultPermissionMode }>('/api/permissions/mode', { mode })
  },

  getCliLauncherStatus() {
    return api.get<CliLauncherStatus>('/api/settings/cli-launcher')
  },
}
