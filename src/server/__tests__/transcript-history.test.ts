import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionService } from '../services/sessionService.js'
import { collectTaskNotifications, entriesToMessages, type MessageEntry } from '../transcript/entries.js'
import {
  collectAgentNotifications,
  findLastTodos,
  hasUserMessagesAfterTaskCompletion,
  interpretTranscript,
} from '../transcript/history.js'

const FIXTURES_DIR = path.join(import.meta.dir, 'fixtures', 'transcripts')

describe('interpretTranscript', () => {
  it('keeps thinking, text, tool use and tool result in order with their parent tool', () => {
    const messages: MessageEntry[] = [
      {
        id: 'assistant-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        parentToolUseId: 'agent-1',
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: '目录结构分析' },
          { type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: 'src/App.tsx' } },
        ],
      },
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:01.000Z',
        parentToolUseId: 'agent-1',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok', is_error: false }],
      },
    ]

    const items = interpretTranscript(messages)

    expect(items.map((item) => item.type)).toEqual(['thinking', 'assistant_text', 'tool_use', 'tool_result'])
    expect(items[2]).toMatchObject({ parentToolUseId: 'agent-1' })
    expect(items[3]).toMatchObject({ parentToolUseId: 'agent-1' })
  })

  it('uses structured AskUserQuestion answers from toolUseResult', () => {
    const items = interpretTranscript([
      {
        id: 'assistant-ask',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'ask-1', input: { questions: [] } }],
      },
      {
        id: 'user-answer',
        type: 'tool_result',
        timestamp: '2026-04-06T00:00:01.000Z',
        content: [{ type: 'tool_result', tool_use_id: 'ask-1', content: 'User has answered your questions.' }],
        toolUseResult: {
          questions: [{ question: 'Pick one?', options: [{ label: 'A' }, { label: 'B' }] }],
          answers: { 'Pick one?': 'A' },
        },
      },
    ])

    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'ask-1',
      content: { answers: { 'Pick one?': 'A' } },
    })
  })

  it('collapses a compact boundary and its summary into one card after the earlier messages', () => {
    const items = interpretTranscript([
      { id: 'old-user', type: 'user', content: 'Build the billing import flow', timestamp: '2026-05-19T09:59:58.000Z' },
      { id: 'old-assistant', type: 'assistant', content: 'Implemented the flow.', timestamp: '2026-05-19T09:59:59.000Z' },
      { id: 'compact-boundary', type: 'system', content: 'Conversation compacted', timestamp: '2026-05-19T10:00:00.000Z' },
      {
        id: 'compact-summary',
        type: 'user',
        content: [
          'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
          '',
          'Kept the billing import implementation details and next verification steps.',
          '',
          'If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /tmp/transcript.jsonl',
        ].join('\n'),
        timestamp: '2026-05-19T10:00:01.000Z',
      },
    ])

    expect(items).toMatchObject([
      { id: 'old-user', type: 'user_text', content: 'Build the billing import flow' },
      { id: 'old-assistant', type: 'assistant_text', content: 'Implemented the flow.' },
      {
        type: 'compact_summary',
        title: 'Context compacted',
        summary: 'Kept the billing import implementation details and next verification steps.',
      },
    ])
    expect(items).toHaveLength(3)
  })

  it('drops the /compact stdout that follows a compaction summary', () => {
    const items = interpretTranscript([
      {
        id: 'compact-summary',
        type: 'user',
        content: 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nKept the billing import implementation details.',
        timestamp: '2026-05-19T10:00:01.000Z',
      },
      {
        id: 'compact-stdout',
        type: 'user',
        content: '<local-command-stdout>Compacted </local-command-stdout>',
        timestamp: '2026-05-19T10:00:02.000Z',
      },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'compact_summary', summary: 'Kept the billing import implementation details.' })
  })

  it('drops the /compact stdout when compaction hooks append their output', () => {
    const items = interpretTranscript([
      {
        id: 'compact-stdout',
        type: 'user',
        content: '<local-command-stdout>Compacted PostCompact [notify.sh] completed successfully: {}</local-command-stdout>',
        timestamp: '2026-05-19T10:00:02.000Z',
      },
      {
        id: 'compacted-word',
        type: 'user',
        content: '<local-command-stdout>CompactedFiles: 3</local-command-stdout>',
        timestamp: '2026-05-19T10:00:03.000Z',
      },
    ])

    expect(items.map((item) => item.id)).toEqual(['compacted-word'])
  })

  it('restores saved memory events', () => {
    const items = interpretTranscript([
      {
        id: 'memory-1',
        type: 'system',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: {
          subtype: 'memory_saved',
          writtenPaths: ['/Users/test/.claude/projects/example/memory/preferences.md'],
          teamCount: 0,
        },
      },
    ])

    expect(items).toMatchObject([
      {
        id: 'memory-1',
        type: 'memory_event',
        event: 'saved',
        files: [{ path: '/Users/test/.claude/projects/example/memory/preferences.md', action: 'saved' }],
        teamCount: 0,
      },
    ])
  })

  it('keeps transcript message ids for branching and rewind', () => {
    const items = interpretTranscript([
      { id: 'transcript-user-1', type: 'user', timestamp: '2026-04-06T00:00:00.000Z', content: '请从这里继续' },
      {
        id: 'transcript-assistant-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:01.000Z',
        model: 'opus',
        content: [
          { type: 'text', text: '这里是答复。' },
          { type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: 'src/App.tsx' } },
        ],
      },
    ])

    expect(items).toMatchObject([
      { id: 'transcript-user-1', type: 'user_text', transcriptMessageId: 'transcript-user-1' },
      { type: 'assistant_text', transcriptMessageId: 'transcript-assistant-1' },
      { type: 'tool_use' },
    ])
  })

  it('turns /goal breadcrumbs into a visible command and a goal event', () => {
    const items = interpretTranscript([
      {
        id: 'goal-command',
        type: 'system',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '<command-name>/goal</command-name>\n<command-args>ship the smoke test</command-args>',
      },
      {
        id: 'goal-output',
        type: 'system',
        timestamp: '2026-04-06T00:00:01.000Z',
        content: '<local-command-stdout>Goal set: ship the smoke test</local-command-stdout>',
      },
    ])

    expect(items).toMatchObject([
      { id: 'goal-command', type: 'user_text', content: '/goal ship the smoke test' },
      { id: 'goal-output', type: 'goal_event', action: 'created', status: 'active', objective: 'ship the smoke test' },
    ])
  })

  it('restores a completed /goal from its breadcrumbs', () => {
    const items = interpretTranscript([
      {
        id: 'goal-command',
        type: 'system',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '<command-name>/goal</command-name>\n<command-args>ship the smoke test</command-args>',
      },
      {
        id: 'goal-output',
        type: 'system',
        timestamp: '2026-04-06T00:00:01.000Z',
        content: '<local-command-stdout>Goal set: ship the smoke test</local-command-stdout>',
      },
      {
        id: 'goal-complete',
        type: 'system',
        timestamp: '2026-04-06T00:00:02.000Z',
        content: '<local-command-stdout>Goal marked complete.</local-command-stdout>',
      },
    ])

    expect(items).toMatchObject([
      { id: 'goal-command', type: 'user_text', content: '/goal ship the smoke test' },
      { id: 'goal-output', type: 'goal_event', action: 'created', objective: 'ship the smoke test' },
      { id: 'goal-complete', type: 'goal_event', action: 'completed', message: 'Goal marked complete.' },
    ])
  })

  it('merges consecutive text blocks of one assistant message', () => {
    const items = interpretTranscript([
      {
        id: 'assistant-merge-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        content: [
          { type: 'text', text: '第一段：Windows 下的桌面端输出。' },
          { type: 'text', text: '\r\n第二段：刷新后也不应该被拆开。' },
        ],
      },
    ])

    expect(items).toMatchObject([
      { type: 'assistant_text', content: '第一段：Windows 下的桌面端输出。\r\n第二段：刷新后也不应该被拆开。' },
    ])
    expect(items).toHaveLength(1)
  })

  it('skips whitespace-only assistant messages', () => {
    const items = interpretTranscript([
      { id: 'assistant-empty', type: 'assistant', timestamp: '2026-04-06T00:00:00.000Z', content: '\n\n  ' },
      { id: 'assistant-real', type: 'assistant', timestamp: '2026-04-06T00:00:01.000Z', content: '可见回复' },
    ])

    expect(items).toMatchObject([{ id: 'assistant-real', type: 'assistant_text', content: '可见回复' }])
    expect(items).toHaveLength(1)
  })

  it('shows teammate prompts only for team member transcripts', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '<teammate-message teammate_id="security-reviewer">Review the auth diff and call out risks.</teammate-message>',
      },
    ]

    expect(interpretTranscript(messages)).toEqual([])
    expect(interpretTranscript(messages, { includeTeammateMessages: true })).toMatchObject([
      { type: 'user_text', content: 'Review the auth diff and call out risks.' },
    ])
  })

  it('keeps the user id and attachments of array-content prompts', () => {
    const items = interpretTranscript([
      {
        id: 'user-with-attachment',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          { type: 'text', text: '请看这个文件' },
          { type: 'file', name: 'report.md' },
        ],
      },
    ])

    expect(items).toMatchObject([
      {
        id: 'user-with-attachment',
        type: 'user_text',
        content: '请看这个文件',
        attachments: [{ type: 'file', name: 'report.md' }],
      },
    ])
  })

  it('turns leading CLI file mentions into attachments and keeps the original text', () => {
    const items = interpretTranscript([
      {
        id: 'user-with-file-mention',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '@"/private/tmp/example/src/sentinel.ts" 这个常量是什么？',
      },
    ])

    expect(items).toMatchObject([
      {
        id: 'user-with-file-mention',
        type: 'user_text',
        content: '这个常量是什么？',
        modelContent: '@"/private/tmp/example/src/sentinel.ts" 这个常量是什么？',
        attachments: [{ type: 'file', name: 'sentinel.ts', path: '/private/tmp/example/src/sentinel.ts' }],
      },
    ])
  })

  it('gives every item a unique, deterministic id', () => {
    const messages: MessageEntry[] = [
      { id: 'dup', type: 'user', timestamp: '2026-04-06T00:00:00.000Z', content: 'first' },
      { id: 'dup', type: 'user', timestamp: '2026-04-06T00:00:01.000Z', content: 'second' },
      {
        id: 'a1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:02.000Z',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'tool_use', name: 'Read', id: 'tool-1', input: {} },
        ],
      },
    ]

    const ids = interpretTranscript(messages).map((item) => item.id)

    expect(ids).toEqual(['dup', 'dup#2', 'a1:0', 'a1:1'])
    expect(interpretTranscript(messages).map((item) => item.id)).toEqual(ids)
  })
})

