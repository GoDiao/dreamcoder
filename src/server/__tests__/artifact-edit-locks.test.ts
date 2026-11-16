import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ToolUseContext } from '../../Tool.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import { ARTIFACT_EDIT_LOCKS_ENV } from '../../utils/artifactEditLock.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { setHostRequester } from '../../utils/hostRequests.js'
import { artifactEditLocks, createArtifactEditLocks, type ArtifactEditLocks } from '../services/artifactEditLocks.js'
import { conversationService } from '../services/conversationService.js'
import type { SessionStateEvent } from '../session/state/types.js'
import { handleRawCliMessage } from '../ws/handler.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
const locksEnvAtLoad = process.env[ARTIFACT_EDIT_LOCKS_ENV]

let root: string
let deckDir: string
let locks: ArtifactEditLocks
let replies: Array<{ requestId: string; result: unknown }>
let answers: Map<string, (result: unknown) => void>
let published: Array<{ sessionId: string; event: SessionStateEvent }>
let onPublish = () => {}
const nextPublish = () => new Promise<void>(resolve => { onPublish = resolve })
const answerTo = (requestId: string) => new Promise<unknown>(resolve => { answers.set(requestId, resolve) })
const publish = (sessionId: string, event: SessionStateEvent) => {
  published.push({ sessionId, event })
  onPublish()
  return {}
}
const store = { apply: publish, applyIfPresent: publish }
const waits = () => published.map(({ sessionId, event }) => (event.type === 'artifact_wait_changed' ? [sessionId, event.wait] : null)).filter(Boolean)

const allow = (async () => ({ behavior: 'allow' })) as unknown as Parameters<typeof FileWriteTool.call>[2]
const turn = { uuid: 'turn-1' } as unknown as Parameters<typeof FileWriteTool.call>[3]

function agentContext(abortController = new AbortController()): ToolUseContext {
  const appState = getDefaultAppState()
  let fileHistory = appState.fileHistory
  return {
    updateFileHistoryState: (update: (state: typeof fileHistory) => typeof fileHistory) => {
      fileHistory = update(fileHistory)
    },
    readFileState: createFileStateCacheWithSizeLimit(100),
    abortController,
    getAppState: () => appState,
    setAppState: () => {},
    options: { tools: [], commands: [], mcpClients: [], agentDefinitions: { activeAgents: [], allAgents: [] }, isNonInteractiveSession: true },
    messages: [],
  } as unknown as ToolUseContext
}

function useLocksAsHost() {
  setHostRequester(async <T,>(request: Record<string, unknown>, _schema: unknown, signal?: AbortSignal) => {
    const requestId = crypto.randomUUID()
    const answer = answerTo(requestId)
    expect(locks.handleControlRequest('session-1', { request_id: requestId, request: request as never })).toBe(true)
    return new Promise<T>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true })
      void answer.then(result => resolve((result as { response: T }).response))
    })
  })
}

const settled = async <T,>(promise: Promise<T>) => {
  let done = false
  promise.then(() => { done = true }, () => { done = true })
  await Bun.sleep(30)
  return done
}

const slidePath = (id: string) => path.join(deckDir, 'slides', `${id}.html`)

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-edit-locks-')))
  process.env.DREAMCODER_CONFIG_DIR = path.join(root, 'config')
  process.env[ARTIFACT_EDIT_LOCKS_ENV] = '1'
  deckDir = path.join(root, 'repo', 'dc_artifacts', 'talk')
  await fs.mkdir(path.join(deckDir, 'slides'), { recursive: true })
  await fs.writeFile(slidePath('cover'), '<section>cover</section>\n')
  published = []
  locks = createArtifactEditLocks(undefined, store)
  replies = []
  answers = new Map()
  spyOn(conversationService, 'respondToHostRequest').mockImplementation((_sessionId, requestId, result) => {
    replies.push({ requestId, result })
    answers.get(requestId)?.(result)
    return true
  })
})

