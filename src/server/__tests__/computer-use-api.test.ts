import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
let configDir: string | null = null
let computerUseApi: typeof import('../api/computer-use.js') | null = null

async function importComputerUseApi() {
  if (!computerUseApi) throw new Error('Computer Use API module was not initialized')
  return computerUseApi
}

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/computer-use/authorized-apps', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function callAuthorizedApps(method: string, body?: unknown): Promise<Response> {
  const { handleComputerUseApi } = await importComputerUseApi()
  return handleComputerUseApi(
    makeRequest(method, body),
    new URL('http://localhost/api/computer-use/authorized-apps'),
    ['api', 'computer-use', 'authorized-apps'],
  )
}

beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'dreamcoder-computer-use-api-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  computerUseApi = await import('../api/computer-use.js')
})

beforeEach(async () => {
  if (!configDir) throw new Error('configDir was not initialized')
  process.env.CLAUDE_CONFIG_DIR = configDir
  await rm(join(configDir, 'dreamcoder'), { recursive: true, force: true })
  await rm(join(configDir, '.runtime'), { recursive: true, force: true })
})

afterAll(async () => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }

  if (configDir) {
    await rm(configDir, { recursive: true, force: true })
    configDir = null
  }
})

describe('Computer Use API authorized app config', () => {
  it('defaults Computer Use enabled for existing users without config', async () => {
    const res = await callAuthorizedApps('GET')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      enabled: true,
      authorizedApps: [],
    })
  })

  it('persists the Computer Use enabled flag independently', async () => {
    const putRes = await callAuthorizedApps('PUT', { enabled: false })
    expect(putRes.status).toBe(200)

    const getRes = await callAuthorizedApps('GET')
    expect(await getRes.json()).toMatchObject({ enabled: false })

    const raw = await readFile(
      join(configDir!, 'dreamcoder', 'computer-use-config.json'),
      'utf8',
    )
    expect(JSON.parse(raw)).toMatchObject({ enabled: false })
  })

  it('persists and normalizes a custom Python interpreter path', async () => {
    const pythonPath = '  C:\\Users\\me\\miniconda3\\envs\\cu\\python.exe  '
    const putRes = await callAuthorizedApps('PUT', { pythonPath })
    expect(putRes.status).toBe(200)

    const getRes = await callAuthorizedApps('GET')
    expect(await getRes.json()).toMatchObject({
      pythonPath: 'C:\\Users\\me\\miniconda3\\envs\\cu\\python.exe',
    })

    const resetRes = await callAuthorizedApps('PUT', { pythonPath: '' })
    expect(resetRes.status).toBe(200)

    const resetGetRes = await callAuthorizedApps('GET')
    expect(await resetGetRes.json()).toMatchObject({ pythonPath: null })
  })
})

describe('runPipInstallWithFallback', () => {
  it('builds a clear unsupported Python version step for setup', async () => {
    const { getUnsupportedPythonVersionStep } = await importComputerUseApi()

    expect(getUnsupportedPythonVersionStep('3.8.18')).toEqual({
      name: 'python_version',
      ok: false,
      message: 'Computer Use 需要 Python >= 3.9，当前版本为 3.8.18',
    })
    expect(getUnsupportedPythonVersionStep('3.9.19')).toBeNull()
  })

  it('installs setup dependencies by upgrading pip before requirements', async () => {
    const { installSetupDependencies } = await importComputerUseApi()
    const calls: string[] = []

    const result = await installSetupDependencies(
      'python',
      '/tmp/requirements.txt',
      async (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`)
        return { ok: true, stdout: args.includes('-r') ? 'deps' : 'pip', stderr: '', code: 0 }
      },
    )

    expect(result.stdout).toBe('deps')
    expect(calls).toEqual([
      'python -m pip install --upgrade pip',
      'python -m pip install -r /tmp/requirements.txt',
    ])
  })

  it('tries the mirror first and falls back to the default PyPI index', async () => {
    const { runPipInstallWithFallback } = await importComputerUseApi()
    const calls: string[] = []
    const result = await runPipInstallWithFallback(
      'python',
      ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      async (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`)
        if (args.includes('-i')) {
          return { ok: false, stdout: '', stderr: 'mirror unavailable', code: 1 }
        }
        return { ok: true, stdout: 'installed', stderr: '', code: 0 }
      },
    )

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('installed')
    expect(calls).toEqual([
      'python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/ --trusted-host pypi.tuna.tsinghua.edu.cn',
      'python -m pip install -r requirements.txt',
    ])
  })

  it('returns the first failure when every pip index attempt fails', async () => {
    const { runPipInstallWithFallback } = await importComputerUseApi()
    const result = await runPipInstallWithFallback(
      'python',
      ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      async (_cmd, args) => ({
        ok: false,
        stdout: '',
        stderr: args.includes('-i') ? 'mirror failed' : 'default failed',
        code: args.includes('-i') ? 1 : 2,
      }),
    )

    expect(result).toEqual({ ok: false, stdout: '', stderr: 'mirror failed', code: 1 })
  })
})
