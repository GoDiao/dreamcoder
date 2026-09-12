import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionService, type SessionListItem } from '../services/sessionService.js'
import { handleSessionsApi } from '../api/sessions.js'

let configDir: string
let originalConfigDir: string | undefined
let service: SessionService

function assistant(content: unknown, extra: Record<string, unknown> = {}) {
  return { type: 'assistant', message: { role: 'assistant', content }, ...extra }
}

function user(content: unknown) {
  return { type: 'user', message: { role: 'user', content }, cwd: configDir }
}

async function writeSession(entries: Record<string, unknown>[]) {
  const sessionId = crypto.randomUUID()
  const projectDir = path.join(configDir, 'projects', '-session-search')
  await fs.mkdir(projectDir, { recursive: true })
  const filePath = path.join(projectDir, `${sessionId}.jsonl`)
  await fs.writeFile(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  return { sessionId, filePath }
}

beforeEach(async () => {
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamcoder-session-search-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  service = new SessionService()
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('session list assistant search text', () => {
  it.each([
    { synthetic: 'No response requested.' },
    { synthetic: [{ type: 'text', text: 'No response requested.' }] },
  ])('keeps the visible reply when a hidden synthetic assistant entry follows it: %j', async ({ synthetic }) => {
    await writeSession([
      user('Question'),
      assistant('Last visible answer'),
      assistant(synthetic),
    ])

    const { sessions } = await service.listSessions({ includeLastAssistantMessage: true })
    expect(sessions[0]?.lastAssistantMessage).toBe('Last visible answer')
  })

  it('does not index a session containing only hidden synthetic assistant replies', async () => {
    await writeSession([user('Question'), assistant('No response requested.')])
    const { sessions } = await service.listSessions({ includeLastAssistantMessage: true })
    expect(sessions[0]?.lastAssistantMessage).toBe('')
  })

  it('finds the latest visible reply outside the head and tail without loading full transcripts', async () => {
    await writeSession([
      user('Initial question'),
      assistant('Older reply'),
      ...Array.from({ length: 120 }, () => ({ type: 'progress', data: {} })),
      assistant('The searchable middle reply'),
      user('A later question'),
      assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'echo hidden-tool-input' } }]),
      user([{ type: 'tool_result', content: 'hidden tool output' }]),
      ...Array.from({ length: 120 }, () => ({ type: 'progress', data: {} })),
    ])
    const readFullTranscript = spyOn(
      service as unknown as { readJsonlFile: (filePath: string) => Promise<unknown[]> },
      'readJsonlFile',
    )

    try {
      const { sessions } = await service.listSessions({ includeLastAssistantMessage: true })
      expect(sessions[0]?.lastAssistantMessage).toBe('The searchable middle reply')
      expect(readFullTranscript).not.toHaveBeenCalled()
    } finally {
      readFullTranscript.mockRestore()
    }
  })

  it('joins text blocks while excluding thinking, tools, and nested agent replies', async () => {
    await writeSession([
      user('Initial question'),
      assistant('Older reply'),
      assistant([
        { type: 'thinking', thinking: 'private reasoning', text: 'not a text block' },
        { type: 'text', text: '  第一段：会话搜索  ' },
        { type: 'tool_use', name: 'Bash', text: 'not tool text', input: {} },
        { type: 'text', text: 'Second paragraph' },
        null,
        { type: 'text', text: 42 },
      ]),
      assistant('sidechain reply', { isSidechain: true }),
      assistant('nested agent reply', { parent_tool_use_id: 'tool-agent' }),
      assistant('internal reply', { isMeta: true }),
      assistant([{ type: 'thinking', thinking: 'later private reasoning' }]),
      assistant('  '),
    ])

    const { sessions } = await service.listSessions({ includeLastAssistantMessage: true })
    expect(sessions[0]?.lastAssistantMessage).toBe('第一段：会话搜索\nSecond paragraph')
  })

  it('returns empty search text when the session has no visible assistant reply', async () => {
    await writeSession([
      user('An unanswered question'),
      assistant([{ type: 'tool_use', name: 'Bash', input: {} }]),
      assistant('An agent answer', { isSidechain: true }),
    ])

    const { sessions } = await service.listSessions({ includeLastAssistantMessage: true })
    expect(sessions[0]?.lastAssistantMessage).toBe('')
  })

  it('omits assistant text unless explicitly requested and reads updated replies on the next request', async () => {
    const { filePath } = await writeSession([user('Question'), assistant('First reply')])
    expect((await service.listSessions()).sessions[0]).not.toHaveProperty('lastAssistantMessage')
    expect((await service.listSessions({ includeLastAssistantMessage: false })).sessions[0])
      .not.toHaveProperty('lastAssistantMessage')
    expect((await service.listSessions({ includeLastAssistantMessage: true })).sessions[0]?.lastAssistantMessage)
      .toBe('First reply')

    await fs.appendFile(filePath, JSON.stringify(assistant('Updated reply')) + '\n')
    expect((await service.listSessions({ includeLastAssistantMessage: true })).sessions[0]?.lastAssistantMessage)
      .toBe('Updated reply')
  })

  it('handles JSON whitespace and skips malformed or partially written assistant entries', async () => {
    const { filePath } = await writeSession([user('Question')])
    await fs.appendFile(filePath, [
      '{ "type" : "assistant", "message" : { "role" : "assistant", "content" : "Spaced JSON reply" } }',
      '{"type":"assistant","message":',
      '',
    ].join('\n'))

    expect((await service.listSessions({ includeLastAssistantMessage: true })).sessions[0]?.lastAssistantMessage)
      .toBe('Spaced JSON reply')
  })

  it('keeps pagination and total unchanged when including assistant text', async () => {
    for (let index = 0; index < 3; index++) {
      const { filePath } = await writeSession([user(`Question ${index}`), assistant(`Reply ${index}`)])
      const modified = new Date(Date.now() - index * 1000)
      await fs.utimes(filePath, modified, modified)
    }
    const { sessions, total } = await service.listSessions({
      includeLastAssistantMessage: true,
      limit: 1,
      offset: 1,
    })
    expect(total).toBe(3)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.lastAssistantMessage).toBe('Reply 1')
  })

  it('settles missing-file and stream read errors without hanging or unhandled errors', async () => {
    const scanner = service as unknown as {
      scanSessionFileHead: (
        filePath: string,
        headLines: number,
        tailLines: number,
        includeLastAssistantMessage: boolean,
      ) => Promise<{ entries: unknown[]; messageCount: number; lastAssistantMessage: string }>
    }
    expect(await scanner.scanSessionFileHead(path.join(configDir, 'missing.jsonl'), 100, 100, true))
      .toEqual({ entries: [], messageCount: 0, lastAssistantMessage: '' })
    await expect(scanner.scanSessionFileHead(configDir, 100, 100, true)).rejects.toThrow()
  })
})

describe('session list assistant search API', () => {
  it('only includes search text for includeLastAssistantMessage=true', async () => {
    await writeSession([user('Question'), assistant('Searchable API reply')])

    for (const query of ['', '?includeLastAssistantMessage=false', '?includeLastAssistantMessage=true']) {
      const url = new URL(`http://localhost/api/sessions${query}`)
      const response = await handleSessionsApi(new Request(url), url, ['api', 'sessions'])
      expect(response.status).toBe(200)
      const body = await response.json() as { sessions: SessionListItem[]; total: number }
      expect(body.total).toBe(1)
      if (query.endsWith('=true')) {
        expect(body.sessions[0]?.lastAssistantMessage).toBe('Searchable API reply')
      } else {
        expect(body.sessions[0]).not.toHaveProperty('lastAssistantMessage')
      }
    }
  })
})
