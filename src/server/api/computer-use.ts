import { homedir } from 'os'
import { join } from 'path'
import { access, readFile, mkdir, writeFile, rm } from 'fs/promises'
import { createHash } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import type { CuPermissionRequest } from '../../vendor/computer-use-mcp/types.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { detectPythonRuntime, isPythonVersionAtLeast } from './computer-use-python.js'
import { buildPipInstallAttempts } from '../../utils/computerUse/pipInstall.js'
import { setComputerUseMode } from '../../utils/computerUse/hostAdapter.js'
import {
  DEFAULT_DESKTOP_GRANT_FLAGS,
  DEFAULT_COMPUTER_USE_MODE,
  loadStoredComputerUseConfig,
  normalizePythonPath,
  saveStoredComputerUseConfig,
  type ComputerUseMode,
} from '../../utils/computerUse/preauthorizedConfig.js'
// @ts-ignore — Bun text import
import MAC_HELPER_CONTENT from '../../../runtime/mac_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import WIN_HELPER_CONTENT from '../../../runtime/win_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import UIA_HELPER_CONTENT from '../../../runtime/uia_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_DARWIN from '../../../runtime/requirements.txt' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_WIN32 from '../../../runtime/requirements-win.txt' with { type: 'text' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../..')
const devRuntimeRoot = join(projectRoot, 'runtime')
const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
const runtimeStateRoot = join(claudeHome, '.runtime')
const venvRoot = join(runtimeStateRoot, 'venv')
const installStampPath = join(runtimeStateRoot, 'requirements.sha256')
const baseInterpreterMarkerPath = join(runtimeStateRoot, 'venv-base-interpreter.txt')
const MIN_PYTHON_MAJOR = 3
const MIN_PYTHON_MINOR = 9

const isWindows = process.platform === 'win32'
const REQUIREMENTS_CONTENT = isWindows ? REQUIREMENTS_WIN32 : REQUIREMENTS_DARWIN

function getPythonCommandEnv(): Record<string, string> | undefined {
  if (!isWindows) return undefined
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  } as Record<string, string>
}

function getRequirementsPath(): string {
  return join(runtimeStateRoot, 'requirements.txt')
}

function getHelperFileName(): string {
  return isWindows ? 'win_helper.py' : 'mac_helper.py'
}

function getHelperPath(): string {
  return join(runtimeStateRoot, getHelperFileName())
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function venvBaseInterpreterMatches(
  currentCustomPath: string | null | undefined,
): Promise<boolean> {
  const current = (currentCustomPath ?? '').trim()
  try {
    const recorded = (await readFile(baseInterpreterMarkerPath, 'utf8')).trim()
    return recorded === current
  } catch {
    return current === ''
  }
}

async function runCommand(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: getPythonCommandEnv(),
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code }
  } catch {
    return { ok: false, stdout: '', stderr: `Failed to run ${cmd}`, code: -1 }
  }
}

export async function runPipInstallWithFallback(
  pythonCmd: string,
  baseArgs: string[],
  run: typeof runCommand = runCommand,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  let firstFailure: { ok: boolean; stdout: string; stderr: string; code: number } | null = null
  for (const args of buildPipInstallAttempts(baseArgs)) {
    const result = await run(pythonCmd, args)
    if (result.ok) return result
    firstFailure ??= result
  }
  return firstFailure ?? { ok: false, stdout: '', stderr: 'pip install failed', code: -1 }
}

async function ensureRuntimeFiles(): Promise<void> {
  await mkdir(runtimeStateRoot, { recursive: true })

  await writeFile(getRequirementsPath(), REQUIREMENTS_CONTENT, 'utf8')

  const helperContent = isWindows ? WIN_HELPER_CONTENT : MAC_HELPER_CONTENT
  await writeFile(getHelperPath(), helperContent, 'utf8')

  if (isWindows) {
    await writeFile(join(runtimeStateRoot, 'uia_helper.py'), UIA_HELPER_CONTENT, 'utf8')
  }
}

