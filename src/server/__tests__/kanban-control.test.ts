import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { conversationService } from '../services/conversationService.js'
import { createKanbanControl } from '../services/kanbanControl.js'
import type { SessionFact } from '../services/kanbanModel.js'
import { DEFAULT_REVIEW_INSTRUCTIONS } from '../services/kanbanNotifications.js'
import { createKanban, type KanbanService } from '../services/kanbanService.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
const human = { kind: 'human' } as const

let configDir: string
let project: string
let facts: Map<string, SessionFact>
let kanban: KanbanService
let control: ReturnType<typeof createKanbanControl>
let replies: Array<{ sessionId: string; requestId: string; result: any }>
let delivered: Array<{ sessionId: string; purpose: string }>
let bodies: Map<string, string>

function fact(overrides: Partial<SessionFact> = {}): SessionFact {
  return { exists: true, projectRoot: project, title: 'session', running: false, ...overrides }
}

async function ask(sessionId: string, request: Record<string, unknown>): Promise<any> {
  const before = replies.length
  const requestId = crypto.randomUUID()
  expect(control.handleControlRequest(sessionId, { request_id: requestId, request: request as never })).toBe(true)
  const deadline = Date.now() + 5_000
  while (replies.length === before) {
    if (Date.now() > deadline) throw new Error('No reply to the control request')
    await Bun.sleep(5)
  }
  const reply = replies.at(-1)!
  expect(reply).toMatchObject({ sessionId, requestId })
  return reply.result
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-control-config-'))
  project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-control-project-')))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  facts = new Map(['lead', 'worker', 'other'].map((id) => [id, fact({ title: id.toUpperCase() })]))
  facts.set('stranger', fact({ projectRoot: '/elsewhere' }))
  replies = []
  delivered = []
  bodies = new Map()
  kanban = createKanban({
    sessionInfo: async (id) => {
      const found = facts.get(id)
      return found ? { title: found.title, exists: found.exists, running: found.running } : { title: '', exists: false, running: false }
    },
    sessionWorkspace: async (id) => ({ projectRoot: facts.get(id)?.projectRoot ?? null, workDir: facts.get(id)?.projectRoot ?? '' }),
    deliver: async (sessionId, content, origin) => {
      delivered.push({ sessionId, purpose: origin.kind === 'kanban' ? origin.purpose : origin.purpose })
      bodies.set(`${sessionId}:${origin.purpose}`, content)
      return { ok: true }
    },
    createLinkedSession: async () => {
      throw new Error('not used')
    },
    discardSession: async () => {},
  })
  control = createKanbanControl(kanban)
  spyOn(conversationService, 'respondToHostRequest').mockImplementation((sessionId, requestId, result) => {
    replies.push({ sessionId, requestId, result })
    return true
  })
})

afterEach(async () => {
  mock.restore()
  if (configDirAtLoad === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(configDir, { recursive: true, force: true })
  await fs.rm(project, { recursive: true, force: true })
})

async function boardWithLeadAndWorker(): Promise<string> {
  const { key } = await kanban.createBoard(project)
  await kanban.execute(key, { type: 'create_card', title: 'Auth', status: 'todo' }, human)
  await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'lead' } }, human)
  await kanban.execute(key, { type: 'create_card', title: 'Tokens', parent: 1, status: 'todo' }, { kind: 'session', sessionId: 'lead' })
  await kanban.execute(key, { type: 'create_card', title: 'Sessions', parent: 1, status: 'todo' }, { kind: 'session', sessionId: 'lead' })
  await kanban.execute(key, { type: 'assign', card: 2, role: 'owner', target: { sessionId: 'worker' } }, human)
  await kanban.execute(key, { type: 'assign', card: 2, role: 'reviewer', target: { sessionId: 'lead' } }, human)
  await kanban.execute(key, { type: 'assign', card: 3, role: 'owner', target: { sessionId: 'other' } }, human)
  delivered = []
  return key
}

