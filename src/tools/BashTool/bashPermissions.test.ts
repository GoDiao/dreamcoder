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
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state'
import { getEmptyToolPermissionContext } from '../../Tool'
import {
  BINARY_HIJACK_VARS,
  getFirstWordPrefix,
  getSimpleCommandPrefix,
  matchWildcardPattern,
  stripAllLeadingEnvVars,
  stripSafeWrappers,
  stripWrappersFromArgv,
} from './bashPermissions'
import { checkPathConstraints } from './pathValidation'
import { checkReadOnlyConstraints } from './readOnlyValidation'

const originalCwd = getOriginalCwd()
const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
let root: string
let project: string
let home: string

describe('bash permission command normalization', () => {
  test('extracts stable prefixes only through safe env vars', () => {
    expect(getSimpleCommandPrefix('NODE_ENV=production npm run build')).toBe('npm run')
    expect(getSimpleCommandPrefix('MY_VAR=value npm run build')).toBeNull()
    expect(getSimpleCommandPrefix('git commit -m "fix"')).toBe('git commit')
    expect(getSimpleCommandPrefix('chmod 755 file')).toBeNull()
  })

  test('uses first-word fallback without suggesting broad shell wrappers', () => {
    expect(getFirstWordPrefix('python3 script.py 2>&1 | tail -20')).toBe('python3')
    expect(getFirstWordPrefix('bash -c "rm -rf /tmp/x"')).toBeNull()
    expect(getFirstWordPrefix('./script.sh')).toBeNull()
  })

  test('strips only safe wrappers and leading safe env assignments', () => {
    expect(stripSafeWrappers('RUST_LOG=debug timeout -k 5s --signal TERM 10s nohup nice -n 5 -- git status')).toBe('git status')
    expect(stripSafeWrappers('timeout -k$(id) 10s ls')).toBe('timeout -k$(id) 10s ls')
    expect(stripSafeWrappers('timeout 10s FOO=bar npm test')).toBe('FOO=bar npm test')
  })

  test('normalizes wrapper argv with the same safety boundary', () => {
    expect(stripWrappersFromArgv(['timeout', '--signal', 'TERM', '10s', 'nohup', 'git', 'status'])).toEqual(['git', 'status'])
    expect(stripWrappersFromArgv(['timeout', '--signal', '$(id)', '10s', 'ls'])).toEqual(['timeout', '--signal', '$(id)', '10s', 'ls'])
    expect(stripWrappersFromArgv(['nice', '-n', '5', '--', 'git', 'status'])).toEqual(['git', 'status'])
  })

  test('strips arbitrary leading env vars for deny matching but keeps binary hijack vars', () => {
    expect(stripAllLeadingEnvVars('FOO=bar TOKEN="safe value" claude --help')).toBe('claude --help')
    expect(stripAllLeadingEnvVars('PATH=/tmp/bin claude --help', BINARY_HIJACK_VARS)).toBe('PATH=/tmp/bin claude --help')
  })

  test('matches wildcard permission patterns consistently', () => {
    expect(matchWildcardPattern('git *', 'git status --short')).toBe(true)
    expect(matchWildcardPattern('git commit', 'git status')).toBe(false)
  })
})

describe('bash sensitive read permissions', () => {
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'issue-145-bash-')))
    project = join(root, 'project')
    home = join(root, 'home')
    await mkdir(join(project, '.ssh'), { recursive: true })
    await mkdir(join(home, '.ssh'), { recursive: true })
    await writeFile(join(project, '.env'), 'secret')
    await writeFile(join(project, '.ssh', 'id_rsa'), 'secret')
    await writeFile(join(home, '.ssh', 'id_rsa'), 'secret')
    process.env.HOME = home
    process.env.USERPROFILE = home
    setOriginalCwd(project)
  })

  afterEach(async () => {
    setOriginalCwd(originalCwd)
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalUserProfile
    await rm(root, { recursive: true, force: true })
  })

  const check = (
    command: string,
    context = getEmptyToolPermissionContext(),
  ) =>
    checkPathConstraints(
      { command },
      project,
      context,
    )

  test('asks before reading environment and credential files', () => {
    for (const command of [
      'cat .env',
      'cat .ENV',
      'cat .env.local',
      'cat .env*',
      'head -n 5 credentials',
      'grep token secrets.yaml',
      'cat .netrc',
      'cat .npmrc',
      'cat .pgpass',
      'cat token',
      'cat .aws/credentials',
    ]) {
      const result = check(command)
      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('safetyCheck')
    }
  })

  test('asks before reading SSH private keys', () => {
    for (const command of [
      'cat .ssh/id_rsa',
      'cat .ssh/ID_RSA',
      'head -n 1 .ssh/id_ed25519',
      'cat .ssh/id_*',
    ]) {
      expect(check(command).behavior).toBe('ask')
    }
  })

  test('checks every read-only command that accepts file paths', () => {
    for (const command of [
      'tac .env',
      'rev .env',
      'fold .env',
      'expand .env',
      'unexpand .env',
      'fmt .env',
      'pr .env',
      'comm .env README.md',
      'cmp .env README.md',
      'tsort .env',
    ]) {
      expect(check(command).behavior).toBe('ask')
    }
  })

  test('checks files matched by glob patterns', () => {
    for (const command of [
      'cat .e*',
      'cat .en?',
      'cat .[e]nv',
      'cat .*',
      'cat .ssh/*',
      'cat .ssh/i*',
      'cat ~/.ssh/*',
    ]) {
      expect(check(command).behavior).toBe('ask')
    }
  })

  test('asks for glob patterns in directory segments', () => {
    expect(check('cat .s*/id_rsa').behavior).toBe('ask')
  })

  test('checks the original name of a file symlink', async () => {
    const envDirectory = join(project, 'envs')
    await mkdir(envDirectory)
    await writeFile(join(envDirectory, 'prod.conf'), 'secret')
    await rm(join(project, '.env'))
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

    expect(check('cat .env').behavior).toBe('ask')
  })

  test('allows environment templates but protects environment variants', () => {
    for (const command of [
      'cat .env.example',
      'cat .env.sample',
      'cat .env.template',
      'cat .env.dist',
      'cat .envrc',
      'cat .environment',
    ]) {
      expect(check(command).behavior).toBe('passthrough')
    }
    expect(check('cat .env.local').behavior).toBe('ask')
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

    expect(check('cat .env').behavior).toBe('ask')
    expect(check('cat .env', bypassContext).behavior).toBe('passthrough')
    expect(check('cat .env', planFromBypassContext).behavior).toBe(
      'passthrough',
    )
  })

  test('does not suggest an ineffective directory allow rule', () => {
    expect(check('cat .env').suggestions).toEqual([])
  })

  test('keeps safe SSH files and ordinary reads on the read-only path', () => {
    for (const command of [
      'cat README.md',
      'cat .ssh/id_rsa.pub',
      'cat .ssh/known_hosts',
      'cat .ssh/config',
      'cat .bashrc',
    ]) {
      expect(check(command).behavior).toBe('passthrough')
    }
  })
})

describe('bash data-backed read-only permissions', () => {
  test('allows only the exact shell no-op shape', () => {
    expect(checkReadOnlyConstraints({ command: ':' }, false).behavior).toBe(
      'allow',
    )
    expect(
      checkReadOnlyConstraints({ command: ': $(whoami)' }, false).behavior,
    ).toBe('passthrough')
    expect(
      checkReadOnlyConstraints({ command: ': && rm x' }, false).behavior,
    ).not.toBe('allow')
  })
})
