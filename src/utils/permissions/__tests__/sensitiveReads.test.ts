import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, setOriginalCwd } from '../../../bootstrap/state.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { FileReadTool } from '../../../tools/FileReadTool/FileReadTool.js'
import {
  checkReadPermissionForTool,
  isSensitiveReadPath,
} from '../filesystem.js'

const originalCwd = getOriginalCwd()
let root: string
let project: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'sensitive-reads-')))
  project = join(root, 'project')
  await mkdir(project)
  setOriginalCwd(project)
})

afterEach(async () => {
  setOriginalCwd(originalCwd)
  await rm(root, { recursive: true, force: true })
})

const read = (
  path: string,
  context = getEmptyToolPermissionContext(),
) =>
  checkReadPermissionForTool(
    FileReadTool,
    { file_path: join(project, path) },
    context,
  )

describe('sensitive Read tool permissions', () => {
  test('asks before reading environment and credential files', () => {
    for (const path of [
      '.env',
      '.env.local',
      'credentials',
      'secrets.yaml',
      '.netrc',
      '.npmrc',
      '.pgpass',
      'token',
      join('.aws', 'credentials'),
    ]) {
      const result = read(path)
      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('safetyCheck')
    }
  })

  test('asks before reading SSH private keys', () => {
    for (const path of [
      join('.ssh', 'id_rsa'),
      join('.ssh', 'id_ed25519'),
      join('.ssh', 'id_custom'),
    ]) {
      expect(read(path).behavior).toBe('ask')
    }
  })

  test('allows safe SSH files, shell profiles, and ordinary project files', () => {
    for (const path of [
      'README.md',
      '.env.example',
      '.env.sample',
      '.env.template',
      '.env.dist',
      '.envrc',
      '.environment',
      join('.ssh', 'id_rsa.pub'),
      join('.ssh', 'known_hosts'),
      join('.ssh', 'config'),
      '.bashrc',
    ]) {
      expect(read(path).behavior).toBe('allow')
    }
  })

  test('matches case variants and Windows path separators', () => {
    expect(read('.ENV').behavior).toBe('ask')
    expect(isSensitiveReadPath('C:\\project\\.ssh\\ID_RSA')).toBe(true)
  })

  test('skips sensitive read prompts while bypass is active', () => {
    const bypassContext = {
      ...getEmptyToolPermissionContext(),
      mode: 'bypassPermissions' as const,
      isBypassPermissionsModeAvailable: true,
    }
    const planFromBypassContext = {
      ...getEmptyToolPermissionContext(),
      mode: 'plan' as const,
      isBypassPermissionsModeAvailable: true,
    }

    expect(read('.env').behavior).toBe('ask')
    expect(read('.env', bypassContext).behavior).toBe('allow')
    expect(read('.env', planFromBypassContext).behavior).toBe('allow')
  })

  test('checks the original name of a file symlink', async () => {
    const envDirectory = join(project, 'envs')
    await mkdir(envDirectory)
    await writeFile(join(envDirectory, 'prod.conf'), 'secret')
    try {
      await symlink(
        join(envDirectory, 'prod.conf'),
        join(project, '.env'),
        'file',
      )
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EPERM'
      ) {
        throw error
      }
      await symlink(envDirectory, join(project, '.env'), 'junction')
    }

    const result = read('.env')
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test('checks the resolved target of a directory symlink', async () => {
    const sshDirectory = join(root, 'outside', '.ssh')
    await mkdir(sshDirectory, { recursive: true })
    await writeFile(join(sshDirectory, 'id_rsa'), 'secret')
    await symlink(sshDirectory, join(project, 'keys'), 'junction')

    const result = read(join('keys', 'id_rsa'))
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })
})