type EnvStatus = {
  platform: string
  supported: boolean
  python: {
    installed: boolean
    version: string | null
    path: string | null
    source: 'custom' | 'system' | 'venv' | null
    error: string | null
  }
  venv: {
    created: boolean
    path: string
  }
  dependencies: {
    installed: boolean
    requirementsFound: boolean
  }
  permissions: {
    accessibility: boolean | null
    screenRecording: boolean | null
  }
}

async function checkStatus(): Promise<EnvStatus> {
  const platform = process.platform
  const supported = platform === 'darwin' || platform === 'win32'

  const venvPython = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')
  const venvCreated = await pathExists(venvPython)
  const config = await loadConfig()

  const pythonRuntime = await detectPythonRuntime(
    platform,
    runCommand,
    venvCreated ? venvPython : undefined,
    config.pythonPath,
  )

  let effectiveVenvCreated = venvCreated
  if (venvCreated) {
    const matches = await venvBaseInterpreterMatches(config.pythonPath)
    if (!matches) effectiveVenvCreated = false
  }

  const reqPath = getRequirementsPath()
  const requirementsFound = await pathExists(reqPath)
  let depsInstalled = false
  if (requirementsFound && effectiveVenvCreated) {
    try {
      const requirements = await readFile(reqPath, 'utf8')
      const digest = createHash('sha256').update(requirements).digest('hex')
      const stamp = (await readFile(installStampPath, 'utf8')).trim()
      depsInstalled = stamp === digest
    } catch {
      depsInstalled = false
    }
  }

  let accessibility: boolean | null = null
  let screenRecording: boolean | null = null
  if (supported && effectiveVenvCreated && depsInstalled) {
    try { await ensureRuntimeFiles() } catch {}
    const helperPath = getHelperPath()
    if (await pathExists(helperPath)) {
      const permResult = await runCommand(venvPython, [helperPath, 'check_permissions'])
      if (permResult.ok) {
        try {
          const parsed = JSON.parse(permResult.stdout)
          if (parsed.ok && parsed.result) {
            accessibility = parsed.result.accessibility ?? null
            screenRecording = parsed.result.screenRecording ?? null
          }
        } catch {}
      }
    }
  }

  return {
    platform,
    supported,
    python: {
      installed: pythonRuntime.installed,
      version: pythonRuntime.version,
      path: pythonRuntime.path,
      source: pythonRuntime.source,
      error: pythonRuntime.error,
    },
    venv: { created: effectiveVenvCreated, path: venvRoot },
    dependencies: { installed: depsInstalled, requirementsFound: requirementsFound || true },
    permissions: { accessibility, screenRecording },
  }
}

type SetupResult = {
  success: boolean
  steps: { name: string; ok: boolean; message: string }[]
}

export function getUnsupportedPythonVersionStep(
  version: string | null,
): SetupResult['steps'][number] | null {
  if (isPythonVersionAtLeast(version, MIN_PYTHON_MAJOR, MIN_PYTHON_MINOR)) return null
  return {
    name: 'python_version',
    ok: false,
    message: `Computer Use 需要 Python >= ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}，当前版本为 ${version ?? 'unknown'}`,
  }
}

