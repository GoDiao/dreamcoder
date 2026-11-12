import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getSessionId } from '../../bootstrap/state.js'
import {
  clearLeaderTeamName,
  createTask,
  getTaskListId,
  listTasks,
  type Task,
} from '../tasks.js'
import {
  restoreLeaderTeamName,
  restoreLeaderTeamNameOnResume,
} from './reconnection.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
const userTypeAtLoad = process.env.USER_TYPE
const agentTeamsAtLoad = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
let tmpDir: string

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const pendingTask = (subject: string): Omit<Task, 'id'> => ({
  subject,
  description: '',
  status: 'pending',
  blocks: [],
  blockedBy: [],
})

async function writeTeam(
  name: string,
  leadSessionId: string,
  createdAt = 1,
): Promise<void> {
  const teamDir = path.join(tmpDir, 'teams', name)
  await fs.mkdir(teamDir, { recursive: true })
  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify({
      name,
      createdAt,
      leadAgentId: `team-lead@${name}`,
      leadSessionId,
      members: [],
    }),
  )
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnection-'))
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  clearLeaderTeamName()
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('restoreLeaderTeamName', () => {
  it('points the lead back at the team it created before a restart', async () => {
    await writeTeam('keep-test', getSessionId())
    await createTask('keep-test', pendingTask('Write the intro'))
    expect(getTaskListId()).toBe(getSessionId())

    restoreLeaderTeamName()

    expect(getTaskListId()).toBe('keep-test')
    const tasks = await listTasks(getTaskListId())
    expect(tasks.map(task => task.subject)).toEqual(['Write the intro'])
  })

  it('ignores teams led by another session', async () => {
    await writeTeam('someone-elses', 'another-session')

    restoreLeaderTeamName()

    expect(getTaskListId()).toBe(getSessionId())
  })

  it('uses the newest team when the session led more than one', async () => {
    await writeTeam('older', getSessionId(), 1)
    await writeTeam('newer', getSessionId(), 2)

    restoreLeaderTeamName()

    expect(getTaskListId()).toBe('newer')
  })

  it('does nothing when no team has been created', () => {
    restoreLeaderTeamName()

    expect(getTaskListId()).toBe(getSessionId())
  })
})

describe('restoreLeaderTeamNameOnResume', () => {
  beforeEach(() => {
    delete process.env.USER_TYPE
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  })

  afterEach(() => {
    restoreEnv('USER_TYPE', userTypeAtLoad)
    restoreEnv('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', agentTeamsAtLoad)
  })

  it('restores the team name when agent teams are enabled', async () => {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    await writeTeam('keep-test', getSessionId())

    restoreLeaderTeamNameOnResume()

    expect(getTaskListId()).toBe('keep-test')
  })

  it('restores nothing when agent teams are disabled', async () => {
    await writeTeam('keep-test', getSessionId())

    restoreLeaderTeamNameOnResume()

    expect(getTaskListId()).toBe(getSessionId())
  })

  it('does not take over the team of the session it was forked from', async () => {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    await writeTeam('original-team', 'original-session')
    expect(getSessionId()).not.toBe('original-session')

    restoreLeaderTeamNameOnResume()

    expect(getTaskListId()).toBe(getSessionId())
  })
})
