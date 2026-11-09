import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'
import { __resetWebSocketHandlerStateForTests } from '../ws/handler.js'
import { setServerEndpoint } from '../ws/sessionRuntime.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR

let configDir: string
let project: string
let sent: Array<{ sessionId: string; content: string; origin: unknown }>

async function api(method: string, pathname: string, body?: unknown): Promise<Response> {
  const url = new URL(pathname, 'http://localhost:3456')
  return handleApiRequest(
    new Request(url.toString(), {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url,
  )
}

async function json(response: Response): Promise<any> {
  return response.json()
}

function fakeCli() {
  let running = new Set<string>()
  spyOn(conversationService, 'hasSession').mockImplementation((sessionId) => running.has(sessionId))
  spyOn(conversationService, 'onOutput').mockImplementation(() => {})
  spyOn(conversationService, 'hasOutputCallback').mockImplementation(() => true)
  spyOn(conversationService, 'removeOutputCallback').mockImplementation(() => {})
  spyOn(conversationService, 'startSession').mockImplementation(async (sessionId: string) => {
    running.add(sessionId)
    return 1 as never
  })
  spyOn(conversationService, 'sendMessage').mockImplementation((sessionId, content, _attachments, _id, origin) => {
    sent.push({ sessionId, content: String(content), origin })
    return true
  })
}

async function createSession(): Promise<string> {
  return (await sessionService.createSession(project)).sessionId
}

async function createBoard(): Promise<string> {
  const response = await api('POST', '/api/kanban/boards', { project })
  expect(response.status).toBe(201)
  return (await json(response)).view.key
}

async function command(key: string, body: unknown): Promise<Response> {
  return api('POST', `/api/kanban/boards/${key}/commands`, { command: body })
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-api-config-'))
  project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-api-project-')))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  setServerEndpoint({ serverHost: '127.0.0.1', serverPort: 4567 })
  spyOn(console, 'log').mockImplementation(() => {})
  sent = []
  fakeCli()
})

afterEach(async () => {
  setServerEndpoint(null)
  __resetWebSocketHandlerStateForTests()
  mock.restore()
  if (configDirAtLoad === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(configDir, { recursive: true, force: true })
  await fs.rm(project, { recursive: true, force: true })
})

describe('/api/kanban', () => {
  test('creates a board, lists it and refuses a second one for the project', async () => {
    const key = await createBoard()

    expect(await json(await api('GET', '/api/kanban/boards'))).toEqual({ boards: [{ key, project }] })
    const again = await api('POST', '/api/kanban/boards', { project })
    expect(again.status).toBe(409)
    expect((await json(again)).error).toBe('CONFLICT')
  })

  test('returns the view, or only the etag when nothing changed', async () => {
    const key = await createBoard()

    const first = await json(await api('GET', `/api/kanban/boards/${key}`))
    expect(first).toMatchObject({ changed: true, view: { key, project, cards: [] } })

    expect(await json(await api('GET', `/api/kanban/boards/${key}?since=${first.view.etag}`))).toEqual({
      changed: false,
      etag: first.view.etag,
    })

    expect(await json(await command(key, { type: 'create_card', title: 'Docs' }))).toMatchObject({ card: 1, warnings: [] })
    const changed = await json(await api('GET', `/api/kanban/boards/${key}?since=${first.view.etag}`))
    expect(changed.changed).toBe(true)
    expect(changed.view.cards.map((card: { title: string }) => card.title)).toEqual(['Docs'])
  })

  test('maps refused commands to their codes and malformed ones to 400', async () => {
    const key = await createBoard()
    await command(key, { type: 'create_card', title: 'Docs', status: 'todo' })

    const refused = await command(key, { type: 'start', card: 1 })
    expect(refused.status).toBe(409)
    expect(await json(refused)).toMatchObject({ error: 'NO_OWNER' })

    const malformed = await command(key, { type: 'start', card: 'one' })
    expect(malformed.status).toBe(400)
    expect((await command(key, { type: 'drop_table' })).status).toBe(400)
  })

  test('answers 404 for a key that is not a known board, without touching the file system', async () => {
    expect((await api('GET', '/api/kanban/boards/..%2F..%2Fetc')).status).toBe(404)
    expect((await api('GET', '/api/kanban/boards/missing-board')).status).toBe(404)
    expect((await command('..%2F..', { type: 'create_card', title: 'x' })).status).toBe(404)
  })

  test('returns the history of a card', async () => {
    const key = await createBoard()
    await command(key, { type: 'create_card', title: 'Docs' })
    await command(key, { type: 'edit_card', card: 1, priority: 'high' })

    const { events } = await json(await api('GET', `/api/kanban/boards/${key}/cards/1/history`))

    expect(events.map((event: { type: string; actor: unknown }) => [event.type, event.actor])).toEqual([
      ['card_created', { kind: 'human' }],
      ['card_edited', { kind: 'human' }],
    ])
    expect((await api('GET', `/api/kanban/boards/${key}/cards/abc/history`)).status).toBe(400)
  })

  test('delivers an assignment to the session CLI as a project board message', async () => {
    const worker = await createSession()
    const key = await createBoard()
    await command(key, { type: 'create_card', title: 'Docs', status: 'todo' })
    sent = []

    const response = await command(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: worker } })

    expect(response.status).toBe(200)
    expect((await json(response)).warnings).toEqual([])
    expect(sent).toEqual([
      {
        sessionId: worker,
        content: expect.stringContaining('Card #1: Docs'),
        origin: { kind: 'kanban', project, card: { id: 1, title: 'Docs' }, purpose: 'assignment' },
      },
    ])
  })

  test('starts a new top-level session for an assignment the person makes', async () => {
    const key = await createBoard()
    await command(key, { type: 'create_card', title: 'Docs', status: 'todo' })
    sent = []

    const response = await command(key, { type: 'assign', card: 1, role: 'owner', target: { newSession: true } })

    const owner = (await json(response)).view.cards[0].owner as string
    const info = await sessionService.getSessionLinkInfo(owner)
    expect(info).toMatchObject({ title: '#1 Docs' })
    expect(info?.parent).toBeUndefined()
    expect(sent.map((each) => each.sessionId)).toEqual([owner])
  })
})
