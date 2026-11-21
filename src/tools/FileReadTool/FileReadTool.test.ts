import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as tokenEstimation from '../../services/tokenEstimation.js'
import type { ToolUseContext } from '../../Tool.js'
import { generateFileAttachment, getChangedFiles } from '../../utils/attachments.js'
import { normalizeAttachmentForAPI } from '../../utils/messages.js'
import { extractReadFilesFromMessages } from '../../utils/queryHelpers.js'
import { FileTooLargeError } from '../../utils/readFileInRange.js'
import { FileEditTool } from '../FileEditTool/FileEditTool.js'
import { FileWriteTool } from '../FileWriteTool/FileWriteTool.js'
import { agentContext, allow, turn } from '../testing/agentContext.js'
import { FileReadTool, MaxFileReadTokenExceededError } from './FileReadTool.js'

describe('FileReadTool input', () => {
  it('treats an empty page range as no page range', () => {
    const schema = FileReadTool.inputSchema
    expect(schema.parse({ file_path: '/tmp/a.md', pages: '' })).toEqual({ file_path: '/tmp/a.md' })
    expect(schema.parse({ file_path: '/tmp/a.pdf', pages: '1-5' })).toEqual({ file_path: '/tmp/a.pdf', pages: '1-5' })
    expect(schema.safeParse({ file_path: '/tmp/a.pdf', pages: 3 }).success).toBe(false)
  })
})

const LINE_CHARS = 39
const TOTAL_LINES = 50
const TOKEN_LIMIT = 100
const LINES_WITHIN_TOKEN_LIMIT = 10

const line = (n: number) => `line ${String(n).padStart(4, '0')} `.padEnd(LINE_CHARS, 'x')
const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => line(from + i)).join('\n')

type Limits = NonNullable<ToolUseContext['fileReadingLimits']>

const limitedContext = (fileReadingLimits: Limits = { maxTokens: TOKEN_LIMIT }) => agentContext({ fileReadingLimits })

async function read(context: ToolUseContext, filePath: string, range: { offset?: number; limit?: number } = {}) {
  const { data } = await FileReadTool.call({ file_path: filePath, ...range }, context)
  if (data.type !== 'text') throw new Error(`expected a text read, got ${data.type}`)
  const result = FileReadTool.mapToolResultToToolResultBlockParam(data, 'tool-1')
  return { file: data.file, text: String(result.content) }
}