describe('collectAgentNotifications', () => {
  const agentCall: MessageEntry = {
    id: 'lead-1',
    type: 'tool_use',
    timestamp: '2026-04-06T00:00:00.000Z',
    content: [{ type: 'tool_use', name: 'Agent', id: 'toolu_researcher', input: { name: 'researcher' } }],
  }
  const teammateReply: MessageEntry = {
    id: 'lead-2',
    type: 'user',
    timestamp: '2026-04-06T00:00:01.000Z',
    content: '<teammate-message teammate_id="researcher">Found the 404.</teammate-message>',
  }

  it("treats a team agent's first teammate reply as its completion", () => {
    expect(collectAgentNotifications([agentCall, teammateReply], [])).toEqual({
      toolu_researcher: {
        taskId: 'toolu_researcher',
        toolUseId: 'toolu_researcher',
        status: 'completed',
        summary: 'Found the 404.',
      },
    })
  })

  it('lets a recorded task notification override the teammate reply for the same call', () => {
    const restored = collectAgentNotifications([agentCall, teammateReply], [
      { taskId: 'task-9', toolUseId: 'toolu_researcher', status: 'failed', timestamp: '2026-04-06T00:00:02.000Z' },
    ])

    expect(restored.toolu_researcher).toEqual({
      taskId: 'task-9',
      toolUseId: 'toolu_researcher',
      status: 'failed',
      timestamp: '2026-04-06T00:00:02.000Z',
    })
  })
})

