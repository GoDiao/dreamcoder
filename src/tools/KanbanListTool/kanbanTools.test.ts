import { afterEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { setHostRequester } from '../../utils/hostRequests.js'
import { installFakeHost, useEnvFlag } from '../../utils/__tests__/hostRequesterFixture.js'
import { KanbanCreateTool } from '../KanbanCreateTool/KanbanCreateTool.js'
import { KanbanGetTool } from '../KanbanGetTool/KanbanGetTool.js'
import { KanbanUpdateTool } from '../KanbanUpdateTool/KanbanUpdateTool.js'
import { SESSION_LINKS_ENABLED_ENV } from '../StartSessionTool/constants.js'
import { KanbanListTool } from './KanbanListTool.js'

const flag = useEnvFlag(SESSION_LINKS_ENABLED_ENV)
afterEach(() => {
  setHostRequester(null)
  flag.restore()
})

const board = { project: '/repo' }
const call = (tool: { call: Function; inputSchema: { parse: (input: unknown) => unknown } }, input: unknown) =>
  tool.call(tool.inputSchema.parse(input), {} as never, undefined as never, undefined as never)

describe('kanban tools', () => {
  test('exist only when the DreamCoder host is attached', () => {
    flag.disable()
    for (const tool of [KanbanListTool, KanbanGetTool, KanbanCreateTool, KanbanUpdateTool]) expect(tool.isEnabled()).toBe(false)
    flag.enable()
    for (const tool of [KanbanListTool, KanbanGetTool, KanbanCreateTool, KanbanUpdateTool]) expect(tool.isEnabled()).toBe(true)
  })

  test('only list and get are read-only; updates other than assign need no permission prompt', async () => {
    expect(KanbanListTool.isReadOnly({})).toBe(true)
    expect(KanbanGetTool.isReadOnly({ card: 1 })).toBe(true)
    expect(KanbanCreateTool.isReadOnly({ title: 'x' })).toBe(false)
    expect(KanbanUpdateTool.isReadOnly({ command: { type: 'start', card: 1 } })).toBe(false)
    expect((await KanbanUpdateTool.checkPermissions({ command: { type: 'start', card: 1 } }, {} as never)).behavior).toBe('allow')
  })

  test('KanbanCreate asks the user as the host says: never under its own card, by permission mode for a suggestion, always for a new board', async () => {
    let hasBoard = true
    const requests = installFakeHost((request) => {
      const { parent } = (request as { create: { parent?: number } }).create
      return { approval: !hasBoard ? 'board' : parent === 2 ? null : 'task' }
    })
    const check = (input: { title: string; parent?: number }) => KanbanCreateTool.checkPermissions(input, {} as never)

    expect(await check({ title: 'Split', parent: 2 })).toEqual({ behavior: 'allow', updatedInput: { title: 'Split', parent: 2 } })
    expect(await check({ title: 'Idea', parent: 3 })).toMatchObject({ behavior: 'ask', decisionReason: { type: 'other' } })
    expect(await check({ title: 'Idea' })).toMatchObject({ behavior: 'ask', decisionReason: { type: 'other' } })
    hasBoard = false
    expect(await check({ title: 'First' })).toMatchObject({
      behavior: 'ask',
      message: 'Create the project board with the card "First"?',
      decisionReason: { type: 'safetyCheck', classifierApprovable: false },
    })
    expect(requests[0]).toEqual({ subtype: 'kanban_query', create: { parent: 2 } })
    expect(requests[2]).toEqual({ subtype: 'kanban_query', create: {} })
  })

  test('KanbanList asks for my cards by default and passes scope and status', async () => {
    const requests = installFakeHost(() => ({ board, cards: [{ id: 1, title: 'Docs' }] }))
    const result = await call(KanbanListTool, {})
    await call(KanbanListTool, { scope: 'all', status: ['blocked'] })
    expect(requests).toEqual([
      { subtype: 'kanban_query', list: { scope: 'mine' } },
      { subtype: 'kanban_query', list: { scope: 'all', status: ['blocked'] } },
    ])
    expect(result.data.cards).toEqual([{ id: 1, title: 'Docs' }])
  })

  test('KanbanGet asks for one card without naming the session', async () => {
    const requests = installFakeHost(() => ({ board, card: { id: 3 } }))
    await call(KanbanGetTool, { card: 3 })
    await call(KanbanGetTool, { card: 3, history: true })
    expect(requests).toEqual([{ subtype: 'kanban_query', card: 3 }, { subtype: 'kanban_query', card: 3, history: true }])
  })

  test('KanbanCreate sends create_card as given', async () => {
    const requests = installFakeHost(() => ({ warnings: [] }))
    await call(KanbanCreateTool, { title: 'Split auth', parent: 2, acceptance: ['tests pass'] })
    expect(requests).toEqual([
      { subtype: 'kanban_command', command: { type: 'create_card', title: 'Split auth', parent: 2, acceptance: ['tests pass'] } },
    ])
    expect(KanbanCreateTool.inputSchema.safeParse({ title: 'x', suggestionReason: 'y' }).success).toBe(false)
  })

  test('KanbanUpdate sends the command as given', async () => {
    const requests = installFakeHost(() => ({ warnings: ['Card #2 still has unfinished sub-cards: #3.'] }))
    const result = await call(KanbanUpdateTool, { command: { type: 'submit', card: 2, summary: 'done', links: ['https://example.test/pr/1'] } })
    expect(requests).toEqual([
      { subtype: 'kanban_command', command: { type: 'submit', card: 2, summary: 'done', links: ['https://example.test/pr/1'] } },
    ])
    expect(result.data.warnings).toEqual(['Card #2 still has unfinished sub-cards: #3.'])
  })

  test('KanbanUpdate needs a review report to accept', () => {
    expect(KanbanUpdateTool.inputSchema.safeParse({ command: { type: 'accept', card: 2 } }).success).toBe(false)
    expect(KanbanUpdateTool.inputSchema.safeParse({ command: { type: 'accept', card: 2, summary: 'ran the tests', links: ['docs/review.md'] } }).success).toBe(true)
  })

  test('KanbanUpdate does not offer the commands only a person may use', () => {
    for (const command of [
      { type: 'assign', card: 1, role: 'owner', target: { newSession: true } },
      { type: 'assign', card: 1, role: 'owner', target: { sessionId: 's' }, repository: { worktree: true } },
      { type: 'archive', card: 1 },
      { type: 'reopen', card: 1 },
      { type: 'add_update', card: 1, kind: 'comment', text: 'x', notify: ['creator'] },
    ]) {
      expect(KanbanUpdateTool.inputSchema.safeParse({ command }).success).toBe(false)
    }
  })

  test.each([
    ['default', 'ask'],
    ['bypassPermissions', 'allow'],
  ] as const)('KanbanUpdate asks before an assignment in %s mode: %s', async (mode, behavior) => {
    const context = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), mode } }),
      options: { tools: [KanbanUpdateTool] },
    }
    const input = KanbanUpdateTool.inputSchema.parse({ command: { type: 'assign', card: 3, role: 'owner', target: 'self' } })
    expect(await KanbanUpdateTool.checkPermissions(input, {} as never)).toMatchObject({
      behavior: 'ask',
      message: 'Make this session the owner of card #3?',
      decisionReason: { type: 'other' },
    })
    expect((await hasPermissionsToUseTool(KanbanUpdateTool, input, context as never, undefined as never, 'id')).behavior).toBe(behavior)
  })

  test('KanbanUpdate assigns a session it started without asking, and asks for any other session', async () => {
    const requests = installFakeHost(() => ({
      sessions: [
        { sessionId: 'worker', title: 'Worker', project: '/repo', parentSessionId: 'me', relation: 'child', running: true },
        { sessionId: 'peer', title: 'Peer', project: '/repo', relation: 'none', running: false },
      ],
    }))
    const check = (sessionId: string) =>
      KanbanUpdateTool.checkPermissions(
        KanbanUpdateTool.inputSchema.parse({ command: { type: 'assign', card: 3, role: 'owner', target: { sessionId } } }),
        {} as never,
      )

    expect(await check('worker')).toMatchObject({ behavior: 'allow' })
    expect(await check('peer')).toMatchObject({ behavior: 'ask', message: 'Make session peer the owner of card #3?' })
    expect(requests).toEqual([{ subtype: 'session_list' }, { subtype: 'session_list' }])
  })

  test.each(['default', 'bypassPermissions'] as const)('KanbanUpdate asks the user before every cancel, in %s mode too', async (mode) => {
    const context = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), mode } }),
      options: { tools: [KanbanUpdateTool] },
    }
    const input = KanbanUpdateTool.inputSchema.parse({ command: { type: 'cancel', card: 4, reason: 'not needed' } })
    expect(await KanbanUpdateTool.checkPermissions(input, {} as never)).toMatchObject({
      behavior: 'ask',
      message: 'Cancel card #4 and remove dependencies on the cancelled cards?',
      decisionReason: { type: 'safetyCheck', classifierApprovable: false },
    })
    expect((await hasPermissionsToUseTool(KanbanUpdateTool, input, context as never, undefined as never, 'id')).behavior).toBe('ask')
  })

  test.each(['default', 'bypassPermissions'] as const)('KanbanUpdate asks the user every time a session that did not create the card changes its acceptance criteria, in %s mode too', async (mode) => {
    const requests = installFakeHost(() => ({ card: { id: 4, myRoles: ['owner'] } }))
    const context = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), mode } }),
      options: { tools: [KanbanUpdateTool] },
    }
    const input = KanbanUpdateTool.inputSchema.parse({ command: { type: 'edit_card', card: 4, acceptance: ['Works offline'] } })
    expect(await KanbanUpdateTool.checkPermissions(input, {} as never)).toMatchObject({
      behavior: 'ask',
      message: 'Change the acceptance criteria of card #4?',
      decisionReason: { type: 'safetyCheck', classifierApprovable: false },
    })
    expect((await hasPermissionsToUseTool(KanbanUpdateTool, input, context as never, undefined as never, 'id')).behavior).toBe('ask')
    expect(requests[0]).toEqual({ subtype: 'kanban_query', card: 4 })
  })

  test.each(['default', 'bypassPermissions'] as const)('KanbanUpdate asks the user every time a session makes itself a reviewer or picks the reviewer of a card it also owns, in %s mode too', async (mode) => {
    let roles = ['owner']
    installFakeHost((request) => (request as { subtype: string }).subtype === 'session_list'
      ? { sessions: [{ sessionId: 'worker', title: 'Worker', project: '/repo', parentSessionId: 'me', relation: 'child', running: true }] }
      : { card: { id: 3, myRoles: roles } })
    const context = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), mode } }),
      options: { tools: [KanbanUpdateTool] },
    }
    const reviewer = (target: unknown) => KanbanUpdateTool.inputSchema.parse({ command: { type: 'assign', card: 3, role: 'reviewer', target } })
    const always = { behavior: 'ask', decisionReason: { type: 'safetyCheck', classifierApprovable: false } }

    expect(await KanbanUpdateTool.checkPermissions(reviewer('self'), {} as never)).toMatchObject({ ...always, message: 'Make this session the reviewer of card #3?' })
    expect((await hasPermissionsToUseTool(KanbanUpdateTool, reviewer('self'), context as never, undefined as never, 'id')).behavior).toBe('ask')
    roles = ['creator', 'owner']
    expect(await KanbanUpdateTool.checkPermissions(reviewer({ sessionId: 'worker' }), {} as never)).toMatchObject(always)
    expect((await hasPermissionsToUseTool(KanbanUpdateTool, reviewer({ sessionId: 'worker' }), context as never, undefined as never, 'id')).behavior).toBe('ask')
    roles = ['creator']
    expect(await KanbanUpdateTool.checkPermissions(reviewer({ sessionId: 'worker' }), {} as never)).toMatchObject({ behavior: 'allow' })
  })

  test('KanbanUpdate lets the creator change acceptance criteria and anyone allowed edit the other fields without asking', async () => {
    const requests = installFakeHost(() => ({ card: { id: 4, myRoles: ['creator', 'owner'] } }))
    const check = (command: Record<string, unknown>) => KanbanUpdateTool.checkPermissions(KanbanUpdateTool.inputSchema.parse({ command }), {} as never)

    expect(await check({ type: 'edit_card', card: 4, acceptance: ['Works offline'] })).toMatchObject({ behavior: 'allow' })
    expect(await check({ type: 'edit_card', card: 4, description: 'Clearer goal' })).toMatchObject({ behavior: 'allow' })
    expect(requests).toEqual([{ subtype: 'kanban_query', card: 4 }])
  })

  test('KanbanUpdate sends an assignment as given and leaves "self" for the host to resolve', async () => {
    const requests = installFakeHost(() => ({ warnings: [] }))
    await call(KanbanUpdateTool, { command: { type: 'assign', card: 3, role: 'owner', target: 'self' } })
    await call(KanbanUpdateTool, { command: { type: 'assign', card: 4, role: 'owner', target: { sessionId: 'worker' }, note: 'yours' } })
    expect(requests).toEqual([
      { subtype: 'kanban_command', command: { type: 'assign', card: 3, role: 'owner', target: 'self' } },
      { subtype: 'kanban_command', command: { type: 'assign', card: 4, role: 'owner', target: { sessionId: 'worker' }, note: 'yours' } },
    ])
  })
})
