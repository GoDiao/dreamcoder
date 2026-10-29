import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { LITE_READ_BUF_SIZE } from '../../utils/sessionStoragePortable.js'
import { handleSessionsApi } from '../api/sessions.js'
import { sessionService, type SessionListItem } from '../services/sessionService.js'

type TranscriptRead = { filePath: string; position: number; length: number }

let configDir: string
let originalConfigDir: string | undefined

function jsonl(entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
}

function progressLine(fillBytes: number): string {
  return `{"type":"progress","pad":"${'x'.repeat(fillBytes)}"}\n`
}

function userLine(text: string, cwd: string): Record<string, unknown> {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    cwd,
    timestamp: '2024-05-01T00:01:00.000Z',
  }
}

function assistantLine(text: string): Record<string, unknown> {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: text },
    timestamp: '2024-05-01T00:02:00.000Z',
  }
}

beforeEach(async () => {
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamcoder-bounded-scan-'))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  await fs.mkdir(path.join(configDir, 'projects'), { recursive: true })
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(configDir, { recursive: true, force: true })
})

async function writeTranscript(projectDirName: string, sessionId: string, content: string): Promise<string> {
  const projectDir = path.join(configDir, 'projects', projectDirName)
  await fs.mkdir(projectDir, { recursive: true })
  const filePath = path.join(projectDir, `${sessionId}.jsonl`)
  await fs.writeFile(filePath, content)
  return filePath
}

function readPosition(args: unknown[]): number {
  if (typeof args[1] === 'number' && typeof args[3] === 'number') return args[3]
  if (args[1] && typeof args[1] === 'object') {
    const position = (args[1] as { position?: number | null }).position
    if (typeof position === 'number') return position
  }
  return 0
}

async function withTranscriptReads<T>(fn: () => Promise<T>): Promise<{ result: T; reads: TranscriptRead[]; readFilePaths: string[] }> {
  const reads: TranscriptRead[] = []
  const originalOpen = fs.open.bind(fs)
  const openSpy = spyOn(fs, 'open').mockImplementation(async (file, flags) => {
    const handle = await originalOpen(file, flags)
    const originalRead = handle.read.bind(handle)
    const wrappedRead = async (...args: unknown[]) => {
      const result = await originalRead(...(args as Parameters<typeof originalRead>))
      reads.push({ filePath: String(file), position: readPosition(args), length: result.bytesRead })
      return result
    }
    handle.read = wrappedRead as typeof handle.read
    return handle
  })
  const readFileSpy = spyOn(fs, 'readFile')
  try {
    const result = await fn()
    return {
      result,
      reads,
      readFilePaths: readFileSpy.mock.calls.map((call) => String(call[0])),
    }
  } finally {
    openSpy.mockRestore()
    readFileSpy.mockRestore()
  }
}

function expectReadsStayInsideWindows(reads: TranscriptRead[], filePath: string, size: number): void {
  const transcriptReads = reads.filter((read) => read.filePath === filePath)
  expect(transcriptReads.length).toBeGreaterThan(0)
  let total = 0
  for (const read of transcriptReads) {
    const readEnd = read.position + read.length
    const inHead = read.position >= 0 && readEnd <= LITE_READ_BUF_SIZE
    const inTail = read.position >= size - LITE_READ_BUF_SIZE - 1 && readEnd <= size
    expect(inHead || inTail).toBe(true)
    total += read.length
  }
  // Overlapping windows can reread bytes when the file is smaller than 128KB.
  // A larger file must not be read from start to end.
  if (size > LITE_READ_BUF_SIZE * 2) {
    expect(total).toBeLessThan(size)
  }
}

