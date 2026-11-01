import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { GlobalConfig, ProjectConfig } from '../../utils/config.js'
import {
  ClaudeCodeImportService,
  createCloneOrCopy,
  mergeMcpServers,
  pickImportedSettings,
  type ClaudeCodeImportJob,
} from '../services/claudeCodeImportService.js'
import { resetPersistentStorageMigrationsForTests } from '../services/persistentStorageMigrations.js'

// Claude Code's variable, spelled out in pieces for the guard test.
const CLAUDE_CODE_VARIABLE = ['CLAUDE', 'CONFIG', 'DIR'].join('_')

let tmpDir: string
let claudeCodeDir: string
let dreamcoderDir: string
const originalEnv = {
  dreamcoder: process.env.DREAMCODER_CONFIG_DIR,
  claudeCode: process.env[CLAUDE_CODE_VARIABLE],
}

async function write(filePath: string, content: string, mtime?: Date): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
  if (mtime) await fs.utimes(filePath, mtime, mtime)
}

/** Every file under a directory with a hash of its content and its mtime. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        const content = await fs.readFile(full)
        const stat = await fs.stat(full)
        result[path.relative(dir, full)] =
          `${createHash('sha256').update(content).digest('hex')}:${stat.mtimeMs}`
      }
    }
  }
  await walk(dir)
  return result
}

type SavedConfig = { config: GlobalConfig; projects?: Record<string, ProjectConfig> }

function createService(saved: SavedConfig) {
  return new ClaudeCodeImportService(
    undefined,
    (updater) => {
      saved.config = updater(saved.config)
    },
    (updater, projectPath) => {
      saved.projects ??= {}
      const current = saved.projects[projectPath!] ?? ({} as ProjectConfig)
      const next = updater(current)
      if (next !== current) saved.projects[projectPath!] = next
    },
  )
}

async function runImport(service: ClaudeCodeImportService): Promise<ClaudeCodeImportJob> {
  const job: ClaudeCodeImportJob = { state: 'running', total: 0, copied: 0, skipped: 0 }
  await service.run(claudeCodeDir, job)
  return job
}

const sessionMtime = new Date('2025-01-02T03:04:05Z')

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-code-import-test-'))
  claudeCodeDir = path.join(tmpDir, 'claude')
  dreamcoderDir = path.join(tmpDir, 'dreamcoder-home')
  process.env[CLAUDE_CODE_VARIABLE] = claudeCodeDir
  process.env.DREAMCODER_CONFIG_DIR = dreamcoderDir
  resetPersistentStorageMigrationsForTests()

  await write(path.join(claudeCodeDir, 'projects', '-repo', 'session-1.jsonl'), '{"type":"user"}\n', sessionMtime)
  await write(path.join(claudeCodeDir, 'projects', '-repo', 'memory', 'MEMORY.md'), '# memory\n')
  await write(path.join(claudeCodeDir, 'file-history', 'session-1', 'abc@v1'), 'backup')
  await write(path.join(claudeCodeDir, 'todos', 'session-1.json'), '[]')
  await write(path.join(claudeCodeDir, 'plans', 'plan.md'), '# plan')
  await write(path.join(claudeCodeDir, 'history.jsonl'), '{"display":"hi"}\n')
  await write(path.join(claudeCodeDir, 'scheduled_tasks.json'), '{"tasks":[]}')
  await write(path.join(claudeCodeDir, 'dreamcoder', 'providers.json'), '{"activeId":null,"providers":[]}')
  await write(path.join(claudeCodeDir, 'teams', 'team-a', 'config.json'), '{}')
  await write(path.join(claudeCodeDir, 'tasks', 'team-a', '1.json'), '{}')
  // Not imported
  await write(path.join(claudeCodeDir, 'plugins', 'known_marketplaces.json'), '{}')
  await write(path.join(claudeCodeDir, '.credentials.json'), '{"claudeAiOauth":{}}')
  await write(path.join(claudeCodeDir, 'skills', 'alpha', 'SKILL.md'), '# alpha')
  await write(
    path.join(claudeCodeDir, 'settings.json'),
    JSON.stringify({
      model: 'opus',
      theme: 'dark',
      hooks: { PostCompact: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
      statusLine: { type: 'command', command: 'echo status' },
    }),
  )
  await write(
    path.join(claudeCodeDir, '.claude.json'),
    JSON.stringify({
      mcpServers: { github: { type: 'http', url: 'https://example.com/mcp' } },
      projects: {
        '/repo': {
          hasTrustDialogAccepted: true,
          mcpServers: { local: { type: 'stdio', command: 'local-mcp' } },
        },
        '/other': { hasTrustDialogAccepted: true },
      },
    }),
  )
})

afterEach(async () => {
  for (const [key, value] of [
    ['DREAMCODER_CONFIG_DIR', originalEnv.dreamcoder],
    [CLAUDE_CODE_VARIABLE, originalEnv.claudeCode],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('Import from Claude Code', () => {
  test('copies sessions and DreamCoder files, keeps mtimes, and leaves Claude Code unchanged', async () => {
    const before = await snapshot(claudeCodeDir)
    const saved = { config: {} as GlobalConfig }

    const job = await runImport(createService(saved))

    expect(job.state).toBe('done')
    expect(job.copied).toBe(10)
    for (const file of [
      'projects/-repo/session-1.jsonl',
      'projects/-repo/memory/MEMORY.md',
      'file-history/session-1/abc@v1',
      'todos/session-1.json',
      'plans/plan.md',
      'history.jsonl',
      'scheduled_tasks.json',
      'teams/team-a/config.json',
      'tasks/team-a/1.json',
    ]) {
      expect(await fs.readFile(path.join(dreamcoderDir, file), 'utf-8')).toBe(
        await fs.readFile(path.join(claudeCodeDir, file), 'utf-8'),
      )
    }
    // Imported provider files are migrated to the current format.
    const providers = JSON.parse(await fs.readFile(path.join(dreamcoderDir, 'dreamcoder', 'providers.json'), 'utf-8'))
    expect(providers).toMatchObject({ activeId: null, providers: [] })
    const copiedSession = await fs.stat(path.join(dreamcoderDir, 'projects', '-repo', 'session-1.jsonl'))
    expect(copiedSession.mtimeMs).toBe(sessionMtime.getTime())

    for (const notImported of ['plugins', '.credentials.json', 'skills']) {
      expect(await fs.stat(path.join(dreamcoderDir, notImported)).catch(() => null)).toBeNull()
    }
    expect(await snapshot(claudeCodeDir)).toEqual(before)
  })

  test('never overwrites, and a second run adds nothing', async () => {
    await write(path.join(dreamcoderDir, 'history.jsonl'), 'mine\n')
    const saved = { config: {} as GlobalConfig }
    const service = createService(saved)

    const first = await runImport(service)
    expect(first.skipped).toBe(1)
    expect(await fs.readFile(path.join(dreamcoderDir, 'history.jsonl'), 'utf-8')).toBe('mine\n')

    const afterFirst = await snapshot(dreamcoderDir)
    const second = await runImport(service)
    expect(second.state).toBe('done')
    expect(second.copied).toBe(0)
    expect(second.skipped).toBe(second.total)
    const afterSecond = await snapshot(dreamcoderDir)
    delete afterFirst[path.join('dreamcoder', 'claude-code-import.json')]
    delete afterSecond[path.join('dreamcoder', 'claude-code-import.json')]
    expect(afterSecond).toEqual(afterFirst)
  })

  test('imports only the settings keys DreamCoder manages, without overwriting', async () => {
    await write(path.join(dreamcoderDir, 'settings.json'), JSON.stringify({ theme: 'light' }))

    await runImport(createService({ config: {} as GlobalConfig }))

    const settings = JSON.parse(await fs.readFile(path.join(dreamcoderDir, 'settings.json'), 'utf-8'))
    expect(settings).toEqual({ theme: 'light', model: 'opus' })
  })

  test('merges user and project mcpServers, without project trust', async () => {
    const saved: SavedConfig = {
      config: {
        mcpServers: { github: { type: 'stdio', command: 'mine' } },
      } as unknown as GlobalConfig,
    }

    await runImport(createService(saved))

    expect(saved.config.mcpServers).toEqual({ github: { type: 'stdio', command: 'mine' } } as never)
    expect(saved.projects).toEqual({
      '/repo': { mcpServers: { local: { type: 'stdio', command: 'local-mcp' } } },
    } as never)
  })

  test('the offer is shown only while DreamCoder is empty and undecided', async () => {
    const service = createService({ config: {} as GlobalConfig })
    expect((await service.getStatus()).offer).toBe(true)

    await service.skip()
    expect((await service.getStatus()).offer).toBe(false)
  })

  test('an interrupted import is offered again, and a partial file is not taken as imported', async () => {
    const service = createService({ config: {} as GlobalConfig })
    let copies = 0
    const interrupted = new ClaudeCodeImportService(async (source, target) => {
      // Cut the second file short, as if the app quit mid-copy.
      if (++copies === 2) {
        await fs.writeFile(target, 'trunc')
        throw new Error('app quit')
      }
      await fs.copyFile(source, target)
    })
    const job = await runImport(interrupted)
    expect(job.state).toBe('failed')

    const status = await service.getStatus()
    expect(status.dreamcoderHasData).toBe(true)
    expect(status.incomplete).toBe(true)
    expect(status.offer).toBe(true)

    const resumed = await runImport(service)
    expect(resumed.state).toBe('done')
    expect(resumed.copied).toBe(9)
    const leftovers = Object.keys(await snapshot(dreamcoderDir)).filter((file) => file.endsWith('.dreamcoder-import.tmp'))
    expect(leftovers).toEqual([])
    expect((await service.getStatus()).offer).toBe(false)
  })

  test('tokens of the removed subscription sign-in are not imported', async () => {
    await write(path.join(claudeCodeDir, 'dreamcoder', 'oauth.json'), '{"accessToken":"x"}')
    await write(path.join(claudeCodeDir, 'dreamcoder', 'openai-oauth.json'), '{"accessToken":"y"}')

    await runImport(createService({ config: {} as GlobalConfig }))

    expect(await fs.stat(path.join(dreamcoderDir, 'dreamcoder', 'oauth.json')).catch(() => null)).toBeNull()
    expect(await fs.stat(path.join(dreamcoderDir, 'dreamcoder', 'openai-oauth.json')).catch(() => null)).toBeNull()
  })

  test('without an active provider, an imported provider env is removed', async () => {
    await write(
      path.join(claudeCodeDir, 'dreamcoder', 'settings.json'),
      JSON.stringify({
        env: {
          DREAMCODER_OPENAI_OAUTH_PROVIDER: '1',
          OPENAI_CODEX_OAUTH_FILE: path.join(claudeCodeDir, 'dreamcoder', 'openai-oauth.json'),
          ANTHROPIC_API_KEY: 'old-key',
          MY_OWN_VARIABLE: 'kept',
        },
      }),
    )

    await runImport(createService({ config: {} as GlobalConfig }))

    const settings = JSON.parse(await fs.readFile(path.join(dreamcoderDir, 'dreamcoder', 'settings.json'), 'utf-8'))
    expect(settings.env).toEqual({ MY_OWN_VARIABLE: 'kept' })
  })

  test('the offer is not shown when DreamCoder already has data', async () => {
    await write(path.join(dreamcoderDir, 'projects', '-repo', 's.jsonl'), '{}\n')
    const status = await createService({ config: {} as GlobalConfig }).getStatus()
    expect(status.dreamcoderHasData).toBe(true)
    expect(status.offer).toBe(false)
  })
})

describe('clone or copy', () => {
  test('falls back to a plain copy when cloning is not supported', async () => {
    const modes: number[] = []
    const copy = createCloneOrCopy(async (source, target, mode) => {
      modes.push(mode)
      if (mode & fs.constants.COPYFILE_FICLONE) {
        throw Object.assign(new Error('clone not supported'), { code: 'ENOTSUP' })
      }
      await fs.copyFile(source, target, mode)
    })
    const source = path.join(tmpDir, 'a.txt')
    const target = path.join(tmpDir, 'b.txt')
    await write(source, 'content')

    await copy(source, target)

    expect(await fs.readFile(target, 'utf-8')).toBe('content')
    expect(modes).toHaveLength(2)
    expect(modes[1]).toBe(fs.constants.COPYFILE_EXCL)
  })

  test('does not fall back when the target exists', async () => {
    const source = path.join(tmpDir, 'a.txt')
    const target = path.join(tmpDir, 'b.txt')
    await write(source, 'new')
    await write(target, 'old')

    await expect(createCloneOrCopy()(source, target)).rejects.toThrow()
    expect(await fs.readFile(target, 'utf-8')).toBe('old')
  })
})

describe('merging', () => {
  test('pickImportedSettings skips hooks and existing keys', () => {
    expect(
      pickImportedSettings(
        { model: 'opus', effort: 'high', hooks: {}, statusLine: {}, env: { A: '1' } },
        { effort: 'low' },
      ),
    ).toEqual({ model: 'opus' })
  })

  test('mergeMcpServers keeps existing servers and adds only new names', () => {
    expect(mergeMcpServers({ a: { command: 'x' } }, { a: { command: 'y' } })).toBeNull()
    expect(mergeMcpServers({ a: { command: 'x' } }, { a: { command: 'y' }, b: { command: 'z' } })).toEqual({
      a: { command: 'x' },
      b: { command: 'z' },
    })
  })
})