describe('entriesToMessages', () => {
  const user = (uuid: string, content: unknown) => ({ type: 'user', uuid, message: { role: 'user', content } })
  const assistant = (uuid: string, text: string) => ({
    type: 'assistant',
    uuid,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })

  it('drops a task-notification turn, including its tool calls, until the next real user message', () => {
    const messages = entriesToMessages([
      user('user-real-1', '创建项目'),
      assistant('assistant-real-1', '项目创建好了'),
      user('task-notification', '<task-notification>\n<task-id>bg-1</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>\n</task-notification>'),
      assistant('assistant-task-response', '旧后台任务通知，无需处理'),
      user('task-tool-result', [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'ok' }]),
      user('user-real-2', '继续真实问题'),
    ])

    expect(messages.map((message) => message.id)).toEqual(['user-real-1', 'assistant-real-1', 'user-real-2'])
  })

  it('keeps /goal breadcrumbs and drops other local commands', () => {
    const local = (uuid: string, content: string) => ({ type: 'system', subtype: 'local_command', uuid, content })
    const messages = entriesToMessages([
      local('goal-command', '<command-name>/goal</command-name>\n<command-args>ship it</command-args>'),
      local('goal-output', '<local-command-stdout>Goal set: ship it</local-command-stdout>'),
      local('cost-command', '<command-name>/cost</command-name>'),
      local('cost-output', '<local-command-stdout>Total cost: $0.01</local-command-stdout>'),
    ])

    expect(messages.map((message) => message.id)).toEqual(['goal-command', 'goal-output'])
  })
})

