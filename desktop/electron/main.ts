import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type OpenDialogOptions } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ElectronDialogFilter, ElectronOpenDialogInput } from '../src/lib/shell/electronBridge'
import { startSidecar, type SidecarPaths, type SidecarRuntime } from './sidecar'

const APP_SCHEME = 'dreamcoder'
const APP_ORIGIN = `${APP_SCHEME}://localhost`
const CONFIG_DIR_ENV = 'DREAMCODER_CONFIG_DIR'
const DEV_URL = process.env.DREAMCODER_ELECTRON_DEV_URL
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarRuntime | null = null
let sidecarError: string | null = null

function hostTriple() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin'
  throw new Error(`unsupported platform for the Electron spike: ${process.platform}-${process.arch}`)
}

function resolvePaths(): SidecarPaths & { webDist: string } {
  if (app.isPackaged) {
    const binDir = path.join(process.resourcesPath, 'bin')
    const dist = path.join(process.resourcesPath, 'dist')
    return { binary: path.join(binDir, 'dreamcoder-sidecar'), appRoot: binDir, h5DistDir: dist, webDist: dist }
  }
  const desktopRoot = path.resolve(app.getAppPath(), '..')
  const binDir = path.join(desktopRoot, 'src-tauri', 'binaries')
  const dist = path.join(desktopRoot, 'dist')
  return { binary: path.join(binDir, `dreamcoder-sidecar-${hostTriple()}`), appRoot: binDir, h5DistDir: dist, webDist: dist }
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

function appMode() {
  const configDir = process.env[CONFIG_DIR_ENV] ?? null
  return { mode: configDir ? 'portable' : 'default', portableDir: configDir, defaultPortableDir: null }
}

type Handler = (args: Record<string, unknown>) => unknown

const handlers: Record<string, Handler> = {
  get_server_url: () => {
    if (sidecar) return sidecar.url
    throw new Error(sidecarError ?? 'desktop server did not start')
  },
  get_app_mode: () => appMode(),
  get_app_version: () => app.getVersion(),
  set_app_zoom: (args) => window().webContents.setZoomFactor(Number(args.zoomFactor)),
  relaunch: () => {
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
    app.dock?.bounce('critical')
  },
}

ipcMain.handle('shell:invoke', async (event, command: string, args?: Record<string, unknown>) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('shell call from an unknown window')
  const handler = handlers[command]
  if (!handler) throw new Error(`${command} is not implemented in the Electron spike`)
  return handler(args ?? {})
})

function createWindow(startUrl: string) {
  const win = new BrowserWindow({
    title: 'DreamCoder',
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 24 },
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
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
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })
  mainWindow = win
  void win.loadURL(startUrl)
}

function stopSidecar() {
  sidecar?.child.kill()
  sidecar = null
}

app.whenReady().then(async () => {
  const paths = resolvePaths()
  if (!DEV_URL) serveDist(paths.webDist)
  try {
    sidecar = await startSidecar(paths, app.getVersion())
  } catch (error) {
    sidecarError = error instanceof Error ? error.message : String(error)
    console.error('[electron] sidecar failed to start', sidecarError)
  }
  createWindow(DEV_URL ?? `${APP_ORIGIN}/`)
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', stopSidecar)
process.on('exit', stopSidecar)
