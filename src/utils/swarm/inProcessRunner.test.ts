import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getSessionId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import * as runAgentModule from '../../tools/AgentTool/runAgent.js'
import { drainSdkEvents } from '../sdkEventQueue.js'
import { sleep } from '../sleep.js'
import {
  clearLeaderTeamName,
  createTask,
  getTask,
  getTaskListId,
  setLeaderTeamName,
  type Task,
} from '../tasks.js'
import { createTeammateContext } from '../teammateContext.js'
import { runInProcessTeammate } from './inProcessRunner.js'

const TEAM = 'crew'
const TEAMMATE = 'alpha'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
let tmpDir: string
let lifecycle: AbortController
let running: Promise<unknown> | undefined
let runAgentSpy: ReturnType<typeof spyOn<typeof runAgentModule, 'runAgent'>>

async function* noTurns(): AsyncGenerator<never, void> {}

const pendingTask = (subject: string): Omit<Task, 'id'> => ({
  subject,
  description: '',
  status: 'pending',
  blocks: [],
  blockedBy: [],
})

function startTeammate(): void {
  const identity = {
    agentId: `${TEAMMATE}@${TEAM}`,
    agentName: TEAMMATE,
    teamName: TEAM,
    planModeRequired: false,
    parentSessionId: getSessionId(),
  }
  const appState = { tasks: {} } as unknown as AppState
  const toolUseContext = {
    options: { tools: [], mainLoopModel: 'sonnet', mcpClients: [] },
    getAppState: () => appState,
    setAppState: () => {},
  } as unknown as ToolUseContext
  running = runInProcessTeammate({
    identity,
    taskId: 'teammate-task',
    prompt: 'Wait for tasks from the lead.',
    teammateContext: createTeammateContext({
      ...identity,
      abortController: lifecycle,
    }),
    toolUseContext,
    abortController: lifecycle,
    systemPrompt: 'You are a teammate.',
    systemPromptMode: 'replace',
  })
}

async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 3_000
  let value = await read()
  while (!done(value) && Date.now() < deadline) {
    await sleep(25)
    value = await read()
  }
  return value
}

const promptsSentToTeammate = () =>
  runAgentSpy.mock.calls.flatMap(([params]) =>
    params.promptMessages.map(message => JSON.stringify(message)),
  )

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'in-process-runner-'))
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  lifecycle = new AbortController()
  runAgentSpy = spyOn(runAgentModule, 'runAgent').mockImplementation(noTurns)
  setLeaderTeamName(TEAM)
})

afterEach(async () => {
  lifecycle.abort()
  await running
  running = undefined
  drainSdkEvents()
  clearLeaderTeamName()
  runAgentSpy.mockRestore()
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('runInProcessTeammate', () => {
  it('claims a task the lead created in its team before the teammate started', async () => {
    const taskListId = getTaskListId()
    const id = await createTask(taskListId, pendingTask('Write the intro'))
    const tasksAtTurnStart: Array<Task | null> = []
    runAgentSpy.mockImplementation(async function* () {
      tasksAtTurnStart.push(await getTask(taskListId, id))
    })

    startTeammate()

    const [taskAtFirstTurn] = await eventually(
      async () => tasksAtTurnStart,
      seen => seen.length > 0,
    )
    expect(taskAtFirstTurn).toMatchObject({
      owner: TEAMMATE,
      status: 'in_progress',
    })
  })

  it('claims a task the lead creates in its team after the teammate went idle', async () => {
    startTeammate()
    await eventually(
      async () => runAgentSpy.mock.calls.length,
      calls => calls > 0,
    )

    const taskListId = getTaskListId()
    const id = await createTask(taskListId, pendingTask('Write the outro'))

    const task = await eventually(
      () => getTask(taskListId, id),
      found => found?.owner === TEAMMATE,
    )
    expect(task).toMatchObject({ owner: TEAMMATE, status: 'in_progress' })
    const prompts = await eventually(
      async () => promptsSentToTeammate(),
      sent => sent.some(prompt => prompt.includes('Write the outro')),
    )
    expect(prompts.some(prompt => prompt.includes('Write the outro'))).toBe(
      true,
    )
  })
})