describe('collectTaskNotifications', () => {
  it('decodes task notifications recorded in the transcript', () => {
    expect(collectTaskNotifications([
      {
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        message: {
          role: 'user',
          content: '<task-notification>\n<task-id>bg-1</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>\n<summary>Background command &amp; agent done</summary>\n<result>Detailed result &amp; next step</result>\n<output-file>C:\\Temp\\bg.output</output-file>\n</task-notification>',
        },
      },
    ])).toEqual([
      {
        taskId: 'bg-1',
        toolUseId: 'toolu_bg',
        status: 'completed',
        summary: 'Background command & agent done',
        result: 'Detailed result & next step',
        outputFile: 'C:\\Temp\\bg.output',
        timestamp: '2026-04-06T00:00:00.000Z',
      },
    ])
  })
})

describe('task tracking from history', () => {
  const todoMessage = (todos: Array<{ content: string; status: string }>): MessageEntry => ({
    id: 'assistant-todo',
    type: 'assistant',
    timestamp: '2026-04-06T00:00:00.000Z',
    content: [{ type: 'tool_use', name: 'TodoWrite', id: 'todo-1', input: { todos } }],
  })

  it('returns the latest todo list', () => {
    const todos = [{ content: 'Session task', status: 'in_progress' }]
    expect(findLastTodos([todoMessage(todos)])).toEqual(todos)
  })

  it('drops a finished todo list once the user has moved on', () => {
    const messages: MessageEntry[] = [
      todoMessage([{ content: 'Done task', status: 'completed' }]),
      { id: 'user-next', type: 'user', timestamp: '2026-04-06T00:00:01.000Z', content: 'next' },
    ]

    expect(findLastTodos(messages)).toBeNull()
    expect(hasUserMessagesAfterTaskCompletion(messages)).toBe(true)
  })
})

describe('session transcript fixtures', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcript-history-'))
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    process.env.DREAMCODER_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
    else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function loadFixture(name: string) {
    // Session ids must be UUIDs; a fixed one keeps snapshots stable.
    const sessionId = '00000000-0000-4000-8000-000000000001'
    const projectDir = path.join(tmpDir, 'projects', '-tmp-transcript-fixture')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.copyFile(path.join(FIXTURES_DIR, `${name}.jsonl`), path.join(projectDir, `${sessionId}.jsonl`))
    return new SessionService().getSessionTranscript(sessionId)
  }

  it.each([
    'plain',
    'subagent',
    'compaction',
    'goal',
    'task-notification',
    'teammate',
    'attachments',
  ])('%s', async (name) => {
    expect(await loadFixture(name)).toMatchSnapshot()
  })
})
