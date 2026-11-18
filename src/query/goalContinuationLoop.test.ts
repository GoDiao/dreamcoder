import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { getSessionId } from '../bootstrap/state.js'
import { clearThreadGoalHook, getThreadGoal, setThreadGoalHook } from '../goals/goalState.js'
import { QueryEngine } from '../QueryEngine.js'
import * as claudeApi from '../services/api/claude.js'
import * as autoCompact from '../services/compact/autoCompact.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import type { Message } from '../types/message.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import * as hooks from '../utils/hooks.js'
import { PROMPT_HOOK_UNMET_PREFIX } from '../utils/hooks/execPromptHook.js'
import { createAssistantMessage, createCompactBoundaryMessage, createUserMessage } from '../utils/messages.js'

const goalBlockingError = {
  blockingError: `${PROMPT_HOOK_UNMET_PREFIX}tests still failing`,
  command: '<dreamcoder-goal-hook>\n<goal-objective>\nall unit tests pass\n</goal-objective>',
}

function textOf(message: Message): string {
  if (message.type !== 'user') return ''
  const content = message.message.content
  return typeof content === 'string' ? content : content.map(block => ('text' in block ? block.text : '')).join('')
}

describe('/goal continuations in the query loop', () => {
  const spies: Array<ReturnType<typeof spyOn>> = []
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
  })

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  })

  test('are counted across a compaction and stop after the limit', async () => {
    let modelCalls = 0
    spies.push(
      spyOn(claudeApi, 'queryModelWithStreaming').mockImplementation(async function* () {
        modelCalls += 1
        const reply = createAssistantMessage({ content: `still working ${modelCalls}` })
        reply.message.model = 'claude-sonnet-4-5'
        yield reply
      } as never),
    )
    spies.push(
      spyOn(hooks, 'executeStopHooks').mockImplementation(async function* () {
        yield { blockingError: goalBlockingError }
      } as never),
    )
    let compactCalls = 0
    spies.push(
      spyOn(autoCompact, 'autoCompactIfNeeded').mockImplementation(async () => {
        compactCalls += 1
        if (compactCalls !== 4) return { wasCompacted: false }
        return {
          wasCompacted: true,
          compactionResult: {
            boundaryMarker: createCompactBoundaryMessage('auto', 0),
            summaryMessages: [createUserMessage({ content: 'Summary of the work so far.', isCompactSummary: true })],
            attachments: [],
            hookResults: [],
          },
        }
      }),
    )

    let appState = getDefaultAppState()
    const engine = new QueryEngine({
      cwd: process.cwd(),
      tools: [],
      commands: [],
      mcpClients: [],
      agents: [],
      canUseTool: async () => ({ behavior: 'allow' }) as never,
      getAppState: () => appState,
      setAppState: update => {
        appState = update(appState)
      },
      readFileCache: createFileStateCacheWithSizeLimit(10),
      userSpecifiedModel: 'claude-sonnet-4-5',
    })

    const continuations: string[] = []
    for await (const message of engine.submitMessage('make the tests pass')) {
      const text = textOf(message as Message)
      const match = text.match(/^Automatic \/goal continuation \((\d+) of 10\)/)
      if (match) continuations.push(match[1]!)
    }

    expect(compactCalls).toBeGreaterThan(4)
    expect(continuations).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    expect(modelCalls).toBe(11)
  })
  test('a goal blocked on the user ends the turn and stays active', async () => {
    let modelCalls = 0
    spies.push(
      spyOn(claudeApi, 'queryModelWithStreaming').mockImplementation(async function* () {
        modelCalls += 1
        const reply = createAssistantMessage({ content: 'I need the staging credentials from you.' })
        reply.message.model = 'claude-sonnet-4-5'
        yield reply
      } as never),
    )
    let evaluatorCalls = 0
    spies.push(
      spyOn(claudeApi, 'queryModelWithoutStreaming').mockImplementation(async () => {
        evaluatorCalls += 1
        return createAssistantMessage({ content: '{"ok":false,"blocked":true,"reason":"needs staging credentials"}' })
      }),
    )

    let appState = getDefaultAppState()
    const setAppState = (update: (prev: typeof appState) => typeof appState) => {
      appState = update(appState)
    }
    const sessionId = getSessionId()
    const goal = setThreadGoalHook({ setAppState }, sessionId, 'deploy to staging')

    try {
      const engine = new QueryEngine({
        cwd: process.cwd(),
        tools: [],
        commands: [],
        mcpClients: [],
        agents: [],
        canUseTool: async () => ({ behavior: 'allow' }) as never,
        getAppState: () => appState,
        setAppState,
        readFileCache: createFileStateCacheWithSizeLimit(10),
        userSpecifiedModel: 'claude-sonnet-4-5',
      })

      const texts: string[] = []
      for await (const message of engine.submitMessage('deploy it')) texts.push(textOf(message as Message))

      expect(evaluatorCalls).toBe(1)
      expect(modelCalls).toBe(1)
      expect(texts.some(text => text.startsWith('Automatic /goal continuation'))).toBe(false)
      expect(getThreadGoal(sessionId)?.hook).toBe(goal.hook)
      expect(appState.sessionHooks.get(sessionId)?.hooks.Stop?.length ?? 0).toBeGreaterThan(0)
    } finally {
      clearThreadGoalHook({ setAppState }, sessionId)
    }
  })
})
