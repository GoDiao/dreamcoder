import { api } from './client'

export type PermissionState = 'granted' | 'denied' | 'unknown'

export type InstallPhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'disabling_telemetry'
  | 'checking_version'
  | 'done'
  | 'failed'

export type InstallProgress = {
  phase: InstallPhase
  startedAt: string
  finishedAt?: string
  output: string[]
  error?: string
}

export type CuaDriverInstallState =
  | 'not_installed'
  | 'installing'
  | 'installed'
  | 'outdated'
  | 'missing_executable'

export type ComputerUseStatus = {
  platform: string
  platformSupported: boolean
  state: CuaDriverInstallState
  verifiedVersion: string
  version: string | null
  newerThanVerified: boolean
  path: string | null
  source: 'custom' | 'existing' | 'dreamcoder' | null
  install: InstallProgress | null
  permissions: { accessibility: PermissionState; screenRecording: PermissionState } | null
  telemetry: 'enabled' | 'disabled' | 'unknown'
  enabled: boolean
  driverPath: string | null
  conflicts: { reservedName: boolean; duplicates: string[] }
  legacyRuntime: { present: boolean; path: string; bytes: number }
}

export type ComputerUseConfig = {
  enabled: boolean
  driverPath: string | null
}

export type CommandOutput = { ok: boolean; output: string }

export const computerUseApi = {
  getStatus() {
    return api.get<ComputerUseStatus>('/api/computer-use/status', { timeout: 60_000 })
  },
  /** `enableOnSuccess`: the server turns Computer Use on when the install succeeds. */
  install(enableOnSuccess = false) {
    return api.post<InstallProgress>('/api/computer-use/install', { enableOnSuccess })
  },
  getConfig() {
    return api.get<ComputerUseConfig>('/api/computer-use/config')
  },
  updateConfig(config: Partial<ComputerUseConfig>) {
    return api.put<ComputerUseConfig>('/api/computer-use/config', config)
  },
  grantPermissions() {
    return api.post<CommandOutput & { permissions: ComputerUseStatus['permissions'] }>(
      '/api/computer-use/permissions/grant',
      undefined,
      { timeout: 180_000 },
    )
  },
  doctor() {
    return api.get<CommandOutput>('/api/computer-use/doctor', { timeout: 90_000 })
  },
  disableTelemetry() {
    return api.post<{ telemetry: ComputerUseStatus['telemetry'] }>('/api/computer-use/telemetry/disable')
  },
  openSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
    return api.post<{ ok: true }>('/api/computer-use/open-settings', { pane })
  },
  cleanupLegacyRuntime() {
    return api.post<ComputerUseStatus['legacyRuntime']>('/api/computer-use/legacy-runtime/cleanup')
  },
}
