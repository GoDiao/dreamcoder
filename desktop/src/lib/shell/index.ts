import type { BrowserGrantDecision, BrowserPickValue } from '../../../../src/server/browserHost/protocol'
import type { AppMode, AppModeConfig, BrowserSearchEngineId } from '../../types/settings'
import {
  ELECTRON_BRIDGE_KEY,
  type BrowserRefusal,
  type BrowserResolveResult,
  type ElectronDialogFilter,
  type ElectronOpenDialogInput,
  type ElectronShellBridge,
} from './electronBridge'

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

export type NativeNotificationPermission = NotificationPermission | 'unsupported' | 'unknown' | 'prompt' | 'prompt-with-rationale'

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

export type BrowserBlockedEvent = { guestId: number; url: string; reason: BrowserRefusal }
export type BrowserShortcutEvent = Pick<KeyboardEventInit, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function resolveBrowserInput(input: { input: string; projectRoot: string | null; searchEngine: BrowserSearchEngineId }) {
  return invoke<BrowserResolveResult>('browser_resolve', input)
}

export function openBrowserUrlInSystem(url: string) {
  return invoke<void>('browser_open_in_system', { url })
}

export function openBrowserExternalProtocol(url: string) {
  return invoke<void>('browser_open_protocol', { url })
}

export function clearBrowserData() {
  return invoke<void>('browser_clear_data')
}

export type BrowserSelectionEvent = { guestId: number; text: string; truncated: boolean; title: string; url: string }
export type BrowserMenuLabels = { addToChat: string; copy: string }

export type BrowserPickState = { tabId: string; active: boolean }
export type BrowserPickStarted = { tabId: string; sessionId: string; pickId: string }
export type BrowserPickDone =
  | { tabId: string; sessionId: string; pickId: string; ok: true; generation: number; value: BrowserPickValue }
  | { tabId: string; sessionId: string; pickId: string; ok: false; cancelled: boolean; error?: string }
export type BrowserMarkRequest = { ref: string; generation: number }

export type BrowserViewRegistration = { sessionId: string; tabId: string; webContentsId: number }
export type BrowserViewState = { tabId: string; shown: boolean; active: boolean; foreground: boolean }
export type BrowserOpenTabRequest = { requestId: string; sessionId: string; url: string | null }
export type BrowserActivateRequest = { requestId: string; tabId: string }
export type { BrowserGrantDecision }

function hasBridge() {
  return typeof window !== 'undefined' && ELECTRON_BRIDGE_KEY in window
}

function invokeInDesktop(command: string, args: Record<string, unknown>) {
  return hasBridge() ? invoke<void>(command, args) : Promise.resolve()
}

function listenInDesktop<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  return hasBridge() ? listen<T>(event, handler) : Promise.resolve(() => {})
}

export function setBrowserMenuLabels(labels: BrowserMenuLabels) {
  return invokeInDesktop('browser_set_menu_labels', labels)
}

export function registerBrowserView(input: BrowserViewRegistration) {
  return invokeInDesktop('browser_view_register', input)
}

export function updateBrowserView(input: BrowserViewState) {
  return invokeInDesktop('browser_view_update', input)
}

export function unregisterBrowserView(input: { tabId: string }) {
  return invokeInDesktop('browser_view_unregister', input)
}

export function setBrowserPickMode(input: { tabId: string; active: boolean }) {
  return invokeInDesktop('browser_pick_set', input)
}

export function syncBrowserMarks(input: { tabId: string; refs: BrowserMarkRequest[] }) {
  return hasBridge() ? invoke<string[]>('browser_marks_sync', input) : Promise.resolve(input.refs.map((request) => request.ref))
}

export function stopBrowserControl(input: { sessionId: string }) {
  return invokeInDesktop('browser_stop', input)
}

export function finishBrowserOpenTab(input: { requestId: string; tabId: string }) {
  return invokeInDesktop('browser_open_tab_done', input)
}

export function finishBrowserActivate(input: { requestId: string; shown: boolean }) {
  return invokeInDesktop('browser_activate_done', input)
}

export function replyBrowserGrant(input: { requestId: string; decision: BrowserGrantDecision }) {
  return invoke<void>('browser_grant_reply', input)
}

export function listTrustedBrowserOrigins() {
  return invoke<string[]>('browser_trust_list')
}

export function trustBrowserOrigin(origin: string) {
  return invoke<string[]>('browser_trust_add', { origin })
}

export function untrustBrowserOrigin(origin: string) {
  return invoke<string[]>('browser_trust_remove', { origin })
}

export function onBrowserOpenTabRequest(handler: (request: BrowserOpenTabRequest) => void) {
  return listenInDesktop<BrowserOpenTabRequest>('browser-open-tab-request', handler)
}

export function onBrowserActivateRequest(handler: (request: BrowserActivateRequest) => void) {
  return listenInDesktop<BrowserActivateRequest>('browser-activate-request', handler)
}

export function onBrowserBlocked(handler: (event: BrowserBlockedEvent) => void): Promise<Unlisten> {
  return listen<BrowserBlockedEvent>('browser-blocked', handler)
}

export function onBrowserExternalRequest(handler: (event: { url: string }) => void): Promise<Unlisten> {
  return listen<{ url: string }>('browser-external-request', handler)
}

export function onBrowserSelection(handler: (event: BrowserSelectionEvent) => void) {
  return listenInDesktop<BrowserSelectionEvent>('browser-selection', handler)
}

export function onBrowserPickState(handler: (event: BrowserPickState) => void) {
  return listenInDesktop<BrowserPickState>('browser-pick-state', handler)
}

export function onBrowserPickStarted(handler: (event: BrowserPickStarted) => void) {
  return listenInDesktop<BrowserPickStarted>('browser-pick-started', handler)
}

export function onBrowserPickDone(handler: (event: BrowserPickDone) => void) {
  return listenInDesktop<BrowserPickDone>('browser-pick-done', handler)
}

export function onBrowserShortcut(handler: (event: BrowserShortcutEvent) => void): Promise<Unlisten> {
  return listen<BrowserShortcutEvent>('browser-shortcut', handler)
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

function supportedPermission(whenSupported: 'granted' | 'unknown'): Promise<NativeNotificationPermission> {
  return invoke<boolean>('notification_supported').then((supported) => (supported ? whenSupported : 'unsupported'))
}

export function getWindowsNotificationPermission() {
  return invoke<boolean>('notification_supported')
}

export function requestWindowsNotificationPermission() {
  return supportedPermission('granted')
}

export function getMacNotificationPermission() {
  return supportedPermission('unknown')
}

export function requestMacNotificationPermission() {
  return supportedPermission('unknown')
}

export function sendMacNotification(input: { title: string; body?: string; target?: string }) {
  return invoke<boolean>('notification_send', { title: input.title, body: input.body, clickPayload: input.target })
}

export function openNotificationSettings() {
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
