import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  screen,
  session,
  shell,
  Tray,
  webContents,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
} from 'electron'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BROWSER_GRANT_DECISIONS, BROWSER_HOST_PATH, type BrowserGrantDecision } from '../../src/server/browserHost/protocol'
import { BROWSER_PARTITION, type ElectronDialogFilter, type ElectronOpenDialogInput } from '../src/lib/shell/electronBridge'
import {
  appModeLocations,
  clearPortableEnvForRestart,
  CONFIG_DIR_ENV,
  currentAppMode,
  determineStartupPortableDir,
  electronUserDataDir,
  PORTABLE_MARKER_ENV,
  setAppMode,
} from './appMode'
import {
  classifyUrl,
  installBrowser,
  PROJECT_SCHEME,
  ProjectRoots,
  resolveBrowserInput,
  systemTargetFor,
  type SelectionMenuLabels,
} from './browser'
import { createBrowserHost, type BrowserHostHandle, type MarkRequest } from './browserHost'
import { isAllowedFrameNavigation } from './frameNavigation'
import { writeSessionExport } from './sessionExport'
import { devSidecarPaths, startSidecar, type SidecarPaths, type SidecarRuntime } from './sidecar'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  readWindowState,
  restorableBounds,
  WINDOW_STATE_FILE,
  writeWindowState,
} from './windowState'

const APP_ID = 'com.dreamcoder.desktop'
const APP_SCHEME = 'dreamcoder'
const APP_ORIGIN = `${APP_SCHEME}://localhost`
const DEV_URL = process.env.DREAMCODER_ELECTRON_DEV_URL
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* ws://localhost:* http://localhost:*",
  "media-src 'self' blob:",
  "frame-src http://127.0.0.1:* http://localhost:*",
].join('; ')
const WINDOW_STATE_SAVE_DELAY_MS = 300
const IS_MAC = process.platform === 'darwin'
const IS_WINDOWS = process.platform === 'win32'

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: PROJECT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const locations = appModeLocations(process.execPath, app.getPath('userData'))
const startupPortableDir = determineStartupPortableDir(process.env, locations)
if (startupPortableDir) {
  process.env[CONFIG_DIR_ENV] = startupPortableDir
  process.env[PORTABLE_MARKER_ENV] = '1'
}
if (process.env[CONFIG_DIR_ENV]) {
  app.setPath('userData', electronUserDataDir(process.env[CONFIG_DIR_ENV]))
}

const projectRoots = new ProjectRoots()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let sidecar: SidecarRuntime | null = null
let sidecarError: string | null = null
let browserHost: BrowserHostHandle | null = null
let quitting = false
const activeNotifications = new Set<Notification>()
let saveTimer: NodeJS.Timeout | null = null

function hostTriple() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin'
  if (IS_WINDOWS && process.arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-gnu'
  throw new Error(`unsupported platform: ${process.platform}-${process.arch}`)
}

type AppPaths = SidecarPaths & { webDist: string; trayIcon: string }

function resolvePaths(): AppPaths {
  const exe = IS_WINDOWS ? '.exe' : ''
  if (app.isPackaged) {
    const binDir = path.join(process.resourcesPath, 'bin')
    const dist = path.join(process.resourcesPath, 'dist')
    return {
      binary: path.join(binDir, `dreamcoder-sidecar${exe}`),
      appRoot: binDir,
      h5DistDir: dist,
      webDist: dist,
      trayIcon: path.join(process.resourcesPath, 'icons', 'tray.png'),
    }
  }
  const desktopRoot = path.resolve(app.getAppPath(), '..')
  const dist = path.join(desktopRoot, 'dist')
  return {
    ...devSidecarPaths(desktopRoot, hostTriple(), exe),
    h5DistDir: dist,
    webDist: dist,
    trayIcon: path.join(desktopRoot, 'electron', 'build', 'icons', 'tray.png'),
  }
}

function serveDist(webDist: string) {
  protocol.handle(APP_SCHEME, async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const target = path.normalize(path.join(webDist, pathname))
    const inside = target.startsWith(webDist + path.sep)
    const file = inside && path.extname(target) ? target : path.join(webDist, 'index.html')
    const response = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    return new Response(response.body, { status: response.status, headers })
  })
}

let browserMenuLabels: SelectionMenuLabels | null = null

