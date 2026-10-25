import type { AppMode, AppModeConfig } from '../../types/settings'
import { ELECTRON_BRIDGE_KEY, type ElectronDialogFilter, type ElectronOpenDialogInput, type ElectronShellBridge } from './electronBridge'

export type Unlisten = () => void

export type AppWindow = {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onResized: (handler: () => void) => Promise<Unlisten>
  show: () => Promise<void>
  setFocus: () => Promise<void>
}

export type UpdateDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export type ShellUpdate = {
  version: string
  body?: string
  download: (onEvent: (event: UpdateDownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
  close: () => Promise<void>
}

export type NativeNotificationPermission = NotificationPermission | 'unsupported' | 'prompt' | 'prompt-with-rationale'

function bridge(): ElectronShellBridge {
  const value = (window as unknown as Record<string, ElectronShellBridge | undefined>)[ELECTRON_BRIDGE_KEY]
  if (!value) throw new Error('Electron shell bridge is not available')
  return value
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return bridge().invoke<T>(command, args)
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  return bridge().listen(event, (payload) => handler(payload as T))
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

export function setAppMode(input: { mode: AppMode; portableDir: string | null }) {
  return invoke<void>('set_app_mode', input)
}

export function prepareAppModeRestart() {
  return invoke<void>('prepare_app_mode_restart')
}

export function setAppZoom(input: { zoomFactor: number }) {
  return invoke<void>('set_app_zoom', input)
}

export function writeSessionExport(input: { path: string; contents: string }) {
  return invoke<void>('write_session_export', input)
}

export function prepareUpdateInstall() {
  return invoke<void>('prepare_update_install')
}

export function cancelUpdateInstall() {
  return invoke<void>('cancel_update_install')
}

export function relaunchApp() {
  return invoke<void>('relaunch')
}

export function getAppVersion() {
  return invoke<string>('get_app_version')
}

export async function checkForAppUpdate(_options?: { proxy: string }): Promise<ShellUpdate | null> {
  throw new Error('Automatic updates are not configured for this build.')
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
    show: () => invoke<void>('window_show'),
    setFocus: () => invoke<void>('window_focus'),
  }
}

export function requestAppAttention() {
  return invoke<void>('request_attention')
}

export function getFilePath(file: File): string | undefined {
  return bridge().pathForFile(file) || undefined
}

export function onMenuNavigate(handler: (event: { payload: string }) => void): Promise<Unlisten> {
  return listen<string>('native-menu-navigate', (payload) => handler({ payload }))
}

function supportedPermission(): Promise<NativeNotificationPermission> {
  return invoke<boolean>('notification_supported').then((supported) => (supported ? 'granted' : 'unsupported'))
}

export function getWindowsNotificationPermission() {
  return invoke<boolean>('notification_supported')
}

export function requestWindowsNotificationPermission() {
  return supportedPermission()
}

export function getMacNotificationPermission() {
  return supportedPermission()
}

export function requestMacNotificationPermission() {
  return supportedPermission()
}

export function sendMacNotification(input: { title: string; body?: string; target?: string }) {
  return invoke<boolean>('notification_send', { title: input.title, body: input.body, clickPayload: input.target })
}

export function openWindowsNotificationSettings() {
  return invoke<boolean>('open_notification_settings')
}

export function isNotificationPermissionGranted() {
  return invoke<boolean>('notification_supported')
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return (await invoke<boolean>('notification_supported')) ? 'granted' : 'denied'
}

export async function sendNotification(input: { title: string; body?: string; id?: number; extra?: Record<string, unknown> }) {
  await invoke<boolean>('notification_send', { title: input.title, body: input.body, clickPayload: { id: input.id, extra: input.extra } })
}

export function onNotificationClicked(handler: (event: { payload: unknown }) => void): Promise<Unlisten> {
  return listen<unknown>('desktop-notification-clicked', (payload) => handler({ payload }))
}

export async function onNotificationAction(_handler: (notification: unknown) => void): Promise<Unlisten> {
  return () => {}
}
