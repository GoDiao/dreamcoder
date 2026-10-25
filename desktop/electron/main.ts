import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
} from 'electron'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ElectronDialogFilter, ElectronOpenDialogInput } from '../src/lib/shell/electronBridge'
import {
  appModeLocations,
  clearPortableEnvForRestart,
  CONFIG_DIR_ENV,
  currentAppMode,
  determineStartupPortableDir,
  legacyTerminalConfigPath,
  PORTABLE_MARKER_ENV,
  setAppMode,
  WINDOW_STATE_FILE,
} from './appMode'
import { writeSessionExport } from './sessionExport'
import { startSidecar, type SidecarPaths, type SidecarRuntime } from './sidecar'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  readWindowState,
  restorableBounds,
  toStoredWindowState,
  writeWindowState,
} from './windowState'

const APP_SCHEME = 'dreamcoder'
const APP_ORIGIN = `${APP_SCHEME}://localhost`
const DEV_URL = process.env.DREAMCODER_ELECTRON_DEV_URL
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const WINDOW_STATE_SAVE_DELAY_MS = 300
const IS_MAC = process.platform === 'darwin'
const IS_WINDOWS = process.platform === 'win32'

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

const locations = appModeLocations(process.execPath, app.getPath('appData'))
const startupPortableDir = determineStartupPortableDir(process.env, locations)
if (startupPortableDir) {
  process.env[CONFIG_DIR_ENV] = startupPortableDir
  process.env[PORTABLE_MARKER_ENV] = '1'
}
if (process.env[CONFIG_DIR_ENV]) {
  app.setPath('userData', path.join(process.env[CONFIG_DIR_ENV], 'Electron'))
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let sidecar: SidecarRuntime | null = null
let sidecarError: string | null = null
let quitting = false
let saveTimer: NodeJS.Timeout | null = null

function hostTriple() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin'
  if (IS_WINDOWS && process.arch === 'x64') return 'x86_64-pc-windows-msvc'
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
  const binDir = path.join(desktopRoot, 'src-tauri', 'binaries')
  const dist = path.join(desktopRoot, 'dist')
  return {
    binary: path.join(binDir, `dreamcoder-sidecar-${hostTriple()}${exe}`),
    appRoot: binDir,
    h5DistDir: dist,
    webDist: dist,
    trayIcon: path.join(desktopRoot, 'src-tauri', 'icons', '32x32.png'),
  }
}

function serveDist(webDist: string) {
  protocol.handle(APP_SCHEME, (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const target = path.normalize(path.join(webDist, pathname))
    const inside = target.startsWith(webDist + path.sep)
    const file = inside && path.extname(target) ? target : path.join(webDist, 'index.html')
    return net.fetch(pathToFileURL(file).toString())
  })
}

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
  return path.join(process.env[CONFIG_DIR_ENV] || locations.systemConfigDir, WINDOW_STATE_FILE)
}

function saveWindowState() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!mainWindow || mainWindow.isMinimized()) return
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  writeWindowState(windowStateFile(), toStoredWindowState(bounds, mainWindow.isMaximized(), display))
}

function scheduleWindowStateSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveWindowState, WINDOW_STATE_SAVE_DELAY_MS)
}

function restoreWindowBounds(win: BrowserWindow): boolean {
  const state = readWindowState(windowStateFile())
  if (!state) return false
  const bounds = restorableBounds(state, screen.getAllDisplays())
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
  const child = sidecar?.child
  sidecar = null
  if (!child || child.exitCode !== null) return
  if (IS_WINDOWS && child.pid) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill()
  }
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
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 24 } }
      : { frame: !IS_WINDOWS }),
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const restoreMaximized = restoreWindowBounds(win)
  const startOrigin = new URL(startUrl).origin
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url).catch((error) => console.error('[electron] open external failed', error))
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === startOrigin) return
    event.preventDefault()
    void openExternal(url).catch((error) => console.error('[electron] open external failed', error))
  })
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
      sidecar = await startSidecar(paths, app.getVersion(), legacyTerminalConfigPath(process.env, locations))
    } catch (error) {
      sidecarError = error instanceof Error ? error.message : String(error)
      console.error('[electron] sidecar failed to start', sidecarError)
    }
    createWindow(DEV_URL ?? `${APP_ORIGIN}/`)
  })

  app.on('activate', showMainWindow)
  app.on('before-quit', () => {
    quitting = true
    saveWindowState()
  })
  app.on('will-quit', stopSidecar)
  process.on('exit', stopSidecar)
}