describe('kanban control requests', () => {
  it('answers only kanban requests', () => {
    expect(control.handleControlRequest('worker', { request_id: 'r1', request: { subtype: 'session_list' } })).toBe(false)
    expect(control.handleControlRequest('worker', { request_id: 'r2', request: { subtype: 'can_use_tool' } })).toBe(false)
  })

  it('answers a malformed request with an error', async () => {
    await boardWithLeadAndWorker()
    expect(await ask('worker', { subtype: 'kanban_command', command: { type: 'start', card: 'two' } })).toEqual({
      error: expect.stringContaining('Invalid kanban_command request'),
    })
    expect(await ask('worker', { subtype: 'kanban_query', card: -1 })).toEqual({ error: expect.stringContaining('Invalid kanban_query request') })
  })

  it('says when the project of the session has no board, and how a card creates it', async () => {
    const missing = (await ask('worker', { subtype: 'kanban_query', list: { scope: 'mine' } })).error
    expect(missing).toContain('This project has no board yet')
    expect(missing).toContain('KanbanCreate')
    await kanban.createBoard(project)
    expect((await ask('stranger', { subtype: 'kanban_query', list: { scope: 'mine' } })).error).toContain('This project has no board yet')
  })

  it('lists the cards the calling session owns, reviews or created, or every card', async () => {
    await boardWithLeadAndWorker()

    const mine = await ask('worker', { subtype: 'kanban_query', list: { scope: 'mine' } })
    expect(mine.response.board).toEqual({ project })
    expect(mine.response.cards).toEqual([
      expect.objectContaining({ id: 2, title: 'Tokens', status: 'todo', owner: { sessionId: 'worker', title: 'WORKER' }, myRoles: ['owner'] }),
    ])

    const leadMine = await ask('lead', { subtype: 'kanban_query', list: { scope: 'mine' } })
    expect(leadMine.response.cards.map((card: { id: number; myRoles: string[] }) => [card.id, card.myRoles])).toEqual([
      [1, ['owner']],
      [2, ['reviewer', 'creator']],
      [3, ['creator']],
    ])
    const all = await ask('worker', { subtype: 'kanban_query', list: { scope: 'all' } })
    expect(all.response.cards.map((card: { id: number }) => card.id)).toEqual([1, 2, 3])
    const blocked = await ask('lead', { subtype: 'kanban_query', list: { scope: 'all', status: ['blocked'] } })
    expect(blocked.response.cards).toEqual([])
  })

  it('reads any card in full, with who owns, reviews and created it', async () => {
    await boardWithLeadAndWorker()

    const own = await ask('worker', { subtype: 'kanban_query', card: 2 })
    expect(own.response.card).toMatchObject({
      id: 2,
      title: 'Tokens',
      parent: { id: 1, title: 'Auth', status: 'todo' },
      owner: { sessionId: 'worker', title: 'WORKER' },
      reviewer: { sessionId: 'lead', title: 'LEAD' },
      createdBy: { sessionId: 'lead', title: 'LEAD' },
      myRoles: ['owner'],
    })
    expect((await ask('worker', { subtype: 'kanban_query', card: 3 })).response.card).toMatchObject({ reviewer: 'none: the person accepts the card' })
    expect((await ask('worker', { subtype: 'kanban_query', card: 9 })).error).toBe('NOT_FOUND: Card #9 does not exist.')
  })

  it('takes the actor from the connection: a worker updates its own card but not another', async () => {
    const key = await boardWithLeadAndWorker()

    const started = await ask('worker', { subtype: 'kanban_command', command: { type: 'start', card: 2 } })
    expect(started.response.card).toMatchObject({ id: 2, status: 'in_progress' })
    expect((await ask('worker', { subtype: 'kanban_command', command: { type: 'start', card: 3 } })).error).toBe(
      'FORBIDDEN: Only its owner or a person can start it: card #3.',
    )
    const history = await kanban.history(key, 2)
    expect(history.at(-1)).toMatchObject({ type: 'status_changed', actor: { kind: 'session', sessionId: 'worker' } })
  })

  it('carries a submission to the reviewer, who accepts it; a card without one refuses the agent', async () => {
    await boardWithLeadAndWorker()
    await ask('worker', { subtype: 'kanban_command', command: { type: 'start', card: 2 } })

    const submitted = await ask('worker', { subtype: 'kanban_command', command: { type: 'submit', card: 2, summary: 'tokens issued' } })
    expect(submitted.response.card.status).toBe('review')
    expect(delivered).toEqual([{ sessionId: 'lead', purpose: 'review' }])
    expect(bodies.get('lead:review')).toContain(`Review instructions:\n${DEFAULT_REVIEW_INSTRUCTIONS}`)

    expect((await ask('lead', { subtype: 'kanban_command', command: { type: 'accept', card: 2 } })).error).toContain('Invalid kanban_command request')
    const accepted = await ask('lead', { subtype: 'kanban_command', command: { type: 'accept', card: 2, summary: 'ran the token tests', links: ['docs/review.md'] } })
    expect(accepted.response.card.status).toBe('done')
    expect(accepted.response.card.updates.at(-1)).toMatchObject({ kind: 'accepted', text: 'ran the token tests', links: ['docs/review.md'] })
    expect(delivered.slice(1)).toEqual([{ sessionId: 'worker', purpose: 'accepted' }])
    expect(bodies.get('worker:accepted')).toContain('Review report:\nran the token tests')

    await ask('lead', { subtype: 'kanban_command', command: { type: 'start', card: 1 } })
    const parent = await ask('lead', { subtype: 'kanban_command', command: { type: 'submit', card: 1, summary: 'auth done' } })
    expect(parent.response.warnings).toEqual(['Card #1 still has unfinished sub-cards: #3.'])
    expect((await ask('lead', { subtype: 'kanban_command', command: { type: 'accept', card: 1, summary: 'ok' } })).error).toBe(
      'FORBIDDEN: Only its reviewer or a person can accept it: card #1.',
    )
  })

  it('tells the tool what creating a card needs the user to approve', async () => {
    const create = (sessionId: string, parent?: number) =>
      ask(sessionId, { subtype: 'kanban_query', create: parent === undefined ? {} : { parent } })
    expect((await create('worker')).response).toEqual({ approval: 'board' })

    await boardWithLeadAndWorker()
    expect((await create('worker')).response).toEqual({ approval: 'task' })
    expect((await create('worker', 1)).response).toEqual({ approval: 'task' })
    expect((await create('worker', 2)).response).toEqual({ approval: null })
    expect((await create('lead', 3)).response).toEqual({ approval: null })
    expect((await create('worker', 9)).response).toEqual({ approval: null })
  })

  it('creates the board with the first card a session adds', async () => {
    const created = await ask('worker', { subtype: 'kanban_command', command: { type: 'create_card', title: 'Plan the release' } })

    expect(created.response.card).toMatchObject({ id: 1, status: 'backlog', createdBy: { sessionId: 'worker', title: 'WORKER' } })
    expect(await kanban.listBoards()).toEqual([{ key: expect.any(String), project }])
  })

  it('refuses commands only a person may send, even from the owner of the card', async () => {
    const key = await boardWithLeadAndWorker()
    for (const command of [
      { type: 'reopen', card: 1 },
      { type: 'assign', card: 1, role: 'owner', target: { newSession: true } },
      { type: 'assign', card: 1, role: 'reviewer', target: { sessionId: 'other' }, repository: { worktree: true } },
      { type: 'add_update', card: 1, kind: 'comment', text: 'x', notify: ['creator'] },
    ]) {
      expect((await ask('lead', { subtype: 'kanban_command', command })).error).toContain('Invalid kanban_command request')
    }
    expect((await kanban.view(key, human)).cards[0]!.assignments.map((assignment) => assignment.sessionId)).toEqual(['lead'])
  })

  it('makes the calling session owner of a card it assigns itself, replacing the current owner', async () => {
    await boardWithLeadAndWorker()

    const granted = await ask('other', { subtype: 'kanban_command', command: { type: 'assign', card: 2, role: 'owner', target: 'self' } })

    expect(granted.response.card).toMatchObject({ id: 2, owner: { sessionId: 'other', title: 'OTHER' }, myRoles: ['owner'] })
    expect(delivered).toEqual([{ sessionId: 'worker', purpose: 'revocation' }])
    expect((await ask('other', { subtype: 'kanban_command', command: { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } } })).error).toBe(
      'FORBIDDEN: Only its owner, the session that created it or a person can assign another session to it: card #1.',
    )
  })

  it('starts a session in a role on a card, with the brief as its instructions inside the card message', async () => {
    const key = await boardWithLeadAndWorker()
    facts.set('child', fact({ title: 'CHILD' }))
    facts.set('checker', fact({ title: 'CHECKER' }))

    const started = await control.startAssignee('lead', { card: 3, role: 'owner', instructions: 'Build the sessions' }, async () => 'child')
    expect(started.sessionId).toBe('child')
    expect(started.message).toContain('Card #3: Sessions\nYou are assigned as its owner.')
    expect(started.message).toContain('Created by LEAD (session:lead).')
    expect(started.message).toContain('Note from LEAD (session:lead): Build the sessions')
    expect(started.message).toContain('Its creator sets the acceptance criteria and chooses the reviewer: when a criterion looks unclear, wrong or out of reach, ask the creator instead of changing it.')

    const reviewer = await control.startAssignee('lead', { card: 3, role: 'reviewer', instructions: 'Run the session tests' }, async () => 'checker')
    expect(reviewer.message).toContain('You are assigned as its reviewer.')
    expect(reviewer.message).toContain('Review instructions from LEAD (session:lead):\nRun the session tests')
    expect(reviewer.message).not.toContain('Its creator sets the acceptance criteria')
    const card = (await kanban.view(key, human)).cards[2]!
    expect([card.owner, card.reviewer]).toEqual(['child', 'checker'])
    expect(card.assignments.find((assignment) => assignment.sessionId === 'checker')?.note).toBe('Run the session tests')
    expect(delivered).toEqual([{ sessionId: 'other', purpose: 'revocation' }])

    let launched = false
    await expect(control.startAssignee('worker', { card: 3, role: 'owner', instructions: 'x' }, async () => {
      launched = true
      return 'child'
    })).rejects.toThrow('Only its owner, the session that created it or a person can assign another session to it: card #3.')
    expect(launched).toBe(false)
  })

  it('revokes the assignment of a started session whose brief could not be delivered', async () => {
    const key = await boardWithLeadAndWorker()
    facts.set('child', fact({ title: 'CHILD' }))
    const started = await control.startAssignee('lead', { card: 3, role: 'owner', instructions: 'Build the sessions' }, async () => 'child')

    await started.abandon('CLI did not start')

    const card = (await kanban.view(key, human)).cards[2]!
    expect(card.owner).toBeNull()
    expect(card.assignments.find((assignment) => assignment.sessionId === 'child')).toMatchObject({ status: 'revoked', reason: 'The new session could not be started: CLI did not start' })
  })

  it('tells a reviewer assigned after the submission that the card already waits for its review', async () => {
    const key = await boardWithLeadAndWorker()
    await ask('other', { subtype: 'kanban_command', command: { type: 'start', card: 3 } })
    await ask('other', { subtype: 'kanban_command', command: { type: 'submit', card: 3, summary: 'sessions done', links: ['https://example.test/pr/3'] } })
    await kanban.execute(key, { type: 'assign', card: 3, role: 'reviewer', target: { sessionId: 'worker' } }, human)

    const body = bodies.get('worker:assignment')!
    expect(body).toContain('It is already submitted and waits for your review now.\nSummary: sessions done\nLinks:\n- https://example.test/pr/3')
    expect(body).not.toContain('You are told when the owner submits it.')
  })

  it('tells the owner and the reviewer about a cancel, and the owner about a reopen with its reason', async () => {
    const key = await boardWithLeadAndWorker()
    await ask('worker', { subtype: 'kanban_command', command: { type: 'start', card: 2 } })
    await ask('worker', { subtype: 'kanban_command', command: { type: 'submit', card: 2, summary: 'tokens issued' } })
    delivered = []

    await kanban.execute(key, { type: 'cancel', card: 2, reason: 'merged into #3' }, human)
    expect(delivered).toEqual([{ sessionId: 'worker', purpose: 'cancelled' }, { sessionId: 'lead', purpose: 'cancelled' }])

    await kanban.execute(key, { type: 'reopen', card: 2, reason: 'still needed' }, human)
    expect(delivered.at(-1)).toEqual({ sessionId: 'worker', purpose: 'reopened' })
    expect(bodies.get('worker:reopened')).toContain('Reopened and moved back to Todo by the person.\nReason: still needed')
  })

  it('shows a reviewer its instructions, or the default ones when none were given', async () => {
    const key = await boardWithLeadAndWorker()
    await kanban.execute(key, { type: 'assign', card: 3, role: 'reviewer', target: { sessionId: 'worker' }, note: 'Try it in the app' }, human)

    const reviewers = async (card: number) =>
      (await ask('worker', { subtype: 'kanban_query', card })).response.card.assignments.filter((assignment: { role: string }) => assignment.role === 'reviewer')
    expect((await reviewers(2))[0].instructions).toBe(DEFAULT_REVIEW_INSTRUCTIONS)
    expect((await reviewers(3))[0].instructions).toBe('Try it in the app')
    expect(bodies.get('worker:assignment')).toContain('Review instructions from the person:\nTry it in the app')
  })

  it('returns the latest updates of a card unless the whole history is asked for', async () => {
    await boardWithLeadAndWorker()
    for (let index = 1; index <= 12; index += 1) {
      await kanban.execute(await kanban.boardForSession('worker') as string, { type: 'add_update', card: 2, kind: 'progress', text: `step ${index}` }, { kind: 'session', sessionId: 'worker' })
    }

    const recent = (await ask('worker', { subtype: 'kanban_query', card: 2 })).response.card
    expect(recent.updates.map((update: { text: string }) => update.text)).toEqual(Array.from({ length: 10 }, (_, index) => `step ${index + 3}`))
    expect(recent.earlierUpdates).toBe(2)

    const full = (await ask('worker', { subtype: 'kanban_query', card: 2, history: true })).response.card
    expect(full.updates).toHaveLength(12)
    expect(full.earlierUpdates).toBeUndefined()
  })

  it('refuses a board text over the limit and points to a file instead', async () => {
    await boardWithLeadAndWorker()
    const error = (await ask('worker', { subtype: 'kanban_command', command: { type: 'add_update', card: 2, kind: 'progress', text: 'x'.repeat(2001) } })).error
    expect(error).toContain('Write longer content, such as a review report, to a file and put its path in links.')
  })
})
