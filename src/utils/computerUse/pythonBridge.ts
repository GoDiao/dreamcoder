import { createHash } from 'node:crypto'
import { readFile, mkdir, access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { buildPipInstallAttempts } from './pipInstall.js'
import { loadStoredComputerUseConfig } from './preauthorizedConfig.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../..')

// All runtime state lives in ~/.claude/.runtime — writable in both dev and
// bundled (Tauri app) modes. The setup API (or ensureRuntimeFiles below)
// populates requirements.txt and mac_helper.py here.
const runtimeStateRoot = path.join(getClaudeConfigHomeDir(), '.runtime')
const venvRoot = path.join(runtimeStateRoot, 'venv')
const installStampPath = path.join(runtimeStateRoot, 'requirements.sha256')

const isWindows = process.platform === 'win32'

// Always read from ~/.claude/.runtime/ — works in both dev and bundled mode.
const requirementsPath = path.join(runtimeStateRoot, 'requirements.txt')
const defaultHelperFileName = isWindows ? 'win_helper.py' : 'mac_helper.py'
const defaultHelperPath = path.join(runtimeStateRoot, defaultHelperFileName)

let bootstrapPromise: Promise<void> | undefined

function getPythonCommandEnv(): NodeJS.ProcessEnv | undefined {
  if (!isWindows) return undefined
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
}

function pythonBinPath(): string {
  return isWindows
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python3')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function runOrThrow(file: string, args: string[], label: string): Promise<string> {
  const { code, stdout, stderr } = await execFileNoThrow(file, args, { useCwd: false })
  if (code !== 0) {
    throw new Error(`${label} failed with code ${code}: ${stderr || stdout || 'unknown error'}`)
  }
  return stdout
}

export async function runPipInstallWithFallback(
  baseArgs: string[],
  label: string,
  run: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }> = args =>
    execFileNoThrow(pythonBinPath(), args, { useCwd: false }),
): Promise<void> {
  let firstFailure = ''
  for (const args of buildPipInstallAttempts(baseArgs)) {
    const { code, stdout, stderr } = await run(args)
    if (code === 0) return
    if (!firstFailure) {
      firstFailure = `${label} failed with code ${code}: ${stderr || stdout || 'unknown error'}`
    }
  }
  throw new Error(firstFailure || `${label} failed`)
}

export async function installRuntimeDependencies(
  requirementsPath: string,
  install: typeof runPipInstallWithFallback = runPipInstallWithFallback,
): Promise<void> {
  await install(['-m', 'pip', 'install', '--upgrade', 'pip'], 'pip upgrade')
  await install(['-m', 'pip', 'install', '-r', requirementsPath], 'python dependency install')
}

async function getVenvCreationPythonCommand(): Promise<string> {
  const config = await loadStoredComputerUseConfig()
  if (config.pythonPath) return config.pythonPath
  return isWindows ? 'python' : 'python3'
}

/**
 * Ensure runtime source files exist in ~/.claude/.runtime/.
 * In dev mode, copies from the project's runtime/ directory on first run.
 * In bundled mode, these must have been placed there by the settings setup API.
 */
async function ensureRuntimeFiles(): Promise<void> {
  await mkdir(runtimeStateRoot, { recursive: true })

  const devReqFile = isWindows ? 'requirements-win.txt' : 'requirements.txt'
  const devRequirements = path.join(projectRoot, 'runtime', devReqFile)
  const devHelper = path.join(projectRoot, 'runtime', defaultHelperFileName)

  // Always sync from dev runtime/ so source changes are reflected immediately.
  // Previously this only copied when the dest was missing, causing stale files
  // to persist after source updates — breaking mouse/keyboard actions if the
  // cached copy was from an older version.
  if (await pathExists(devRequirements)) {
    await writeFile(requirementsPath, await readFile(devRequirements, 'utf8'), 'utf8')
  }
  if (await pathExists(devHelper)) {
    await writeFile(defaultHelperPath, await readFile(devHelper, 'utf8'), 'utf8')
  }

  // Also copy uia_helper.py if present (Windows only for UIA Tree mode)
  if (isWindows) {
    const devUiaHelper = path.join(projectRoot, 'runtime', 'uia_helper.py')
    const uiaHelperPath = path.join(runtimeStateRoot, 'uia_helper.py')
    if (await pathExists(devUiaHelper)) {
      await writeFile(uiaHelperPath, await readFile(devUiaHelper, 'utf8'), 'utf8')
    }
  }
}

export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    // Extract runtime files (requirements.txt, mac_helper.py) to state dir
    await ensureRuntimeFiles()

    if (!(await pathExists(pythonBinPath()))) {
      logForDebugging('creating runtime venv at %s', { level: 'debug' })
      const pythonCmd = await getVenvCreationPythonCommand()
      await runOrThrow(pythonCmd, ['-m', 'venv', venvRoot], 'python venv creation')
    }

    const pipBin = isWindows
      ? path.join(venvRoot, 'Scripts', 'pip.exe')
      : path.join(venvRoot, 'bin', 'pip')
    if (!(await pathExists(pipBin))) {
      logForDebugging('bootstrapping pip with ensurepip', { level: 'debug' })
      await runOrThrow(pythonBinPath(), ['-m', 'ensurepip', '--upgrade'], 'ensurepip')
    }

    const requirements = await readFile(requirementsPath, 'utf8')
    const digest = createHash('sha256').update(requirements).digest('hex')
    let installedDigest = ''
    try {
      installedDigest = (await readFile(installStampPath, 'utf8')).trim()
    } catch {}

    if (installedDigest !== digest) {
      logForDebugging('installing python runtime dependencies', { level: 'debug' })
      await installRuntimeDependencies(requirementsPath)
      await writeFile(installStampPath, `${digest}\n`, 'utf8')
    }
  })()

  try {
    await bootstrapPromise
  } catch (error) {
    bootstrapPromise = undefined
    throw error
  }
}

export async function callPythonHelper<T>(
  command: string,
  payload: Record<string, unknown> = {},
  helperFile?: string,
): Promise<T> {
  await ensureBootstrapped()
  const resolvedHelperPath = helperFile
    ? path.join(runtimeStateRoot, helperFile)
    : defaultHelperPath
  const { code, stdout, stderr } = await execFileNoThrow(
    pythonBinPath(),
    [resolvedHelperPath, command, '--payload', JSON.stringify(payload)],
    { useCwd: false, env: getPythonCommandEnv() },
  )

  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr || `Python helper ${command} failed with code ${code}`)
  }

  let parsed: { ok: boolean; result?: T; error?: { message?: string } }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(stderr || stdout || `Python helper ${command} returned invalid JSON`)
  }

  if (!parsed.ok) {
    throw new Error(parsed.error?.message || `Python helper ${command} failed`)
  }

  return parsed.result as T
}

export function getRuntimePaths(): { projectRoot: string; runtimeStateRoot: string; venvRoot: string } {
  return { projectRoot, runtimeStateRoot, venvRoot }
}