function window(): BrowserWindow {
  if (!mainWindow) throw new Error('main window is not open')
  return mainWindow
}

function emit(event: string, payload?: unknown) {
  mainWindow?.webContents.send('shell:event', event, payload)
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function windowStateFile() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE)
}

function saveWindowState() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!mainWindow || mainWindow.isMinimized()) return
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  writeWindowState(windowStateFile(), { ...bounds, maximized: mainWindow.isMaximized() })
}

function scheduleWindowStateSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveWindowState, WINDOW_STATE_SAVE_DELAY_MS)
}

function restoreWindowBounds(win: BrowserWindow): boolean {
  const state = readWindowState(windowStateFile())
  if (!state) return false
  const bounds = restorableBounds(state, screen.getAllDisplays().map((display) => display.workArea))
  if (!bounds) return false
  win.setBounds(bounds)
  return state.maximized
}

function openExternal(url: string) {
  if (!EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) throw new Error(`refusing to open ${url}`)
  return shell.openExternal(url)
}

async function openDialog(input: ElectronOpenDialogInput) {
  const properties: OpenDialogOptions['properties'] = [input.directory ? 'openDirectory' : 'openFile', 'createDirectory']
  if (input.multiple) properties.push('multiSelections')
  const result = await dialog.showOpenDialog(window(), { title: input.title, properties, filters: input.filters })
  return result.canceled ? null : result.filePaths
}

async function saveDialog(input: { defaultPath: string; filters: ElectronDialogFilter[] }) {
  const result = await dialog.showSaveDialog(window(), input)
  return result.canceled || !result.filePath ? null : result.filePath
}

function stopSidecar() {
  browserHost?.dispose()
  browserHost = null
  const child = sidecar?.child
  sidecar = null
  if (!child || child.exitCode !== null) return
  if (IS_WINDOWS && child.pid) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill()
  }
}

function showNotification(input: { title: string; body?: string; clickPayload?: unknown }) {
  if (!Notification.isSupported()) return false
  const notification = new Notification({ title: input.title, body: input.body ?? '' })
  activeNotifications.add(notification)
  const release = () => activeNotifications.delete(notification)
  notification.on('click', () => {
    release()
    showMainWindow()
    if (input.clickPayload !== undefined) emit('desktop-notification-clicked', input.clickPayload)
  })
  notification.on('close', release)
  notification.on('failed', (_event, error) => {
    release()
    console.error('[electron] notification failed', error)
  })
  notification.show()
  return true
}

function startBrowserHost(runtime: SidecarRuntime) {
  const host = createBrowserHost({
    getMainWebContents: () => mainWindow?.webContents ?? null,
    fromId: (id) => webContents.fromId(id),
    browserSession: session.fromPartition(BROWSER_PARTITION),
    emitToRenderer: emit,
    resolveInput: (input, projectRoot) => resolveBrowserInput(input, projectRoot, projectRoots),
    classify: (url) => classifyUrl(url, projectRoots),
  })
  host.connect({ url: `ws://${new URL(runtime.url).host}${BROWSER_HOST_PATH}`, token: runtime.token })
  browserHost = host
}

function runningBrowserHost() {
  if (!browserHost) throw new Error('browser control is not available')
  return browserHost
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new Error(`${key} must be a non-empty string`)
  return value
}

function booleanArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}

function grantDecisionArg(args: Record<string, unknown>) {
  const value = args.decision
  if (!(BROWSER_GRANT_DECISIONS as readonly unknown[]).includes(value)) throw new Error('decision must be deny, once or session')
  return value as BrowserGrantDecision
}

function integerArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${key} must be an integer`)
  return value
}

function markRequestsArg(args: Record<string, unknown>): MarkRequest[] {
  const value = args.refs
  if (!Array.isArray(value)) throw new Error('refs must be an array')
  return value.map((entry) => {
    const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
    return { ref: stringArg(record, 'ref'), generation: integerArg(record, 'generation') }
  })
}

type Handler = (args: Record<string, unknown>) => unknown

const handlers: Record<string, Handler> = {
  get_server_url: () => {
    if (sidecar) return sidecar.url
    throw new Error(sidecarError ?? 'desktop server did not start')
  },
  get_app_mode: () => currentAppMode(process.env, locations),
  set_app_mode: (args) => setAppMode(process.env, locations, {
    mode: String(args.mode),
    portableDir: typeof args.portableDir === 'string' ? args.portableDir : null,
  }),
  prepare_app_mode_restart: () => {
    quitting = true
    stopSidecar()
    clearPortableEnvForRestart(process.env)
  },
  prepare_update_install: () => {
    quitting = true
    stopSidecar()
  },
  cancel_update_install: () => {
    quitting = false
  },
  write_session_export: (args) => writeSessionExport(String(args.path), String(args.contents)),
  get_app_version: () => app.getVersion(),
  set_app_zoom: (args) => window().webContents.setZoomFactor(Math.min(Math.max(Number(args.zoomFactor), 0.5), 2)),
  relaunch: () => {
    quitting = true
    app.relaunch()
    app.quit()
  },
  dialog_open: (args) => openDialog(args as ElectronOpenDialogInput),
  dialog_save: (args) => saveDialog(args as { defaultPath: string; filters: ElectronDialogFilter[] }),
  open_external: (args) => openExternal(String(args.url)),
  window_minimize: () => window().minimize(),
  window_toggle_maximize: () => (window().isMaximized() ? window().unmaximize() : window().maximize()),
  window_close: () => window().close(),
  window_is_maximized: () => window().isMaximized(),
  window_show: () => window().show(),
  window_focus: () => window().focus(),
  notification_supported: () => Notification.isSupported(),
  notification_send: (args) => showNotification({
    title: String(args.title),
    body: typeof args.body === 'string' ? args.body : undefined,
    clickPayload: args.clickPayload,
  }),
  open_notification_settings: async () => {
    const url = IS_MAC
      ? 'x-apple.systempreferences:com.apple.preference.notifications'
      : IS_WINDOWS ? 'ms-settings:notifications' : null
    if (!url) return false
    await shell.openExternal(url)
    return true
  },
  browser_resolve: (args) => resolveBrowserInput(
    String(args.input),
    typeof args.projectRoot === 'string' ? args.projectRoot : null,
    projectRoots,
    { engine: args.searchEngine },
  ),
  browser_open_in_system: async (args) => {
    const target = await systemTargetFor(String(args.url), projectRoots)
    if (!target) throw new Error(`refusing to open ${String(args.url)}`)
    if (target.kind === 'url') return shell.openExternal(target.value)
    const failure = await shell.openPath(target.value)
    if (failure) throw new Error(failure)
  },
  browser_open_protocol: (args) => {
    const url = String(args.url)
    if (classifyUrl(url, projectRoots) !== 'external') throw new Error(`refusing to open ${url}`)
    return shell.openExternal(url)
  },
  browser_clear_data: async () => {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    await browserSession.clearStorageData()
    await browserSession.clearCache()
    await browserSession.clearAuthCache()
  },
  browser_set_menu_labels: (args) => {
    browserMenuLabels = { addToChat: stringArg(args, 'addToChat'), copy: stringArg(args, 'copy') }
  },
  browser_view_register: (args) => runningBrowserHost().registerView({
    sessionId: stringArg(args, 'sessionId'),
    tabId: stringArg(args, 'tabId'),
    webContentsId: integerArg(args, 'webContentsId'),
  }),
  browser_view_update: (args) => runningBrowserHost().updateView({
    tabId: stringArg(args, 'tabId'),
    shown: booleanArg(args, 'shown'),
    active: booleanArg(args, 'active'),
    foreground: booleanArg(args, 'foreground'),
  }),
  browser_view_unregister: (args) => runningBrowserHost().unregisterView(stringArg(args, 'tabId')),
  browser_pick_set: (args) => runningBrowserHost().setPickMode(stringArg(args, 'tabId'), booleanArg(args, 'active')),
  browser_marks_sync: (args) => runningBrowserHost().syncMarks(stringArg(args, 'tabId'), markRequestsArg(args)),
  browser_stop: (args) => runningBrowserHost().stopSession(stringArg(args, 'sessionId')),
  browser_open_tab_done: (args) => runningBrowserHost().resolveOpenTab(stringArg(args, 'requestId'), stringArg(args, 'tabId')),
  browser_activate_done: (args) => runningBrowserHost().resolveActivate(stringArg(args, 'requestId'), booleanArg(args, 'shown')),
  browser_grant_reply: (args) => runningBrowserHost().replyGrant(stringArg(args, 'requestId'), grantDecisionArg(args)),
  browser_trust_list: () => runningBrowserHost().trust('list'),
  browser_trust_add: (args) => runningBrowserHost().trust('add', stringArg(args, 'origin')),
  browser_trust_remove: (args) => runningBrowserHost().trust('remove', stringArg(args, 'origin')),
  request_attention: () => {
    if (IS_MAC) app.dock?.bounce('critical')
    else window().flashFrame(true)
  },
}

ipcMain.handle('shell:invoke', async (event, command: string, args?: Record<string, unknown>) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('shell call from an unknown window')
  const handler = handlers[command]
  if (!handler) throw new Error(`${command} is not available in the Electron shell`)
  return handler(args ?? {})
})

function installApplicationMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null)
    return
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'DreamCoder',
      submenu: [
        { label: '关于 DreamCoder', click: () => emit('native-menu-navigate', 'about') },
        { type: 'separator' },
        { label: '设置...', accelerator: 'CmdOrCtrl+,', click: () => emit('native-menu-navigate', 'settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function installTray(iconPath: string) {
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    console.error(`[electron] tray icon not found at ${iconPath}`)
    return
  }
  tray = new Tray(image.resize({ width: IS_MAC ? 18 : 16, height: IS_MAC ? 18 : 16 }))
  tray.setToolTip('DreamCoder')
  const menu = Menu.buildFromTemplate([
    { label: 'Show DreamCoder', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit DreamCoder', click: () => app.quit() },
  ])
  tray.on('click', showMainWindow)
  tray.on('right-click', () => tray?.popUpContextMenu(menu))
}

function createWindow(startUrl: string) {
  const win = new BrowserWindow({
    title: 'DreamCoder',
    width: 1440,
    height: 960,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    ...(IS_MAC
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 15 } }
      : { frame: !IS_WINDOWS }),
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })
  installBrowser({
    host: win.webContents,
    session: session.fromPartition(BROWSER_PARTITION),
    roots: projectRoots,
    readFile: (file) => net.fetch(pathToFileURL(file).toString()),
    notify: emit,
    popupMenu: (items) => Menu.buildFromTemplate(items).popup({ window: win }),
    menuLabels: () => browserMenuLabels,
  })
  const restoreMaximized = restoreWindowBounds(win)
  const startOrigin = new URL(startUrl).origin
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url).catch((error) => console.error('[electron] open external failed', error))
    return { action: 'deny' }
  })
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame || isAllowedFrameNavigation(event.url)) return
    event.preventDefault()
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === startOrigin) return
    event.preventDefault()
    void openExternal(url).catch((error) => console.error('[electron] open external failed', error))
  })
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      const devToolsShortcut = input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')
      if (input.type !== 'keyDown' || !devToolsShortcut) return
      event.preventDefault()
      win.webContents.toggleDevTools()
    })
  }
  win.on('resize', () => emit('window-resized'))
  win.on('close', (event) => {
    saveWindowState()
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.once('ready-to-show', () => {
    win.show()
    if (restoreMaximized) win.maximize()
    win.on('resize', scheduleWindowStateSave)
    win.on('move', scheduleWindowStateSave)
  })
  win.on('closed', () => {
    mainWindow = null
  })
  mainWindow = win
  void win.loadURL(startUrl)
}

if (IS_WINDOWS) app.setAppUserModelId(APP_ID)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)

  app.whenReady().then(async () => {
    const paths = resolvePaths()
    if (!DEV_URL) serveDist(paths.webDist)
    installApplicationMenu()
    installTray(paths.trayIcon)
    try {
      sidecar = await startSidecar(paths, app.getVersion())
    } catch (error) {
      sidecarError = error instanceof Error ? error.message : String(error)
      console.error('[electron] sidecar failed to start', sidecarError)
    }
    createWindow(DEV_URL ?? `${APP_ORIGIN}/`)
    if (sidecar) startBrowserHost(sidecar)
  })

  app.on('activate', showMainWindow)
  app.on('before-quit', () => {
    quitting = true
    saveWindowState()
  })
  app.on('will-quit', stopSidecar)
  process.on('exit', stopSidecar)
}