afterEach(async () => {
  jest.useRealTimers()
  mock.restore()
  await locks.release(deckDir, 'tab')
  setHostRequester(null)
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  if (locksEnvAtLoad === undefined) delete process.env[ARTIFACT_EDIT_LOCKS_ENV]
  else process.env[ARTIFACT_EDIT_LOCKS_ENV] = locksEnvAtLoad
  await fs.rm(root, { recursive: true, force: true })
})

describe('the lock the sidecar holds while the user edits an artifact', () => {
  it('answers an agent at once when nobody edits the artifact', async () => {
    expect(await locks.wait(deckDir)).toEqual([])
  })

  it('answers once the user is done, with every file the user changed meanwhile', async () => {
    await locks.hold(deckDir, 'tab')
    const waiting = locks.wait(deckDir)
    expect(await settled(waiting)).toBe(false)
    await locks.record(deckDir, ['slides/cover.html'])
    await locks.record(deckDir, ['artifact.json', 'slides/cover.html'])
    await locks.release(deckDir, 'tab')
    expect(await waiting).toEqual(['slides/cover.html', 'artifact.json'])
  })

  it('stays locked until every holder has let go, so one tab finishing does not free another tab still editing', async () => {
    await locks.hold(deckDir, 'tab-a')
    await locks.hold(deckDir, 'tab-b')
    const waiting = locks.wait(deckDir)
    await locks.release(deckDir, 'tab-a')
    expect(await settled(waiting)).toBe(false)
    await locks.release(deckDir, 'tab-b')
    expect(await waiting).toEqual([])
  })

  it('lets go by itself when the end of the edit never comes, and a renewed hold keeps it', async () => {
    jest.useFakeTimers()
    locks = createArtifactEditLocks(300, store)
    await locks.hold(deckDir, 'tab')
    let freed = false
    const waiting = locks.wait(deckDir).finally(() => { freed = true })
    jest.advanceTimersByTime(150)
    await locks.hold(deckDir, 'tab')
    jest.advanceTimersByTime(150)
    await fs.stat(deckDir)
    expect(freed).toBe(false)
    jest.advanceTimersByTime(150)
    expect(await waiting).toEqual([])
  })

  it('answers the control request of the CLI for a path inside the artifact, and at once for a path outside any artifact', async () => {
    useLocksAsHost()
    await locks.hold(deckDir, 'tab')
    const { requestHost } = await import('../../utils/hostRequests.js')
    const inside = requestHost({ subtype: 'artifact_edit_wait', path: slidePath('cover') }, null as never)
    expect(await requestHost({ subtype: 'artifact_edit_wait', path: path.join(root, 'repo', 'README.md') }, null as never)).toEqual({ files: [] })
    expect(await settled(inside)).toBe(false)
    await locks.release(deckDir, 'tab')
    expect(await inside).toEqual({ files: [] })
    expect(locks.handleControlRequest('session-1', { request_id: 'r', request: { subtype: 'kanban_query' } })).toBe(false)
  })
})

describe('what the session shows while its agent waits for the user', () => {
  function ask(requestId: string) {
    expect(locks.handleControlRequest('session-1', { request_id: requestId, request: { subtype: 'artifact_edit_wait', path: slidePath('cover') } })).toBe(true)
  }

  async function askAndWait(requestId: string) {
    const shown = nextPublish()
    ask(requestId)
    await shown
  }

  it('shows the artifact the agent waits for, with the title from its manifest, and clears it when the user is done', async () => {
    await fs.writeFile(path.join(deckDir, 'artifact.json'), JSON.stringify({ version: 1, id: 'd', kind: 'deck', title: 'Quarterly review', entry: 'index.html', slides: ['cover'] }))
    await locks.hold(deckDir, 'tab')
    await askAndWait('r1')
    expect(waits()).toEqual([['session-1', { folder: deckDir, title: 'Quarterly review' }]])
    const cleared = nextPublish()
    await locks.release(deckDir, 'tab')
    await cleared
    expect(waits()).toEqual([['session-1', { folder: deckDir, title: 'Quarterly review' }], ['session-1', null]])
  })

  it('shows nothing when the artifact is not locked, and uses the folder name without a manifest', async () => {
    const answered = answerTo('r1')
    ask('r1')
    expect(await answered).toEqual({ response: { files: [] } })
    expect(waits()).toEqual([])
    await locks.hold(deckDir, 'tab')
    await askAndWait('r2')
    expect(waits()).toEqual([['session-1', { folder: deckDir, title: 'talk' }]])
  })

  it('clears the wait when the CLI cancels the request because the turn was interrupted', async () => {
    await locks.hold(deckDir, 'tab')
    await askAndWait('r1')
    locks.cancelWait('session-1', 'r1')
    expect(waits().at(-1)).toEqual(['session-1', null])
  })

  it('passes a cancel from the CLI on to the locks', () => {
    const cancel = spyOn(artifactEditLocks, 'cancelWait').mockImplementation(() => {})
    handleRawCliMessage('session-1', { type: 'control_cancel_request', request_id: 'r1' })
    expect(cancel).toHaveBeenCalledWith('session-1', 'r1')
  })
})

