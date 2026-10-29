import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import { IDLE_SPECULATION_STATE } from '../../state/AppStateStore.js'
import { createTaskStateBase } from '../../Task.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { Message } from '../../types/message.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  getCommandQueue,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import { createAssistantMessage } from '../../utils/messages.js'
import type { Tool, Tools } from '../../Tool.js'
import {
  createTeammateContext,
  runWithTeammateContext,
} from '../../utils/teammateContext.js'
import { ENTER_WORKTREE_TOOL_NAME } from '../EnterWorktreeTool/constants.js'
import { EXIT_WORKTREE_TOOL_NAME } from '../ExitWorktreeTool/constants.js'
import {
  filterToolsForAgent,
  runAsyncAgentLifecycle,
} from './agentToolUtils.js'

describe('runAsyncAgentLifecycle', () => {
  afterEach(() => {
    resetCommandQueue()
  })

  test('notifies the parent before post-completion cleanup finishes', async () => {
    const taskId = 'agent-notify-first'
    const abortController = new AbortController()
    const task: LocalAgentTaskState = {
      ...createTaskStateBase(taskId, 'local_agent', 'Review code', 'toolu_agent'),
      status: 'running',
      agentId: taskId,
      prompt: 'Review code',
      agentType: 'general-purpose',
      abortController,
      retrieved: false,
      lastReportedToolCount: 0,
      lastReportedTokenCount: 0,
      isBackgrounded: true,
      pendingMessages: [],
      retain: false,
      diskLoaded: false,
    }
    let appState = {
      tasks: { [taskId]: task },
      toolPermissionContext: getEmptyToolPermissionContext(),
      speculation: IDLE_SPECULATION_STATE,
    } as unknown as AppState
    const setAppState = (updater: (prev: AppState) => AppState): void => {
      appState = updater(appState)
    }
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'Review complete.' }],
    }) as Message
    let cleanupStarted = false

    async function* makeStream(): AsyncGenerator<Message, void> {
      yield message
    }

    const result = await Promise.race([
      runAsyncAgentLifecycle({
        taskId,
        abortController,
        makeStream,
        metadata: {
          prompt: 'Review code',
          resolvedAgentModel: 'test-model',
          isBuiltInAgent: true,
          startTime: Date.now(),
          agentType: 'general-purpose',
          isAsync: true,
        },
        description: 'Review code',
        toolUseContext: {
          options: { tools: [] },
          toolUseId: 'toolu_agent',
          getAppState: () => appState,
        } as unknown as ToolUseContext,
        rootSetAppState: setAppState,
        agentIdForCleanup: taskId,
        enableSummarization: false,
        getWorktreeResult: () => {
          cleanupStarted = true
          return new Promise(() => {})
        },
      }).then(() => 'completed'),
      new Promise(resolve => setTimeout(() => resolve('timed-out'), 50)),
    ])

    expect(result).toBe('completed')
    expect(cleanupStarted).toBe(true)
    expect(appState.tasks[taskId]?.status).toBe('completed')
    expect(getCommandQueue()).toHaveLength(1)
    expect(String(getCommandQueue()[0]?.value)).toContain(
      '<status>completed</status>',
    )
    expect(String(getCommandQueue()[0]?.value)).toContain('Review complete.')
  })
})

describe('filterToolsForAgent', () => {
  const namedTool = (name: string) => ({ name }) as unknown as Tool
  const tools: Tools = [
    'Read',
    'Edit',
    ENTER_WORKTREE_TOOL_NAME,
    EXIT_WORKTREE_TOOL_NAME,
  ].map(namedTool)
  const names = (filtered: Tools) => filtered.map(tool => tool.name)

  test('in-process teammates do not get the worktree tools', () => {
    // EnterWorktree changes the cwd of the whole process, which the lead and
    // every other in-process teammate share.
    const teammate = createTeammateContext({
      agentId: 'a@team',
      agentName: 'a',
      teamName: 'team',
      planModeRequired: false,
      parentSessionId: 'session',
      abortController: new AbortController(),
    })

    const filtered = runWithTeammateContext(teammate, () =>
      filterToolsForAgent({ tools, isBuiltIn: true, isAsync: true }),
    )

    expect(names(filtered)).toEqual(['Read', 'Edit'])
  })

  test('async agents outside a teammate keep the worktree tools', () => {
    const filtered = filterToolsForAgent({
      tools,
      isBuiltIn: true,
      isAsync: true,
    })

    expect(names(filtered)).toContain(ENTER_WORKTREE_TOOL_NAME)
    expect(names(filtered)).toContain(EXIT_WORKTREE_TOOL_NAME)
  })
})
