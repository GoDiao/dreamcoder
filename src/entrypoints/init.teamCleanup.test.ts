import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getSessionCreatedTeams } from '../bootstrap/state.js'
import { runCleanupFunctions } from '../utils/cleanupRegistry.js'
import { init } from './init.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
const apiKeyAtLoad = process.env.ANTHROPIC_API_KEY
let tmpDir: string

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  )

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-shutdown-'))
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(async () => {
  getSessionCreatedTeams().clear()
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  if (apiKeyAtLoad === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = apiKeyAtLoad
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('shutdown', () => {
  it('keeps a session team and its task list on disk', async () => {
    const teamDir = path.join(tmpDir, 'teams', 'crew')
    const taskDir = path.join(tmpDir, 'tasks', 'crew')
    await fs.mkdir(teamDir, { recursive: true })
    await fs.mkdir(taskDir, { recursive: true })
    await fs.writeFile(path.join(teamDir, 'config.json'), JSON.stringify({ name: 'crew', members: [] }))
    await fs.writeFile(path.join(taskDir, '1.json'), '{}')
    getSessionCreatedTeams().add('crew')

    await init()
    await runCleanupFunctions()

    expect(await exists(path.join(teamDir, 'config.json'))).toBe(true)
    expect(await exists(path.join(taskDir, '1.json'))).toBe(true)
  })
})
