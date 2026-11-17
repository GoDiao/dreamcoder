import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ToolUseContext } from '../../Tool.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import type { Message } from '../../types/message.js'
import { getChangedFiles } from '../../utils/attachments.js'
import { DECK_ENTRY_HTML } from '../../utils/deck.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { extractReadFilesFromMessages } from '../../utils/queryHelpers.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { ArtifactService } from '../services/artifactService.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR

let root: string
let artifactsDir: string
let deckDir: string
let service: ArtifactService

const manifest = { version: 1, id: 'id-talk', kind: 'deck', title: 'Talk', entry: 'index.html', slides: ['cover', 'agenda', 'close'] }
const slide = (text: string) => `<section class="slide"><h1>${text}</h1></section>\n`

function agentContext(): ToolUseContext {
  const appState = getDefaultAppState()
  let fileHistory = appState.fileHistory
  return {
    updateFileHistoryState: (update: (state: typeof fileHistory) => typeof fileHistory) => {
      fileHistory = update(fileHistory)
    },
    readFileState: createFileStateCacheWithSizeLimit(100),
    abortController: new AbortController(),
    getAppState: () => appState,
    setAppState: () => {},
    options: { tools: [], commands: [], mcpClients: [], agentDefinitions: { activeAgents: [], allAgents: [] }, isNonInteractiveSession: true },
    messages: [],
  } as unknown as ToolUseContext
}

const allow = (async () => ({ behavior: 'allow' })) as unknown as Parameters<typeof FileWriteTool.call>[2]
const turn = { uuid: 'turn-1' } as unknown as Parameters<typeof FileWriteTool.call>[3]

const changedNames = async (context: ToolUseContext) => (await getChangedFiles(context)).map(attachment => ('filename' in attachment ? path.relative(deckDir, attachment.filename) : attachment.type))

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'deck-edit-notice-')))
  process.env.DREAMCODER_CONFIG_DIR = path.join(root, 'config')
  const repo = path.join(root, 'repo')
  await fs.mkdir(repo, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  const sessionDir = path.join(root, 'config', 'projects', sanitizePath(repo))
  await fs.mkdir(sessionDir, { recursive: true })
  await fs.writeFile(path.join(sessionDir, 'session-1.jsonl'), JSON.stringify({ type: 'session-meta', workDir: repo, timestamp: new Date().toISOString() }) + '\n')
  artifactsDir = path.join(repo, 'dc_artifacts')
  deckDir = path.join(artifactsDir, 'talk')
  await fs.mkdir(path.join(deckDir, 'slides'), { recursive: true })
  await fs.writeFile(path.join(deckDir, 'index.html'), DECK_ENTRY_HTML)
  await fs.writeFile(path.join(deckDir, 'deck.css'), '')
  service = new ArtifactService()
})

afterEach(async () => {
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(root, { recursive: true, force: true })
})

async function agentWrites(context: ToolUseContext, file: string, content: string) {
  await FileWriteTool.call({ file_path: path.join(deckDir, file), content }, context, allow, turn)
}

async function agentWritesDeck(context: ToolUseContext) {
  await agentWrites(context, 'artifact.json', JSON.stringify(manifest, null, 2) + '\n')
  for (const id of manifest.slides) await agentWrites(context, `slides/${id}.html`, slide(id))
  await laterThanNow()
}

async function writeDeckOnDisk() {
  await fs.writeFile(path.join(deckDir, 'artifact.json'), JSON.stringify(manifest, null, 2) + '\n')
  for (const id of manifest.slides) await fs.writeFile(path.join(deckDir, 'slides', `${id}.html`), slide(id))
}

async function laterThanNow() {
  await new Promise(resolve => setTimeout(resolve, 20))
}

function transcriptOf(tool: string, input: Record<string, unknown>, result: string, at: Date): Message[] {
  return [
    { type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: tool, input }] } },
    { type: 'user', uuid: 'u', timestamp: at.toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: result }] } },
  ] as unknown as Message[]
}

