import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setMemberActive } from './teamHelpers.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
let tmpDir: string

const teamFile = (team: string) => path.join(tmpDir, 'teams', team, 'config.json')
const readTeam = async (team: string) =>
  JSON.parse(await fs.readFile(teamFile(team), 'utf-8')) as {
    members: Array<{ name: string; isActive?: boolean }>
  }

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'set-member-active-'))
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  await fs.mkdir(path.join(tmpDir, 'teams', 'crew'), { recursive: true })
  await fs.writeFile(
    teamFile('crew'),
    JSON.stringify({
      name: 'crew',
      members: [{ name: 'team-lead' }, { name: 'alpha' }, { name: 'beta' }],
    }),
  )
})

afterEach(async () => {
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('setMemberActive', () => {
  it('keeps every update when teammates write at the same time', async () => {
    await Promise.all([
      setMemberActive('crew', 'alpha', false),
      setMemberActive('crew', 'beta', false),
    ])
    const { members } = await readTeam('crew')
    expect(members.find(m => m.name === 'alpha')?.isActive).toBe(false)
    expect(members.find(m => m.name === 'beta')?.isActive).toBe(false)
  })

  it('does not bring back a deleted team', async () => {
    await fs.rm(path.join(tmpDir, 'teams', 'crew'), { recursive: true })
    await setMemberActive('crew', 'alpha', false)
    await expect(fs.access(path.join(tmpDir, 'teams', 'crew'))).rejects.toThrow()
  })
})
