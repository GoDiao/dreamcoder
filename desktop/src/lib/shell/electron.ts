import type { AppMode, AppModeConfig } from '../../types/settings'
import type {
  AppWindow,
  FileDropPayload,
  NativeNotificationPermission,
  ShellUpdate,
  Unlisten,
} from './index'
import { ELECTRON_BRIDGE_KEY, type ElectronDialogFilter, type ElectronOpenDialogInput, type ElectronShellBridge } from './electronBridge'

export type {
  AppWindow,
  FileDropPayload,
  FileDropPosition,
  NativeNotificationPermission,
  ShellUpdate,
  Unlisten,
  UpdateDownloadEvent,
} from './index'

function bridge(): ElectronShellBridge {
  const value = (window as unknown as Record<string, ElectronShellBridge | undefined>)[ELECTRON_BRIDGE_KEY]
  if (!value) throw new Error('Electron shell bridge is not available')
  return value
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return bridge().invoke<T>(command, args)
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  return bridge().listen(event, (payload) => handler(payload as T))
}

function notImplemented(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} is not implemented in the Electron spike`))
}

function openDialog(input: ElectronOpenDialogInput) {
  return invoke<string[] | null>('dialog_open', input)
}

export function getServerUrl() {
  return invoke<string>('get_server_url')
}

export function getAppMode() {
  return invoke<Omit<AppModeConfig, 'activeConfigDir' | 'systemConfigDir'>>('get_app_mode')
}

export function setAppMode(_input: { mode: AppMode; portableDir: string | null }): Promise<void> {
  return notImplemented('setAppMode')
}

export function prepareAppModeRestart(): Promise<void> {
  return notImplemented('prepareAppModeRestart')
}

export function setAppZoom(input: { zoomFactor: number }) {
  return invoke<void>('set_app_zoom', input)
}

export function writeSessionExport(_input: { path: string; contents: string }): Promise<void> {
  return notImplemented('writeSessionExport')
}

export function prepareUpdateInstall(): Promise<void> {
  return notImplemented('prepareUpdateInstall')
}

export function cancelUpdateInstall(): Promise<void> {
  return notImplemented('cancelUpdateInstall')
}

export function relaunchApp() {
  return invoke<void>('relaunch')
}

export function getAppVersion() {
  return invoke<string>('get_app_version')
}

export async function checkForAppUpdate(_options?: { proxy: string }): Promise<ShellUpdate | null> {
  return null
}

export async function pickDirectory(options: { title?: string; directory?: true; multiple?: false }) {
  const paths = await openDialog({ title: options.title, directory: true, multiple: false })
  return paths?.[0] ?? null
}

export async function pickFile(options: { title?: string; directory?: false; multiple?: false; filters?: ElectronDialogFilter[] }) {
  const paths = await openDialog({ title: options.title, directory: false, multiple: false, filters: options.filters })
  return paths?.[0] ?? null
}

export function pickFiles(_options: { multiple?: true; directory?: false }) {
  return openDialog({ directory: false, multiple: true })
}

export function pickExportPath(options: { defaultPath: string; filters: ElectronDialogFilter[] }) {
  return invoke<string | null>('dialog_save', options)
}

export function openExternalLink(url: string) {
  return invoke<void>('open_external', { url })
}

export async function getAppWindow(): Promise<AppWindow> {
  return {
    minimize: () => invoke<void>('window_minimize'),
    toggleMaximize: () => invoke<void>('window_toggle_maximize'),
    close: () => invoke<void>('window_close'),
    isMaximized: () => invoke<boolean>('window_is_maximized'),
    onResized: (handler) => listen<void>('window-resized', handler),
    startDragging: () => notImplemented('startDragging'),
    show: () => invoke<void>('window_show'),
    setFocus: () => invoke<void>('window_focus'),
  }
}

export function requestAppAttention() {
  return invoke<void>('request_attention')
}

export async function onFileDrop(_handler: (event: { payload: FileDropPayload }) => void): Promise<Unlisten> {
  return () => {}
}

export function onMenuNavigate(handler: (event: { payload: string }) => void): Promise<Unlisten> {
  return listen<string>('native-menu-navigate', (payload) => handler({ payload }))
}

export function getWindowsNotificationPermission(): Promise<boolean | null> {
  return notImplemented('getWindowsNotificationPermission')
}

export function requestWindowsNotificationPermission(): Promise<NativeNotificationPermission> {
  return notImplemented('requestWindowsNotificationPermission')
}

export function getMacNotificationPermission(): Promise<NativeNotificationPermission> {
  return notImplemented('getMacNotificationPermission')
}

export function requestMacNotificationPermission(): Promise<NativeNotificationPermission> {
  return notImplemented('requestMacNotificationPermission')
}

export function sendMacNotification(_input: { title: string; body?: string; target?: string }): Promise<boolean> {
  return notImplemented('sendMacNotification')
}

export function openWindowsNotificationSettings(): Promise<boolean> {
  return notImplemented('openWindowsNotificationSettings')
}

export function isNotificationPermissionGranted(): Promise<boolean> {
  return notImplemented('isNotificationPermissionGranted')
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  return notImplemented('requestNotificationPermission')
}

export function sendNotification(_input: { title: string; body?: string; id?: number; extra?: Record<string, unknown> }): Promise<void> {
  return notImplemented('sendNotification')
}

export function onNotificationClicked(_handler: (event: { payload: unknown }) => void): Promise<Unlisten> {
  return notImplemented('onNotificationClicked')
}

export function onNotificationAction(_handler: (notification: unknown) => void): Promise<Unlisten> {
  return notImplemented('onNotificationAction')
}