describe('bounded transcript scan', () => {
  it('marks the count inexact when the 100-line head stops short of the tail', async () => {
    expect(LITE_READ_BUF_SIZE).toBe(64 * 1024)
    const workDir = await fs.mkdtemp(path.join(configDir, 'overlap-project-'))
    const sessionId = crypto.randomUUID()
    const parts: string[] = []
    let size = 0
    const push = (chunk: string) => {
      parts.push(chunk)
      size += Buffer.byteLength(chunk)
    }

    push(jsonl([
      { type: 'session-meta', isMeta: true, workDir: '/tmp/overlap-head-should-not-win', timestamp: '2024-01-01T00:00:00.000Z' },
      userLine('overlap head prompt', '/tmp/overlap-head-should-not-win'),
      assistantLine('overlap head answer'),
    ]))
    let messageCount = 2

    while (size < 40 * 1024) push(progressLine(180))
    push(jsonl([
      userLine('overlap zone prompt', workDir),
      assistantLine('overlap zone answer'),
    ]))
    messageCount += 2

    while (size < 70 * 1024) push(progressLine(180))
    push(jsonl([
      userLine('past the first window', workDir),
      assistantLine('past the first window answer'),
    ]))
    messageCount += 2

    while (size < 90 * 1024) push(progressLine(180))
    push(jsonl([
      userLine('overlap tail prompt', workDir),
      assistantLine('overlap tail answer'),
      { type: 'session-meta', isMeta: true, workDir, timestamp: '2024-02-01T00:00:00.000Z' },
      { type: 'custom-title', customTitle: 'Overlap title', timestamp: '2024-02-01T00:00:01.000Z' },
    ]))
    messageCount += 2

    expect(size).toBeGreaterThan(LITE_READ_BUF_SIZE)
    expect(size).toBeLessThan(LITE_READ_BUF_SIZE * 2)
    const filePath = await writeTranscript('-overlap-scan', sessionId, parts.join(''))

    const tracked = await withTranscriptReads(() => sessionService.listSessions({ includeLastAssistantMessage: true }))
    const session = tracked.result.sessions.find((item) => item.id === sessionId)
    expect(session?.messageCount).toBe(messageCount)
    expect(session?.messageCountExact).toBe(false)
    expect(session?.title).toBe('Overlap title')
    expect(session?.workDir).toBe(workDir)
    expect(session?.lastAssistantMessage).toBe('overlap tail answer')
    expect(tracked.readFilePaths).not.toContain(filePath)
    expectReadsStayInsideWindows(tracked.reads, filePath, size)
  })

  it('lists a large transcript from the head and tail windows without reading the middle', async () => {
    const tailWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamcoder-bounded-tail-'))
    const headWorkDir = '/tmp/dreamcoder-head-should-not-win'
    const middleWorkDir = '/tmp/dreamcoder-middle-should-not-win'
    const sessionId = crypto.randomUUID()

    const cacheResetDir = await fs.mkdtemp(path.join(configDir, 'cache-reset-'))
    const createUrl = new URL('http://localhost/api/sessions')
    const created = await handleSessionsApi(
      new Request(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: cacheResetDir }),
      }),
      createUrl,
      ['api', 'sessions'],
    )
    expect(created.status).toBe(201)

    const head = jsonl([
      {
        type: 'file-history-snapshot',
        timestamp: '2024-05-01T00:00:00.000Z',
        snapshot: { messageId: 'snap', trackedFileBackups: {}, timestamp: '2024-05-01T00:00:00.000Z' },
      },
      { type: 'session-meta', isMeta: true, workDir: headWorkDir, timestamp: '2024-05-01T00:00:01.000Z' },
      userLine('Head prompt that must not win', headWorkDir),
      assistantLine('Head answer'),
    ])
    // Head stops after 100 non-empty lines, before the unread middle.
    const filler = Array.from({ length: 96 }, () => progressLine(40)).join('')
    const middleEntries = [
      ...Array.from({ length: 8 }, (_, index) => userLine(`middle prompt ${index}`, middleWorkDir)),
      assistantLine('Decoy middle answer'),
      { type: 'session-meta', isMeta: true, workDir: middleWorkDir, timestamp: '2024-05-15T00:00:00.000Z' },
    ]
    const middle = jsonl(middleEntries)
    const tail = jsonl([
      userLine('Tail prompt', '/tmp/dreamcoder-cwd-should-not-win'),
      assistantLine('Tail answer'),
      { type: 'session-meta', isMeta: true, workDir: tailWorkDir, timestamp: '2024-06-01T00:00:00.000Z' },
      { type: 'custom-title', customTitle: 'Tail custom title', timestamp: '2024-06-01T00:00:01.000Z' },
    ])
    const pad1 = progressLine(LITE_READ_BUF_SIZE)
    const pad2 = progressLine(2 * 1024 * 1024)
    const content = head + filler + pad1 + middle + pad2 + tail
    const size = Buffer.byteLength(content)
    const middleStart = Buffer.byteLength(head) + Buffer.byteLength(filler) + Buffer.byteLength(pad1)
    const middleEnd = middleStart + Buffer.byteLength(middle)
    expect(middleStart).toBeGreaterThanOrEqual(LITE_READ_BUF_SIZE)
    expect(middleEnd).toBeLessThanOrEqual(size - LITE_READ_BUF_SIZE)
    expect(size).toBeGreaterThan(2 * 1024 * 1024)

    const filePath = await writeTranscript('-bounded-scan', sessionId, content)
    const workDirSpy = spyOn(sessionService, 'getSessionWorkDir')
    try {
      const tracked = await withTranscriptReads(async () => {
        const listed = await sessionService.listSessions({ includeLastAssistantMessage: true, limit: 50 })
        const url = new URL('http://localhost/api/sessions/recent-projects?limit=20')
        const response = await handleSessionsApi(new Request(url), url, ['api', 'sessions', 'recent-projects'])
        expect(response.status).toBe(200)
        const body = await response.json() as { projects: Array<{ realPath: string; projectName: string }> }
        return { listed, body }
      })

      const session = tracked.result.listed.sessions.find((item) => item.id === sessionId)
      expect(session).toBeDefined()
      const listed = session as SessionListItem
      expect(listed.title).toBe('Tail custom title')
      expect(listed.createdAt).toBe('2024-05-01T00:00:00.000Z')
      expect(listed.workDir).toBe(tailWorkDir)
      expect(listed.workDirExists).toBe(true)
      expect(listed.workDir).not.toBe(headWorkDir)
      expect(listed.workDir).not.toBe(middleWorkDir)
      expect(listed.lastAssistantMessage).toBe('Tail answer')
      // Eight middle user lines and the decoy assistant sit in the unread gap.
      expect(listed.messageCount).toBe(4)
      expect(listed.messageCountExact).toBe(false)
      expect(listed.projectRoot).toBeTruthy()
      const canonicalTail = await fs.realpath(tailWorkDir)
      const projectRoot = listed.projectRoot as string
      expect(
        canonicalTail === projectRoot ||
        canonicalTail.startsWith(projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep),
      ).toBe(true)

      const project = tracked.result.body.projects.find((item) => item.realPath === projectRoot)
      expect(project).toBeDefined()
      expect(project?.realPath).not.toBe(headWorkDir)
      expect(project?.realPath).not.toBe(middleWorkDir)
      expect(workDirSpy).not.toHaveBeenCalled()
      expect(tracked.readFilePaths).not.toContain(filePath)
      expectReadsStayInsideWindows(tracked.reads, filePath, size)

      const transcriptReads = tracked.reads.filter((read) => read.filePath === filePath)
      for (const read of transcriptReads) {
        const readEnd = read.position + read.length
        const overlapsMiddle = read.position < middleEnd && readEnd > middleStart
        expect(overlapsMiddle).toBe(false)
      }
    } finally {
      workDirSpy.mockRestore()
      await fs.rm(tailWorkDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('reads the first timestamp and custom title past 64KB of snapshot lines', async () => {
    const tailWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamcoder-snapshot-tail-'))
    const sessionId = crypto.randomUUID()
    const createdAt = '2024-04-02T03:04:05.000Z'
    const parts: string[] = []
    const push = (chunk: string) => { parts.push(chunk) }

    for (let index = 0; index < 11; index++) {
      push(JSON.stringify({
        type: 'file-history-snapshot',
        snapshot: {
          messageId: `snap-${index}`,
          trackedFileBackups: { 'notes.txt': 'x'.repeat(8 * 1024) },
          timestamp: '2024-04-01T00:00:00.000Z',
        },
      }) + '\n')
    }
    const titleOffset = Buffer.byteLength(parts.join(''))
    push(JSON.stringify({
      type: 'custom-title',
      customTitle: 'Title past 64KB',
      timestamp: createdAt,
    }) + '\n')
    push(jsonl([
      userLine('Prompt that must not become the title', '/tmp/snapshot-head'),
      assistantLine('Head answer'),
    ]))
    while (parts.length < 100) push(progressLine(40))
    const headEnd = Buffer.byteLength(parts.join(''))
    expect(titleOffset).toBeGreaterThan(LITE_READ_BUF_SIZE)
    expect(headEnd).toBeGreaterThan(LITE_READ_BUF_SIZE)

    push(progressLine(128 * 1024))
    const middleStart = Buffer.byteLength(parts.join(''))
    const middle = jsonl([
      userLine('middle prompt that must not be counted', '/tmp/snapshot-middle'),
      assistantLine('middle answer'),
      { type: 'custom-title', customTitle: 'Middle title must not win', timestamp: '2024-05-01T00:00:00.000Z' },
    ])
    push(middle)
    const middleEnd = Buffer.byteLength(parts.join(''))
    push(progressLine(2 * 1024 * 1024))
    push(jsonl([
      userLine('Tail prompt', '/tmp/snapshot-cwd'),
      assistantLine('Tail answer'),
      { type: 'session-meta', isMeta: true, workDir: tailWorkDir, timestamp: '2024-08-01T00:00:00.000Z' },
    ]))

    const content = parts.join('')
    const size = Buffer.byteLength(content)
    expect(middleStart).toBeGreaterThan(headEnd + LITE_READ_BUF_SIZE)
    expect(middleEnd).toBeLessThanOrEqual(size - LITE_READ_BUF_SIZE)
    const filePath = await writeTranscript('-snapshot-head', sessionId, content)

    try {
      const tracked = await withTranscriptReads(() => sessionService.listSessions({ includeLastAssistantMessage: true }))
      const session = tracked.result.sessions.find((item) => item.id === sessionId)
      expect(session?.title).toBe('Title past 64KB')
      expect(session?.createdAt).toBe(createdAt)
      expect(session?.workDir).toBe(tailWorkDir)
      expect(session?.lastAssistantMessage).toBe('Tail answer')
      expect(session?.messageCount).toBe(4)
      expect(session?.messageCountExact).toBe(false)

      const transcriptReads = tracked.reads.filter((read) => read.filePath === filePath)
      expect(transcriptReads.length).toBeGreaterThan(0)
      expect(transcriptReads.some((read) => read.position + read.length > LITE_READ_BUF_SIZE)).toBe(true)
      let total = 0
      for (const read of transcriptReads) {
        const readEnd = read.position + read.length
        expect(read.position < middleEnd && readEnd > middleStart).toBe(false)
        total += read.length
      }
      expect(total).toBeLessThan(size)
    } finally {
      await fs.rm(tailWorkDir, { recursive: true, force: true })
    }
  })

  it('omits messageCountExact when the first 100 lines cover the file', async () => {
    const sessionId = crypto.randomUUID()
    const parts: string[] = []
    for (let index = 0; index < 10; index++) {
      parts.push(JSON.stringify({
        type: 'file-history-snapshot',
        snapshot: {
          messageId: `snap-${index}`,
          trackedFileBackups: { 'notes.txt': 'y'.repeat(8 * 1024) },
          timestamp: '2024-03-01T00:00:00.000Z',
        },
      }) + '\n')
    }
    const createdAt = '2024-03-02T00:00:00.000Z'
    const titleOffset = Buffer.byteLength(parts.join(''))
    parts.push(JSON.stringify({
      type: 'custom-title',
      customTitle: 'Covered title',
      timestamp: createdAt,
    }) + '\n')
    parts.push(jsonl([
      userLine('covered prompt', '/tmp/covered'),
      assistantLine('covered answer'),
    ]))
    expect(titleOffset).toBeGreaterThan(LITE_READ_BUF_SIZE)
    expect(parts.length).toBeLessThan(100)

    const filePath = await writeTranscript('-covered-head', sessionId, parts.join(''))
    const tracked = await withTranscriptReads(() => sessionService.listSessions({ includeLastAssistantMessage: true }))
    const session = tracked.result.sessions.find((item) => item.id === sessionId)
    expect(session?.title).toBe('Covered title')
    expect(session?.createdAt).toBe(createdAt)
    expect(session?.messageCount).toBe(2)
    expect(session?.messageCountExact).toBeUndefined()
    expect(session?.lastAssistantMessage).toBe('covered answer')

    const transcriptReads = tracked.reads.filter((read) => read.filePath === filePath)
    const size = Buffer.byteLength(parts.join(''))
    const covered = transcriptReads.some((read) => read.position + read.length > LITE_READ_BUF_SIZE)
    expect(covered).toBe(true)
    expect(size).toBeGreaterThan(LITE_READ_BUF_SIZE)
  })
})