export async function installSetupDependencies(
  venvPython: string,
  reqPath: string,
  install: typeof runPipInstallWithFallback = runPipInstallWithFallback,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  await install(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  return install(venvPython, ['-m', 'pip', 'install', '-r', reqPath])
}

async function runSetup(): Promise<SetupResult> {
  const steps: SetupResult['steps'] = []

  const venvPython = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')
  let venvExists = await pathExists(venvPython)
  const config = await loadConfig()

  if (venvExists && !(await venvBaseInterpreterMatches(config.pythonPath))) {
    try {
      await rm(venvRoot, { recursive: true, force: true })
      await rm(installStampPath, { force: true })
      await rm(baseInterpreterMarkerPath, { force: true })
      venvExists = false
      steps.push({
        name: 'venv_rebuild',
        ok: true,
        message: '检测到自定义解释器变更，已移除旧虚拟环境以便重建',
      })
    } catch (err) {
      steps.push({
        name: 'venv_rebuild',
        ok: false,
        message: `移除旧虚拟环境失败: ${err}`,
      })
      return { success: false, steps }
    }
  }

  const pythonRuntime = await detectPythonRuntime(
    process.platform,
    runCommand,
    venvExists ? venvPython : undefined,
    config.pythonPath,
  )
  if (!pythonRuntime.installed) {
    steps.push({
      name: 'python_check',
      ok: false,
      message: pythonRuntime.source === 'custom'
        ? `自定义 Python 路径不可用: ${pythonRuntime.error ?? pythonRuntime.path}`
        : 'Python 3 未安装，请先安装 Python 3',
    })
    return { success: false, steps }
  }
  steps.push({
    name: 'python_check',
    ok: true,
    message: pythonRuntime.source === 'custom'
      ? `Python ${pythonRuntime.version}（使用自定义解释器）`
      : pythonRuntime.source === 'venv'
        ? `Python ${pythonRuntime.version}（使用现有虚拟环境）`
        : `Python ${pythonRuntime.version}`,
  })

  const unsupportedVersionStep = getUnsupportedPythonVersionStep(pythonRuntime.version)
  if (unsupportedVersionStep) return { success: false, steps: [...steps, unsupportedVersionStep] }

  try {
    await ensureRuntimeFiles()
    steps.push({ name: 'runtime_files', ok: true, message: '运行时文件已就绪' })
  } catch (err) {
    steps.push({
      name: 'runtime_files',
      ok: false,
      message: `提取运行时文件失败: ${err}`,
    })
    return { success: false, steps }
  }

  if (!venvExists) {
    if (!pythonRuntime.command) {
      steps.push({
        name: 'venv',
        ok: false,
        message: '未找到可用于创建虚拟环境的 Python 命令',
      })
      return { success: false, steps }
    }
    const venvResult = await runCommand(pythonRuntime.command, [
      ...pythonRuntime.prefixArgs,
      '-m',
      'venv',
      venvRoot,
    ])
    if (!venvResult.ok) {
      steps.push({
        name: 'venv',
        ok: false,
        message: `创建虚拟环境失败: ${venvResult.stderr}`,
      })
      return { success: false, steps }
    }
    try {
      await writeFile(baseInterpreterMarkerPath, config.pythonPath ?? '', 'utf8')
    } catch (err) {
      steps.push({
        name: 'venv',
        ok: false,
        message: `写入虚拟环境标记文件失败: ${err}`,
      })
      return { success: false, steps }
    }
    steps.push({ name: 'venv', ok: true, message: '虚拟环境已创建' })
  } else {
    steps.push({ name: 'venv', ok: true, message: '虚拟环境已存在' })
  }

  const pipPath = isWindows
    ? join(venvRoot, 'Scripts', 'pip.exe')
    : join(venvRoot, 'bin', 'pip')
  if (!(await pathExists(pipPath))) {
    const pipResult = await runCommand(venvPython, [
      '-m',
      'ensurepip',
      '--upgrade',
    ])
    if (!pipResult.ok) {
      steps.push({
        name: 'pip',
        ok: false,
        message: `安装 pip 失败: ${pipResult.stderr}`,
      })
      return { success: false, steps }
    }
  }
  steps.push({ name: 'pip', ok: true, message: 'pip 已就绪' })

  const reqPath = getRequirementsPath()
  const requirements = await readFile(reqPath, 'utf8')
  const digest = createHash('sha256').update(requirements).digest('hex')

  let installedDigest = ''
  try {
    installedDigest = (await readFile(installStampPath, 'utf8')).trim()
  } catch {}

  if (installedDigest !== digest) {
    const installResult = await installSetupDependencies(venvPython, reqPath)
    if (!installResult.ok) {
      steps.push({
        name: 'deps',
        ok: false,
        message: `安装依赖失败: ${installResult.stderr.slice(0, 500)}`,
      })
      return { success: false, steps }
    }
    await writeFile(installStampPath, `${digest}\n`, 'utf8')
    steps.push({ name: 'deps', ok: true, message: '依赖已安装' })
  } else {
    steps.push({ name: 'deps', ok: true, message: '依赖已是最新' })
  }

  return { success: true, steps }
}

type AuthorizedApp = {
  bundleId: string
  displayName: string
  authorizedAt?: string
}

type ComputerUseConfig = {
  enabled: boolean
  mode: ComputerUseMode
  authorizedApps: AuthorizedApp[]
  grantFlags: {
    clipboardRead: boolean
    clipboardWrite: boolean
    systemKeyCombos: boolean
  }
  pythonPath: string | null
}

type RequestAccessBody = {
  sessionId?: string
  request?: CuPermissionRequest
}

const DEFAULT_CONFIG: ComputerUseConfig = {
  enabled: true,
  mode: DEFAULT_COMPUTER_USE_MODE,
  authorizedApps: [],
  grantFlags: DEFAULT_DESKTOP_GRANT_FLAGS,
  pythonPath: null,
}

async function loadConfig(): Promise<ComputerUseConfig> {
  return { ...DEFAULT_CONFIG, ...(await loadStoredComputerUseConfig()) }
}

async function saveConfig(config: ComputerUseConfig): Promise<void> {
  await saveStoredComputerUseConfig(config)
}

async function listInstalledApps(): Promise<{ bundleId: string; displayName: string; path: string }[]> {
  const helperPath = getHelperPath()
  const pythonBin = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')

  if (!(await pathExists(pythonBin)) || !(await pathExists(helperPath))) {
    return []
  }

  const result = await runCommand(pythonBin, [helperPath, 'list_installed_apps'])
  if (!result.ok) return []

  try {
    const parsed = JSON.parse(result.stdout)
    return parsed.ok ? parsed.result : []
  } catch {
    return []
  }
}

export async function handleComputerUseApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  const action = segments[2]

  if (action === 'status' && req.method === 'GET') {
    const status = await checkStatus()
    return Response.json(status)
  }

  if (action === 'setup' && req.method === 'POST') {
    const result = await runSetup()
    return Response.json(result)
  }

  if (action === 'apps' && req.method === 'GET') {
    const apps = await listInstalledApps()
    return Response.json({ apps })
  }

  if (action === 'authorized-apps' && req.method === 'GET') {
    const config = await loadConfig()
    return Response.json(config)
  }

  if (action === 'authorized-apps' && req.method === 'PUT') {
    try {
      const body = (await req.json()) as Partial<ComputerUseConfig>
      const config = await loadConfig()
      if (body.enabled !== undefined) config.enabled = body.enabled
      if (body.mode !== undefined) config.mode = body.mode
      if (body.authorizedApps) config.authorizedApps = body.authorizedApps
      if (body.grantFlags) config.grantFlags = { ...config.grantFlags, ...body.grantFlags }
      if ('pythonPath' in body) config.pythonPath = normalizePythonPath(body.pythonPath)
      await saveConfig(config)
      if (body.mode !== undefined) {
        setComputerUseMode(config.mode)
      }
      return Response.json({ ok: true })
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }

  if (action === 'open-settings' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { pane?: string }
    const pane = body.pane ?? 'Privacy_ScreenCapture'
    const allowed = ['Privacy_ScreenCapture', 'Privacy_Accessibility']
    if (!allowed.includes(pane)) {
      return Response.json({ error: 'Invalid pane' }, { status: 400 })
    }

    if (process.platform === 'darwin') {
      const url = `x-apple.systempreferences:com.apple.preference.security?${pane}`
      await runCommand('open', [url])
    } else if (process.platform === 'win32') {
      await runCommand('cmd', ['/c', 'start', 'ms-settings:privacy'])
    } else {
      return Response.json({ error: 'Unsupported platform' }, { status: 400 })
    }
    return Response.json({ ok: true })
  }

  if (action === 'request-access' && req.method === 'POST') {
    try {
      const body = (await req.json()) as RequestAccessBody
      if (!body.sessionId || !body.request?.requestId) {
        return Response.json(
          { error: 'BAD_REQUEST', message: 'sessionId and request are required' },
          { status: 400 },
        )
      }

      const response = await computerUseApprovalService.requestApproval(
        body.sessionId,
        body.request,
      )
      return Response.json(response)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Computer Use approval failed'
      const status = message.includes('not connected') ? 409 : 500
      return Response.json({ error: 'COMPUTER_USE_APPROVAL_FAILED', message }, { status })
    }
  }

  return Response.json(
    { error: 'NOT_FOUND', message: `Unknown computer-use action: ${action}` },
    { status: 404 },
  )
}
