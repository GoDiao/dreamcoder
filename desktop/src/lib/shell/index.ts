import type { AppMode, AppModeConfig } from '../../types/settings'

export type Unlisten = () => void

export type AppWindow = {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onResized: (handler: () => void) => Promise<Unlisten>
  startDragging: () => Promise<void>
  show: () => Promise<void>
  setFocus: () => Promise<void>
}

export type FileDropPosition = { x: number; y: number }

export type FileDropPayload =
  | { type: 'enter'; paths: string[]; position: FileDropPosition }
  | { type: 'drop'; paths: string[]; position: FileDropPosition }
  | { type: 'over'; position: FileDropPosition }
  | { type: 'leave' }
  | { type: 'cancel' }

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

type FilePickerOptions = {
  title?: string
  directory?: false
  multiple?: false
  filters?: Array<{ name: string; extensions: string[] }>
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core')
  return core.invoke<T>(command, args)
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
  return invoke<void>('prepare_for_app_mode_restart')
}

export function setAppZoom(input: { zoomFactor: number }) {
  return invoke<void>('set_app_zoom', input)
}

export function writeSessionExport(input: { path: string; contents: string }) {
  return invoke<void>('write_session_export', input)
}

export function prepareUpdateInstall() {
  return invoke<void>('prepare_for_update_install')
}

export function cancelUpdateInstall() {
  return invoke<void>('cancel_update_install')
}

export async function relaunchApp() {
  const process = await import('@tauri-apps/plugin-process')
  return process.relaunch()
}

export async function getAppVersion() {
  const app = await import('@tauri-apps/api/app')
  return app.getVersion()
}

export async function checkForAppUpdate(options?: { proxy: string }): Promise<ShellUpdate | null> {
  const updater = await import('@tauri-apps/plugin-updater')
  return updater.check(options)
}

export async function pickDirectory(options: { title?: string; directory?: true; multiple?: false }) {
  const dialog = await import('@tauri-apps/plugin-dialog')
  return dialog.open({ ...options, directory: true, multiple: false })
}

export async function pickFile(options: FilePickerOptions) {
  const dialog = await import('@tauri-apps/plugin-dialog')
  return dialog.open({ ...options, directory: false, multiple: false })
}

export async function pickFiles(options: { multiple?: true; directory?: false }) {
  const dialog = await import('@tauri-apps/plugin-dialog')
  return dialog.open({ ...options, multiple: true, directory: false })
}

export async function pickExportPath(options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) {
  const dialog = await import('@tauri-apps/plugin-dialog')
  return dialog.save(options)
}

export async function openExternalLink(url: string) {
  const shell = await import('@tauri-apps/plugin-shell')
  return shell.open(url)
}

export async function getAppWindow(): Promise<AppWindow> {
  const window = await import('@tauri-apps/api/window')
  return window.getCurrentWindow()
}

export async function requestAppAttention() {
  const window = await import('@tauri-apps/api/window')
  return window.getCurrentWindow().requestUserAttention(window.UserAttentionType.Critical)
}

export async function onFileDrop(handler: (event: { payload: FileDropPayload }) => void): Promise<Unlisten> {
  const webview = await import('@tauri-apps/api/webview')
  return webview.getCurrentWebview().onDragDropEvent(handler)
}

export async function onMenuNavigate(handler: (event: { payload: string }) => void): Promise<Unlisten> {
  const events = await import('@tauri-apps/api/event')
  return events.listen<string>('native-menu-navigate', handler)
}

export function getWindowsNotificationPermission() {
  return invoke<boolean | null>('plugin:notification|is_permission_granted')
}

export function requestWindowsNotificationPermission() {
  return invoke<NativeNotificationPermission>('plugin:notification|request_permission')
}

export function getMacNotificationPermission() {
  return invoke<NativeNotificationPermission>('macos_notification_permission_state')
}

export function requestMacNotificationPermission() {
  return invoke<NativeNotificationPermission>('macos_request_notification_permission')
}

export function sendMacNotification(input: { title: string; body?: string; target?: string }) {
  return invoke<boolean>('macos_send_notification', input)
}

export function openWindowsNotificationSettings() {
  return invoke<boolean>('open_windows_notification_settings')
}

export async function isNotificationPermissionGranted() {
  const notification = await import('@tauri-apps/plugin-notification')
  return notification.isPermissionGranted()
}

export async function requestNotificationPermission() {
  const notification = await import('@tauri-apps/plugin-notification')
  return notification.requestPermission()
}

export async function sendNotification(input: { title: string; body?: string; id?: number; extra?: Record<string, unknown> }) {
  const notification = await import('@tauri-apps/plugin-notification')
  notification.sendNotification(input)
}

export async function onNotificationClicked(handler: (event: { payload: unknown }) => void): Promise<Unlisten> {
  const events = await import('@tauri-apps/api/event')
  return events.listen<unknown>('desktop-notification-clicked', handler)
}

export async function onNotificationAction(handler: (notification: unknown) => void): Promise<Unlisten> {
  const notification = await import('@tauri-apps/plugin-notification')
  const listener = await notification.onAction(handler)
  return () => { void listener.unregister() }
}