describe('a text read that is over the limit', () => {
  let dir: string
  let big: string
  let countTokens: ReturnType<typeof spyOn<typeof tokenEstimation, 'countTokensWithAPI'>>
  let modelAtStart: string | undefined

  beforeEach(async () => {
    modelAtStart = process.env.ANTHROPIC_MODEL
    process.env.ANTHROPIC_MODEL = 'test-model'
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'read-truncation-')))
    big = path.join(dir, 'big.txt')
    await fs.writeFile(big, lines(1, TOTAL_LINES))
    countTokens = spyOn(tokenEstimation, 'countTokensWithAPI').mockResolvedValue(null)
  })

  afterEach(async () => {
    countTokens.mockRestore()
    if (modelAtStart === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = modelAtStart
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns the lines that fit and says which lines they are', async () => {
    const { file, text } = await read(limitedContext(), big)
    expect(file).toMatchObject({ content: lines(1, LINES_WITHIN_TOKEN_LIMIT), numLines: LINES_WITHIN_TOKEN_LIMIT, startLine: 1, totalLines: TOTAL_LINES, truncated: true })
    expect(text).toContain(`${LINES_WITHIN_TOKEN_LIMIT}\t${line(LINES_WITHIN_TOKEN_LIMIT)}`)
    expect(text).not.toContain(line(LINES_WITHIN_TOKEN_LIMIT + 1))
    expect(text).toContain(`it returned lines 1-${LINES_WITHIN_TOKEN_LIMIT} of ${TOTAL_LINES}`)
    expect(text).toContain(`offset ${LINES_WITHIN_TOKEN_LIMIT + 1}`)
    expect(text).toContain('limit')
  })

  it('cuts a read that gives offset and limit by the same rule', async () => {
    const { file, text } = await read(limitedContext(), big, { offset: 21, limit: 20 })
    expect(file).toMatchObject({ content: lines(21, 30), numLines: 10, startLine: 21, totalLines: TOTAL_LINES, truncated: true })
    expect(text).toContain(`it returned lines 21-30 of ${TOTAL_LINES}`)
    expect(text).toContain('offset 31')
  })

  it('keeps fewer lines when the counted tokens are denser than the estimate', async () => {
    countTokens.mockResolvedValue(1000)
    const { file } = await read(limitedContext(), big)
    expect(file.numLines).toBe(5)
  })

  it('cuts at the byte limit when no limit is given', async () => {
    const { file, text } = await read(limitedContext({ maxTokens: 100_000, maxSizeBytes: 200 }), big)
    expect(file).toMatchObject({ content: lines(1, 5), numLines: 5, startLine: 1, totalLines: TOTAL_LINES, truncated: true })
    expect(text).toContain(`it returned lines 1-5 of ${TOTAL_LINES}`)
  })

  it('applies the token limit after the byte limit', async () => {
    const { file } = await read(limitedContext({ maxTokens: TOKEN_LIMIT, maxSizeBytes: 1000 }), big)
    expect(file.numLines).toBe(LINES_WITHIN_TOKEN_LIMIT)
  })

  it('still fails when the first line alone is over the token limit', async () => {
    const oneLine = path.join(dir, 'one-line.txt')
    await fs.writeFile(oneLine, 'x'.repeat(2000))
    const context = limitedContext()
    await expect(FileReadTool.call({ file_path: oneLine }, context)).rejects.toBeInstanceOf(MaxFileReadTokenExceededError)
    expect(context.readFileState.has(oneLine)).toBe(false)
  })

  it('still fails when the first line alone is over the byte limit', async () => {
    const oneLine = path.join(dir, 'one-line.txt')
    await fs.writeFile(oneLine, 'x'.repeat(2000))
    await expect(FileReadTool.call({ file_path: oneLine }, limitedContext({ maxTokens: 100_000, maxSizeBytes: 200 }))).rejects.toBeInstanceOf(FileTooLargeError)
  })

  it('leaves a read that fits unmarked', async () => {
    const context = limitedContext()
    const { file, text } = await read(context, big, { offset: 1, limit: 5 })
    expect(file.truncated).toBeUndefined()
    expect(text).not.toContain('it returned lines')
    expect(context.readFileState.get(big)?.truncated).toBeUndefined()
  })

  it('records the returned range in the read state', async () => {
    const context = limitedContext()
    await read(context, big, { offset: 21, limit: 20 })
    expect(context.readFileState.get(big)).toMatchObject({ content: lines(21, 30), offset: 21, limit: 20, truncated: { lastLine: 30, totalLines: TOTAL_LINES } })
  })

  it('lets Edit proceed and makes Write refuse until a read that is not cut', async () => {
    const context = limitedContext()
    await read(context, big)

    const edit = { file_path: big, old_string: line(3), new_string: 'edited', replace_all: false }
    expect(await FileEditTool.validateInput(edit, context)).toMatchObject({ result: true })
    await FileEditTool.call(edit, context, allow, turn)
    expect((await fs.readFile(big, 'utf8')).split('\n').slice(2, 4)).toEqual(['edited', line(4)])

    const write = { file_path: big, content: 'replacement\n' }
    const refusal = await FileWriteTool.validateInput(write, context)
    const reason = 'message' in refusal ? refusal.message : ''
    expect(refusal.result).toBe(false)
    expect(reason).toContain(`stopped at line ${LINES_WITHIN_TOKEN_LIMIT} of ${TOTAL_LINES}`)
    expect(reason).toContain('use Edit')

    await read(context, big, { offset: 40, limit: 5 })
    expect(await FileWriteTool.validateInput(write, context)).toEqual({ result: true })
  })

  it('makes Write refuse right after the cut read', async () => {
    const context = limitedContext()
    await read(context, big)
    expect((await FileWriteTool.validateInput({ file_path: big, content: 'replacement\n' }, context)).result).toBe(false)
  })

  it('answers a repeat of the same read with the unchanged notice', async () => {
    const context = limitedContext()
    await read(context, big)
    const { data } = await FileReadTool.call({ file_path: big }, context)
    expect(data.type).toBe('file_unchanged')
  })

  it('keeps the cut through a restore from the transcript, also after an Edit', async () => {
    const { text } = await read(limitedContext(), big)
    const message = (type: 'assistant' | 'user', uuid: string, block: object) => ({ type, uuid, timestamp: new Date().toISOString(), message: { role: type, content: [block] } })
    const readUse = message('assistant', 'a1', { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: big } })
    const readResult = message('user', 'u1', { type: 'tool_result', tool_use_id: 'read-1', content: text })
    const editUse = message('assistant', 'a2', { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: big, old_string: 'a', new_string: 'b' } })
    const editResult = message('user', 'u2', { type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' })
    const restore = (messages: object[]) => extractReadFilesFromMessages(messages as unknown as Parameters<typeof extractReadFilesFromMessages>[0], dir)
    const cut = { lastLine: LINES_WITHIN_TOKEN_LIMIT, totalLines: TOTAL_LINES }

    expect(restore([readUse, readResult]).get(big)).toMatchObject({ content: lines(1, LINES_WITHIN_TOKEN_LIMIT), offset: 1, truncated: cut })
    const afterEdit = restore([readUse, readResult, editUse, editResult])
    expect(afterEdit.get(big)).toMatchObject({ content: lines(1, TOTAL_LINES), truncated: cut })
    expect((await FileWriteTool.validateInput({ file_path: big, content: 'replacement\n' }, agentContext({ readFileState: afterEdit }))).result).toBe(false)
  })

  it('still fails for a caller that asks for the whole file or nothing', async () => {
    const context = limitedContext({ maxTokens: TOKEN_LIMIT, failWhenOverLimit: true })
    await expect(FileReadTool.call({ file_path: big }, context)).rejects.toBeInstanceOf(MaxFileReadTokenExceededError)
    await expect(FileReadTool.call({ file_path: big }, limitedContext({ maxTokens: 100_000, maxSizeBytes: 200, failWhenOverLimit: true }))).rejects.toBeInstanceOf(FileTooLargeError)
    expect(context.readFileState.has(big)).toBe(false)
  })

  it('cuts a file attached with @ by the same rule', async () => {
    const attachment = await generateFileAttachment(big, limitedContext(), 'success', 'error', 'at-mention')
    expect(attachment).toMatchObject({ type: 'file', content: { type: 'text', file: { numLines: LINES_WITHIN_TOKEN_LIMIT, truncated: true } } })
    expect(JSON.stringify(normalizeAttachmentForAPI(attachment!))).toContain(`it returned lines 1-${LINES_WITHIN_TOKEN_LIMIT} of ${TOTAL_LINES}`)

    const oneLine = path.join(dir, 'one-line.txt')
    await fs.writeFile(oneLine, 'x'.repeat(2000))
    expect(await generateFileAttachment(oneLine, limitedContext(), 'success', 'error', 'at-mention')).toBeNull()
  })

  it('does not report a cut read as an outside change to a file the agent wrote', async () => {
    const context = limitedContext()
    const written = path.join(dir, 'written.txt')
    await FileWriteTool.call({ file_path: written, content: lines(1, TOTAL_LINES) }, context, allow, turn)
    const stateAfterWrite = context.readFileState.get(written)
    const later = new Date(Date.now() + 5000)
    await fs.utimes(written, later, later)
    expect(await getChangedFiles(context)).toEqual([])
    expect(context.readFileState.get(written)).toEqual(stateAfterWrite)
  })
})