describe('what the agent hears after the user edits a deck in the panel', () => {
  it('reports a reorder and a text edit on files the agent wrote, with the new order in the note', async () => {
    const context = agentContext()
    await agentWritesDeck(context)
    await service.reorderSlides(artifactsDir, 'talk', ['close', 'cover', 'agenda'])
    await service.writeSlide(artifactsDir, 'talk', 'agenda', slide('Plan'), slide('agenda'))
    const notes = await getChangedFiles(context)
    expect(notes.map(note => ('filename' in note ? path.relative(deckDir, note.filename) : note.type)).sort()).toEqual(['artifact.json', 'slides/agenda.html'])
    const manifestNote = notes.find(note => 'filename' in note && note.filename.endsWith('artifact.json'))
    expect(manifestNote && 'snippet' in manifestNote ? manifestNote.snippet : '').toMatch(/"close",\s*\S*\s*"cover",\s*\S*\s*"agenda"/)
  })

  it('reports a deletion through the manifest and drops the deleted slide file without a note', async () => {
    const context = agentContext()
    await agentWritesDeck(context)
    await service.deleteSlide(artifactsDir, 'talk', 'agenda')
    expect(await changedNames(context)).toEqual(['artifact.json'])
    expect(context.readFileState.has(path.join(deckDir, 'slides', 'agenda.html'))).toBe(false)
  })

  it('reports a change to a file the agent edited', async () => {
    const context = agentContext()
    await writeDeckOnDisk()
    await FileReadTool.call({ file_path: path.join(deckDir, 'artifact.json') }, context)
    await FileEditTool.call({ file_path: path.join(deckDir, 'artifact.json'), old_string: '"Talk"', new_string: '"Launch"', replace_all: false }, context, allow, turn)
    await laterThanNow()
    await service.reorderSlides(artifactsDir, 'talk', ['close', 'cover', 'agenda'])
    expect(await changedNames(context)).toEqual(['artifact.json'])
  })

  it('does not report a change to a file the agent only read, because a full Read is recorded with offset 1', async () => {
    const context = agentContext()
    await writeDeckOnDisk()
    await FileReadTool.call({ file_path: path.join(deckDir, 'artifact.json') }, context)
    expect(context.readFileState.get(path.join(deckDir, 'artifact.json'))?.offset).toBe(1)
    await laterThanNow()
    await service.reorderSlides(artifactsDir, 'talk', ['close', 'cover', 'agenda'])
    expect(await changedNames(context)).toEqual([])
  })

  it('reports only the first change after the agent last wrote a file and makes it read again before the next write', async () => {
    const context = agentContext()
    await agentWritesDeck(context)
    await service.reorderSlides(artifactsDir, 'talk', ['close', 'cover', 'agenda'])
    expect(await changedNames(context)).toEqual(['artifact.json'])
    await laterThanNow()
    await service.deleteSlide(artifactsDir, 'talk', 'cover')
    expect(await changedNames(context)).toEqual([])
    const next = JSON.stringify({ ...manifest, slides: ['close', 'agenda'] }, null, 2) + '\n'
    await expect(agentWrites(context, 'artifact.json', next)).rejects.toThrow('Read it again')
    await FileReadTool.call({ file_path: path.join(deckDir, 'artifact.json') }, context)
    await agentWrites(context, 'artifact.json', next)
    await laterThanNow()
    await service.reorderSlides(artifactsDir, 'talk', ['agenda', 'close'])
    expect(await changedNames(context)).toEqual(['artifact.json'])
  })

  it('after a resume, reports a change made after a full Read in the transcript', async () => {
    await writeDeckOnDisk()
    const content = await fs.readFile(path.join(deckDir, 'artifact.json'), 'utf-8')
    const numbered = content.split('\n').map((line, index) => `${index + 1}\t${line}`).join('\n')
    const messages = transcriptOf('Read', { file_path: path.join(deckDir, 'artifact.json') }, numbered, new Date())
    await laterThanNow()
    await service.reorderSlides(artifactsDir, 'talk', ['close', 'cover', 'agenda'])
    const context = { ...agentContext(), readFileState: extractReadFilesFromMessages(messages, deckDir, 100) } as ToolUseContext
    expect(await changedNames(context)).toEqual(['artifact.json'])
  })

  it('after a resume, does not report a change made while the CLI was down to a file the agent last edited', async () => {
    await writeDeckOnDisk()
    const messages = transcriptOf('Edit', { file_path: path.join(deckDir, 'artifact.json'), old_string: '"Talk"', new_string: '"Talk"' }, 'ok', new Date())
    await laterThanNow()
    await service.reorderSlides(artifactsDir, 'talk', ['close', 'cover', 'agenda'])
    const context = { ...agentContext(), readFileState: extractReadFilesFromMessages(messages, deckDir, 100) } as ToolUseContext
    expect(await changedNames(context)).toEqual([])
  })
})