describe('an agent writing into an artifact the user is editing', () => {
  it('waits with a Write until the user is done, then writes', async () => {
    useLocksAsHost()
    await locks.hold(deckDir, 'tab')
    const writing = FileWriteTool.call({ file_path: slidePath('agenda'), content: '<section>agenda</section>\n' }, agentContext(), allow, turn)
    expect(await settled(writing)).toBe(false)
    await expect(fs.access(slidePath('agenda'))).rejects.toThrow()
    await locks.release(deckDir, 'tab')
    await writing
    expect(await fs.readFile(slidePath('agenda'), 'utf-8')).toBe('<section>agenda</section>\n')
  })

  it('refuses an Edit after the wait when the user changed files, names them and leaves the file to the user', async () => {
    useLocksAsHost()
    const context = agentContext()
    await FileReadTool.call({ file_path: slidePath('cover') }, context)
    await locks.hold(deckDir, 'tab')
    const editing = FileEditTool.call({ file_path: slidePath('cover'), old_string: 'cover', new_string: 'agent', replace_all: false }, context, allow, turn)
    expect(await settled(editing)).toBe(false)
    await fs.writeFile(slidePath('cover'), '<section>user</section>\n')
    await locks.record(deckDir, ['slides/cover.html'])
    await locks.release(deckDir, 'tab')
    await expect(editing).rejects.toThrow(`The user was editing the artifact ${deckDir} in the app while you waited, and changed slides/cover.html there. Read those files`)
    expect(await fs.readFile(slidePath('cover'), 'utf-8')).toBe('<section>user</section>\n')
  })

  it('stops waiting when the turn is interrupted', async () => {
    useLocksAsHost()
    await locks.hold(deckDir, 'tab')
    const abort = new AbortController()
    const writing = FileWriteTool.call({ file_path: slidePath('agenda'), content: 'x' }, agentContext(abort), allow, turn)
    expect(await settled(writing)).toBe(false)
    abort.abort()
    await expect(writing).rejects.toThrow('aborted')
    await expect(fs.access(slidePath('agenda'))).rejects.toThrow()
  })

  it('does not ask a host that is not the DreamCoder sidecar, no host at all, or for a file outside artifacts', async () => {
    await locks.hold(deckDir, 'tab')
    await FileWriteTool.call({ file_path: slidePath('agenda'), content: 'x' }, agentContext(), allow, turn)
    expect(await fs.readFile(slidePath('agenda'), 'utf-8')).toBe('x')
    useLocksAsHost()
    delete process.env[ARTIFACT_EDIT_LOCKS_ENV]
    await FileWriteTool.call({ file_path: slidePath('other'), content: 'y' }, agentContext(), allow, turn)
    expect(await fs.readFile(slidePath('other'), 'utf-8')).toBe('y')
    process.env[ARTIFACT_EDIT_LOCKS_ENV] = '1'
    await FileWriteTool.call({ file_path: path.join(root, 'repo', 'notes.md'), content: 'x' }, agentContext(), allow, turn)
    expect(replies).toEqual([])
  })
})
