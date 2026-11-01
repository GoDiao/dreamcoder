import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { copyArtifactFolder } from '../../utils/artifactTransfer.js'
import { getGlobalArtifactsDir } from '../../utils/artifacts.js'
import { CANVAS_ENTRY_HTML } from '../../utils/canvas.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { handleArtifactsApi } from '../api/artifacts.js'
import { handleSessionsApi } from '../api/sessions.js'
import { systemRecord, writeSystems } from '../../utils/__tests__/designSystemFixtures.js'
import { ArtifactService, GLOBAL_ARTIFACTS_MARKER } from '../services/artifactService.js'
import { createStreamState, translateCliOutput } from '../session/translate.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR

let root: string
let service: ArtifactService

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function makeRepo(name: string) {
  const repo = path.join(root, name)
  await fs.mkdir(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'artifacts@example.com')
  git(repo, 'config', 'user.name', 'Artifacts')
  await fs.writeFile(path.join(repo, 'README.md'), 'x')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return await fs.realpath(repo)
}

async function writeArtifact(artifactsDir: string, name: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = path.join(artifactsDir, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'artifact.json'), JSON.stringify(manifest))
  for (const [file, content] of Object.entries(files)) await fs.writeFile(path.join(dir, file), content)
}

async function writeSession(workDir: string, sessionId: string) {
  const dir = path.join(root, 'config', 'projects', sanitizePath(workDir))
  await fs.mkdir(dir, { recursive: true })
  const entries = [
    { type: 'session-meta', workDir, timestamp: new Date().toISOString() },
    { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: new Date().toISOString() },
  ]
  await fs.writeFile(path.join(dir, `${sessionId}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
}

function translateArtifactMessage(cliMsg: Record<string, unknown>, _sessionId: string) {
  return translateCliOutput(cliMsg, createStreamState()).messages
}

const page = (title: string) => ({ version: 1, id: `id-${title}`, kind: 'page', title, entry: 'index.html' })

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifacts-service-'))
  await fs.mkdir(path.join(root, 'config', 'projects'), { recursive: true })
  process.env.DREAMCODER_CONFIG_DIR = path.join(root, 'config')
  service = new ArtifactService()
})

afterEach(async () => {
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(root, { recursive: true, force: true })
})

describe('artifact_written translation', () => {
  it('forwards the written path, tool and agent to the client', () => {
    expect(translateArtifactMessage({
      type: 'system',
      subtype: 'artifact_written',
      path: '/work/dc_artifacts/a/index.html',
      tool_name: 'Write',
      agent_id: 'agent-1',
    }, 'session-1')).toEqual([
      { type: 'artifact_written', path: '/work/dc_artifacts/a/index.html', toolName: 'Write', agentId: 'agent-1' },
    ])
  })

  it('turns a ChooseDesignTemplate tool result into its structured choice', () => {
    const messages = translateArtifactMessage({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'pick-1', content: 'The user chose the template "saas".' }] },
      tool_use_result: { choice: 'saas', name: 'saas', path: '/p/dc_artifacts/saas', guidance: 'adapt it' },
    }, 'session-1')
    expect(messages).toEqual([expect.objectContaining({ type: 'tool_result', toolUseId: 'pick-1', content: { choice: 'saas' } })])
  })

  it('turns an AskUserQuestion tool result into its structured answers', () => {
    const answers = { 'Pick one?': 'A' }
    const messages = translateArtifactMessage({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ask-1', content: 'User has answered your questions: "Pick one?"="A".' }] },
      tool_use_result: { questions: [{ question: 'Pick one?', options: [{ label: 'A' }] }], answers },
    }, 'session-1')
    expect(messages).toEqual([
      expect.objectContaining({ type: 'tool_result', toolUseId: 'ask-1', content: expect.objectContaining({ answers }) }),
    ])
  })

  it('drops an event without a path', () => {
    expect(translateArtifactMessage({ type: 'system', subtype: 'artifact_written', tool_name: 'Write' }, 'session-1')).toEqual([])
  })
})

describe('ArtifactService.listAll', () => {
  it('lists artifacts of every known work directory and the global store', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'report', page('Report'), { 'index.html': '<p>r</p>' })
    await writeArtifact(getGlobalArtifactsDir(), 'moved', page('Moved'), { 'index.html': '<p>m</p>' })

    const items = await service.listAll()
    const report = items.find((item) => item.name === 'report')!
    const moved = items.find((item) => item.name === 'moved')!
    expect(report).toMatchObject({ workDir: repo, projectRoot: repo, error: null })
    expect(report.manifest?.title).toBe('Report')
    expect(moved).toMatchObject({ workDir: null, artifactsDir: getGlobalArtifactsDir() })
  })

  it('finds artifacts in a git worktree of a known project', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    const worktree = path.join(root, 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    await writeArtifact(path.join(worktree, 'dc_artifacts'), 'in-wt', page('In worktree'))

    const item = (await service.listAll()).find((candidate) => candidate.name === 'in-wt')!
    expect(item.branch).toBe('feature')
    expect(item.projectRoot).toBe(repo)
  })

  it('lists a broken manifest with its reason instead of dropping it', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await fs.mkdir(path.join(repo, 'dc_artifacts', 'bad'), { recursive: true })
    await fs.writeFile(path.join(repo, 'dc_artifacts', 'bad', 'artifact.json'), '{')

    const bad = (await service.listAll()).find((item) => item.name === 'bad')!
    expect(bad.manifest).toBeNull()
    expect(bad.error).toContain('not valid JSON')
  })

  it('flags an artifact whose entry file is missing and leaves the others alone', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'ok', page('Ok'), { 'index.html': 'x' })
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'hollow', page('Hollow'))
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'board', { version: 1, id: 'id-board', kind: 'canvas', title: 'Board', entry: 'index.html' })

    const items = await service.listAll()
    expect(items.find((item) => item.name === 'ok')!.entryMissing).toBe(false)
    expect(items.find((item) => item.name === 'hollow')!.entryMissing).toBe(true)
    expect(items.find((item) => item.name === 'board')!.entryMissing).toBe(true)
  })

  it('lists an artifact without an id as having a bad manifest', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'old', { version: 1, kind: 'page', title: 'Old', entry: 'index.html' })

    const old = (await service.listAll()).find((item) => item.name === 'old')!
    expect(old.manifest).toBeNull()
    expect(old.id).toBeNull()
    expect(old.error).toBe('id is required')
  })
})

describe('ArtifactService.registerWrittenPath', () => {
  it('registers an unseen work directory, persists it and excludes dc_artifacts from git once', async () => {
    const repo = await makeRepo('repo')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'fresh', page('Fresh'))

    await service.registerWrittenPath(path.join(repo, 'dc_artifacts', 'fresh', 'index.html'))
    await service.registerWrittenPath(path.join(repo, 'dc_artifacts', 'fresh', 'index.html'))

    const exclude = await fs.readFile(path.join(repo, '.git', 'info', 'exclude'), 'utf-8')
    expect(exclude.split('\n').filter((line) => line.trim() === 'dc_artifacts/')).toHaveLength(1)
    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
    expect((await new ArtifactService().listAll()).some((item) => item.name === 'fresh')).toBe(true)
  })

  it('does not register the global store as a work directory', async () => {
    await service.registerWrittenPath(path.join(getGlobalArtifactsDir(), 'a', 'index.html'))
    await expect(fs.stat(path.join(root, 'config', 'artifact-registry.json'))).rejects.toThrow()
  })

  it('ignores a path without a dc_artifacts segment', async () => {
    expect(await service.registerWrittenPath(path.join(root, 'src', 'a.html'))).toBeNull()
  })
})

describe('ArtifactService.listForWorkDir', () => {
  it('puts the session folder first and the same project elsewhere after it', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    const worktree = path.join(root, 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    const otherRepo = await makeRepo('other')
    await writeSession(otherRepo, 'session-2')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'mine', page('Mine'))
    await writeArtifact(path.join(worktree, 'dc_artifacts'), 'sibling', page('Sibling'))
    await writeArtifact(path.join(otherRepo, 'dc_artifacts'), 'foreign', page('Foreign'))
    await writeArtifact(getGlobalArtifactsDir(), 'global-one', page('Global'))

    const { current, others } = await service.listForWorkDir(repo)
    expect(current.map((item) => item.name)).toEqual(['mine'])
    expect(others.map((item) => item.name).sort()).toEqual(['global-one', 'sibling'])
  })
})

async function writeSystem(artifactsDir: string, name: string, source: 'bundled' | 'extracted' = 'extracted') {
  const dir = path.join(artifactsDir, 'systems', name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'system.json'), JSON.stringify({ version: 1, name, source, license: 'x', author: 'y' }))
}

describe('ArtifactService.listForWorkDir design systems', () => {
  it('lists the systems of the session folder first and those of the same project and the global store after', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    const worktree = path.join(root, 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    await writeSystem(path.join(repo, 'dc_artifacts'), 'mine')
    await writeSystem(path.join(worktree, 'dc_artifacts'), 'sibling')
    await writeSystem(getGlobalArtifactsDir(), 'shared')
    await fs.mkdir(path.join(repo, 'dc_artifacts', 'systems', 'no-manifest'), { recursive: true })

    const { systems, current } = await service.listForWorkDir(repo)
    expect(systems.current.map(item => [item.name, item.workDir === null, item.manifest?.name])).toEqual([['mine', false, 'mine']])
    expect(systems.others.map(item => [item.name, item.workDir === null]).sort()).toEqual([['shared', true], ['sibling', false]])
    expect(current).toEqual([])
  })

  it('keeps a system with an invalid manifest in the list with its error', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    const dir = path.join(repo, 'dc_artifacts', 'systems', 'broken')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'system.json'), '{"version":1}')
    const { systems } = await service.listForWorkDir(repo)
    expect(systems.current[0]).toMatchObject({ name: 'broken', manifest: null })
    expect(systems.current[0]!.error).toContain('name is required')
  })
})

describe('POST /api/sessions/:id/workspace/artifacts/systems', () => {
  const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
  const appRootAtLoad = process.env.CLAUDE_APP_ROOT

  afterEach(() => {
    if (appRootAtLoad === undefined) delete process.env.CLAUDE_APP_ROOT
    else process.env.CLAUDE_APP_ROOT = appRootAtLoad
  })

  async function post(sessionId: string, body: unknown) {
    const url = new URL(`http://x/api/sessions/${sessionId}/workspace/artifacts/systems`)
    const response = await handleSessionsApi(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url, url.pathname.split('/').filter(Boolean))
    return { status: response.status, body: (await response.json()) as Record<string, any> }
  }

  async function withLibrary() {
    const resources = path.join(root, 'Resources')
    await fs.mkdir(path.join(resources, 'bin'), { recursive: true })
    process.env.CLAUDE_APP_ROOT = path.join(resources, 'bin')
    await writeSystems(path.join(resources, 'design-systems'), [systemRecord('alpha')])
  }

  it('copies a library system into the session working directory', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, SESSION_ID)
    await withLibrary()
    const { status, body } = await post(SESSION_ID, { systemId: 'alpha' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: 'alpha', dir: path.join(repo, 'dc_artifacts', 'systems', 'alpha'), reused: false })
    expect(await fs.readFile(path.join(body.dir, 'tokens.css'), 'utf-8')).toContain('--bg')
    expect((await post(SESSION_ID, { systemId: 'alpha' })).body.reused).toBe(true)
  })

  it('does not index the systems folder as an artifact of the session', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, SESSION_ID)
    await withLibrary()
    await post(SESSION_ID, { systemId: 'alpha' })
    const { current } = await service.listForWorkDir(repo)
    expect(current).toEqual([])
    expect(await fs.readFile(path.join(root, 'config', 'artifact-sessions.json'), 'utf-8').catch(() => '')).not.toContain('systems')
  })

  it('answers 400 for an unknown system and 404 for an unknown session', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, SESSION_ID)
    await withLibrary()
    expect((await post(SESSION_ID, { systemId: 'nope' })).status).toBe(400)
    expect((await post(SESSION_ID, {})).status).toBe(400)
    expect((await post('00000000-0000-4000-8000-0000000000ff', { systemId: 'alpha' })).status).toBe(404)
    expect(await fs.readdir(repo)).not.toContain('dc_artifacts')
  })
})

describe('ArtifactService.resolveOpen', () => {
  it('returns the artifacts directory as the protocol root and the entry file', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'a', page('A'), { 'index.html': 'x' })

    expect(await service.resolveOpen(path.join(repo, 'dc_artifacts'), 'a')).toEqual({
      rootDir: path.join(repo, 'dc_artifacts'),
      filePath: path.join(repo, 'dc_artifacts', 'a', 'index.html'),
    })
  })

  it('opens a global artifact through the marker or the real path', async () => {
    await writeArtifact(getGlobalArtifactsDir(), 'g', page('G'), { 'index.html': 'x' })
    const expected = { rootDir: getGlobalArtifactsDir(), filePath: path.join(getGlobalArtifactsDir(), 'g', 'index.html') }
    expect(await service.resolveOpen(GLOBAL_ARTIFACTS_MARKER, 'g')).toEqual(expected)
    expect(await service.resolveOpen(getGlobalArtifactsDir(), 'g')).toEqual(expected)
  })

  it('refuses a directory that no session or worktree knows', async () => {
    await writeArtifact(path.join(root, 'stranger', 'dc_artifacts'), 'a', page('A'), { 'index.html': 'x' })
    await expect(service.resolveOpen(path.join(root, 'stranger', 'dc_artifacts'), 'a')).rejects.toThrow('not a known artifacts directory')
  })

  it('refuses a directory that is not named dc_artifacts, a relative one and an unsafe name', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await expect(service.resolveOpen(repo, 'a')).rejects.toThrow('dc_artifacts directory')
    await expect(service.resolveOpen('dc_artifacts', 'a')).rejects.toThrow('dc_artifacts directory')
    await expect(service.resolveOpen(path.join(repo, 'dc_artifacts'), '../x')).rejects.toThrow('Invalid artifact name')
    await expect(service.resolveOpen(path.join(repo, 'dc_artifacts'), 'systems')).rejects.toThrow('Invalid artifact name')
  })

  it('refuses a broken manifest and a missing entry', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    const artifactsDir = path.join(repo, 'dc_artifacts')
    await writeArtifact(artifactsDir, 'noentry', page('N'))
    await fs.mkdir(path.join(artifactsDir, 'bad'), { recursive: true })
    await fs.writeFile(path.join(artifactsDir, 'bad', 'artifact.json'), '{')

    await expect(service.resolveOpen(artifactsDir, 'noentry')).rejects.toThrow('Entry file not found')
    await expect(service.resolveOpen(artifactsDir, 'bad')).rejects.toThrow('not valid JSON')
    await expect(service.resolveOpen(artifactsDir, 'missing')).rejects.toThrow('Artifact not found')
  })
})

describe('artifacts API', () => {
  it('serves the list and the open target and rejects other methods and missing parameters', async () => {
    await writeArtifact(getGlobalArtifactsDir(), 'g', page('G'), { 'index.html': 'x' })

    const list = await handleArtifactsApi(new Request('http://x/api/artifacts'), new URL('http://x/api/artifacts'), ['api', 'artifacts'])
    expect(list.status).toBe(200)
    expect(((await list.json()) as { artifacts: Array<{ name: string }> }).artifacts.map((item) => item.name)).toContain('g')

    const openUrl = new URL('http://x/api/artifacts/open?dir=global&name=g')
    const open = await handleArtifactsApi(new Request(openUrl), openUrl, ['api', 'artifacts', 'open'])
    expect(open.status).toBe(200)
    expect(((await open.json()) as { filePath: string }).filePath).toBe(path.join(getGlobalArtifactsDir(), 'g', 'index.html'))

    const byIdUrl = new URL('http://x/api/artifacts/open?id=id-G')
    const byId = await handleArtifactsApi(new Request(byIdUrl), byIdUrl, ['api', 'artifacts', 'open'])
    expect(((await byId.json()) as { filePath: string }).filePath).toBe(path.join(getGlobalArtifactsDir(), 'g', 'index.html'))

    const missingUrl = new URL('http://x/api/artifacts/open')
    expect((await handleArtifactsApi(new Request(missingUrl), missingUrl, ['api', 'artifacts', 'open'])).status).toBe(400)
    expect((await handleArtifactsApi(new Request('http://x/api/artifacts', { method: 'PUT' }), new URL('http://x/api/artifacts'), ['api', 'artifacts'])).status).toBe(405)
  })
})

describe('ArtifactService session marks, origins and turns', () => {
  async function repoWithSession() {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    return repo
  }

  it('marks the session that wrote an artifact through a tool', async () => {
    const repo = await repoWithSession()
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'report', page('Report'))
    await service.registerWrittenPath(path.join(repo, 'dc_artifacts', 'report', 'index.html'), 'session-1')

    const { current } = await service.listForWorkDir(repo)
    expect(current[0]!.sessions).toEqual([{ sessionId: 'session-1', source: 'tool' }])
  })

  it('marks a change made between the start and the end of a turn as a snapshot change', async () => {
    const repo = await repoWithSession()
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'report', page('Report'), { 'index.html': 'one' })
    await service.beginTurn('session-1', repo)
    await fs.writeFile(path.join(repo, 'dc_artifacts', 'report', 'index.html'), 'two!!')
    await service.endTurn('session-1', repo)

    const { current } = await service.listForWorkDir(repo)
    expect(current[0]!.sessions).toEqual([{ sessionId: 'session-1', source: 'snapshot' }])
  })

  it('does not mark an artifact the turn did not change and never downgrades a tool mark', async () => {
    const repo = await repoWithSession()
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'quiet', page('Quiet'), { 'index.html': 'one' })
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'loud', page('Loud'), { 'index.html': 'one' })
    await service.registerWrittenPath(path.join(repo, 'dc_artifacts', 'loud', 'index.html'), 'session-1')
    await service.beginTurn('session-1', repo)
    await fs.writeFile(path.join(repo, 'dc_artifacts', 'loud', 'index.html'), 'changed again')
    await service.endTurn('session-1', repo)

    const { current } = await service.listForWorkDir(repo)
    expect(current.find((item) => item.name === 'quiet')!.sessions).toEqual([])
    expect(current.find((item) => item.name === 'loud')!.sessions).toEqual([{ sessionId: 'session-1', source: 'tool' }])
  })

  it('marks both sessions when their turns overlap on the same folder', async () => {
    const repo = await repoWithSession()
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'shared', page('Shared'), { 'index.html': 'one' })
    await service.beginTurn('session-1', repo)
    await service.beginTurn('session-2', repo)
    await fs.writeFile(path.join(repo, 'dc_artifacts', 'shared', 'index.html'), 'changed')
    await service.endTurn('session-1', repo)
    await service.endTurn('session-2', repo)

    const { current } = await service.listForWorkDir(repo)
    expect(current[0]!.sessions.map((mark) => mark.sessionId).sort()).toEqual(['session-1', 'session-2'])
  })

  it('keeps the marks of an artifact that moved into the global store, reports where it came from and finds it by id', async () => {
    const repo = await repoWithSession()
    const dir = path.join(repo, 'dc_artifacts', 'report')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'report', page('Report'), { 'index.html': 'x' })
    await service.registerWrittenPath(path.join(dir, 'index.html'), 'session-1')
    await copyArtifactFolder({
      source: dir,
      destArtifactsDir: getGlobalArtifactsDir(),
      removeSource: true,
      origin: { workDir: repo, projectRoot: repo, branch: 'main' },
    })

    const moved = (await service.listGlobal()).find((item) => item.name === 'report')!
    expect(moved.sessions).toEqual([{ sessionId: 'session-1', source: 'tool' }])
    expect(moved.origin).toEqual({ workDir: repo, projectRoot: repo, branch: 'main' })
    expect(moved.id).toBe('id-Report')
    expect(await service.resolveOpenById('id-Report')).toEqual({
      rootDir: getGlobalArtifactsDir(),
      filePath: path.join(getGlobalArtifactsDir(), 'report', 'index.html'),
    })
  })

  it('marks an artifact written before its manifest existed once the manifest is there', async () => {
    const repo = await repoWithSession()
    await fs.mkdir(path.join(repo, 'dc_artifacts', 'late'), { recursive: true })
    await fs.writeFile(path.join(repo, 'dc_artifacts', 'late', 'index.html'), 'x')
    await service.registerWrittenPath(path.join(repo, 'dc_artifacts', 'late', 'index.html'), 'session-1')
    await fs.writeFile(path.join(repo, 'dc_artifacts', 'late', 'artifact.json'), JSON.stringify(page('Late')))
    await service.registerWrittenPath(path.join(repo, 'dc_artifacts', 'late', 'artifact.json'), 'session-1')

    const { current } = await service.listForWorkDir(repo)
    expect(current.find((item) => item.name === 'late')!.sessions).toEqual([{ sessionId: 'session-1', source: 'tool' }])
  })

  it('does not find an unknown id', async () => {
    await expect(service.resolveOpenById('nope')).rejects.toThrow('Artifact not found')
  })
})

describe('opened times and copying into a session', () => {
  async function post(resource: string, body: unknown) {
    const url = new URL(`http://x/api/artifacts/${resource}`)
    return handleArtifactsApi(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url, ['api', 'artifacts', resource])
  }

  it('records when an artifact was opened and reports it on the list, surviving a new service instance', async () => {
    await writeArtifact(getGlobalArtifactsDir(), 'g', page('G'), { 'index.html': 'x' })
    expect((await service.listGlobal())[0]!.lastOpenedAt).toBeNull()

    const before = Date.now()
    await service.markOpened('id-G')

    expect((await service.listGlobal())[0]!.lastOpenedAt).toBeGreaterThanOrEqual(before)
    expect((await new ArtifactService().listGlobal())[0]!.lastOpenedAt).toBeGreaterThanOrEqual(before)
  })

  it('serves the opened and copy endpoints and validates their bodies', async () => {
    expect((await post('opened', { id: 'id-G' })).status).toBe(200)
    expect((await post('opened', {})).status).toBe(400)
    expect((await post('copy', { id: 'id-G' })).status).toBe(400)
    expect((await post('copy', { id: 'id-G', sessionId: 'no-such-session' })).status).toBe(404)
    expect((await post('nope', {})).status).toBe(404)
  })

  it('moves an unbound artifact into the session folder and keeps its id', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await writeArtifact(getGlobalArtifactsDir(), 'g', page('G'), { 'index.html': 'kept' })

    const copied = await service.copyIntoWorkDir('id-G', repo)

    expect(copied).toEqual({ id: 'id-G', name: 'g', artifactsDir: path.join(repo, 'dc_artifacts'), dir: path.join(repo, 'dc_artifacts', 'g') })
    expect(await fs.readFile(path.join(repo, 'dc_artifacts', 'g', 'index.html'), 'utf-8')).toBe('kept')
    await expect(fs.stat(path.join(getGlobalArtifactsDir(), 'g'))).rejects.toThrow()
    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
  })

  it('copies an artifact of another project, keeps the original and gives the copy a new id', async () => {
    const repo = await makeRepo('repo')
    const other = await makeRepo('other')
    await writeSession(repo, 'session-1')
    await writeSession(other, 'session-2')
    await writeArtifact(path.join(other, 'dc_artifacts'), 'report', page('Report'), { 'index.html': 'x' })

    const copied = await service.copyIntoWorkDir('id-Report', repo)

    expect(copied.id).not.toBe('id-Report')
    expect(await fs.readFile(path.join(other, 'dc_artifacts', 'report', 'index.html'), 'utf-8')).toBe('x')
    expect(JSON.parse(await fs.readFile(path.join(repo, 'dc_artifacts', 'report', 'artifact.json'), 'utf-8')).id).toBe(copied.id)
    expect((await service.listAll()).filter((item) => item.name === 'report')).toHaveLength(2)
  })

  it('returns an artifact that is already in the session folder as it is', async () => {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    await writeArtifact(path.join(repo, 'dc_artifacts'), 'mine', page('Mine'))
    expect(await service.copyIntoWorkDir('id-Mine', repo)).toMatchObject({ id: 'id-Mine', name: 'mine' })
  })

  it('refuses an unknown artifact', async () => {
    const repo = await makeRepo('repo')
    await expect(service.copyIntoWorkDir('nope', repo)).rejects.toThrow('Artifact not found')
  })
})

describe('artifact thumbnails', () => {
  const jpeg = (size = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size)])

  async function putThumbnail(body: Record<string, unknown>) {
    const url = new URL('http://x/api/artifacts/thumbnail')
    return handleArtifactsApi(new Request(url, { method: 'PUT', body: JSON.stringify(body) }), url, ['api', 'artifacts', 'thumbnail'])
  }

  async function getThumbnail(id: string) {
    const url = new URL(`http://x/api/artifacts/thumbnail?id=${encodeURIComponent(id)}`)
    return handleArtifactsApi(new Request(url), url, ['api', 'artifacts', 'thumbnail'])
  }

  it('stores a thumbnail under the artifact id and serves it back as a JPEG', async () => {
    const image = jpeg()
    expect((await putThumbnail({ id: 'id-G', mtimeMs: 42, data: image.toString('base64') })).status).toBe(200)

    const response = await getThumbnail('id-G')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(Buffer.from(await response.arrayBuffer()).equals(image)).toBe(true)
  })

  it('reports the thumbnail time on the list item, also after the artifact moved', async () => {
    await writeArtifact(getGlobalArtifactsDir(), 'g', page('G'), { 'index.html': 'x' })
    expect((await service.listGlobal())[0]!.thumbnailMtimeMs).toBeNull()

    await putThumbnail({ id: 'id-G', mtimeMs: 77, data: jpeg().toString('base64') })

    expect((await service.listGlobal())[0]!.thumbnailMtimeMs).toBe(77)
  })

  it('replaces an older thumbnail', async () => {
    await putThumbnail({ id: 'id-G', mtimeMs: 1, data: jpeg(10).toString('base64') })
    const newer = jpeg(20)
    await putThumbnail({ id: 'id-G', mtimeMs: 2, data: newer.toString('base64') })
    expect(Buffer.from(await (await getThumbnail('id-G')).arrayBuffer()).equals(newer)).toBe(true)
  })

  it('refuses an image that is not a JPEG, is empty or too large, and bad parameters', async () => {
    expect((await putThumbnail({ id: 'id-G', mtimeMs: 1, data: Buffer.from('not an image').toString('base64') })).status).toBe(400)
    expect((await putThumbnail({ id: 'id-G', mtimeMs: 1, data: jpeg(300 * 1024).toString('base64') })).status).toBe(400)
    expect((await putThumbnail({ id: 'id-G', mtimeMs: 'x', data: jpeg().toString('base64') })).status).toBe(400)
    expect((await putThumbnail({ mtimeMs: 1, data: jpeg().toString('base64') })).status).toBe(400)
    expect((await getThumbnail('id-G')).status).toBe(404)
  })

  it('answers 404 for an artifact that has no thumbnail and 400 without an id', async () => {
    expect((await getThumbnail('nobody')).status).toBe(404)
    const url = new URL('http://x/api/artifacts/thumbnail')
    expect((await handleArtifactsApi(new Request(url), url, ['api', 'artifacts', 'thumbnail'])).status).toBe(400)
  })

  it('keeps ids with odd characters apart', async () => {
    await putThumbnail({ id: '../a', mtimeMs: 1, data: jpeg(10).toString('base64') })
    await putThumbnail({ id: 'a', mtimeMs: 2, data: jpeg(20).toString('base64') })
    expect((await (await getThumbnail('../a')).arrayBuffer()).byteLength).toBe(14)
    expect((await (await getThumbnail('a')).arrayBuffer()).byteLength).toBe(24)
  })
})

describe('canvas artifacts', () => {
  const canvas = (extra: Record<string, unknown> = {}) => ({
    version: 1,
    id: 'id-canvas',
    kind: 'canvas',
    title: 'Canvas',
    entry: 'index.html',
    boards: [
      { id: 'home', file: 'home.html', title: 'Home', x: 0, y: 0, width: 400, height: 300 },
      { id: 'detail', file: 'detail.html', x: 500, y: 0, width: 400, height: 300 },
    ],
    ...extra,
  })

  async function setup() {
    const repo = await makeRepo('repo')
    await writeSession(repo, 'session-1')
    const artifactsDir = path.join(repo, 'dc_artifacts')
    await writeArtifact(artifactsDir, 'flow', canvas(), { 'index.html': CANVAS_ENTRY_HTML, 'home.html': '<p>h</p>', 'detail.html': '<p>d</p>' })
    return { repo, artifactsDir }
  }

  async function patch(body: unknown) {
    const url = new URL('http://x/api/artifacts/boards')
    const response = await handleArtifactsApi(new Request(url, { method: 'PATCH', body: JSON.stringify(body) }), url, ['api', 'artifacts', 'boards'])
    return { status: response.status, body: (await response.json()) as Record<string, any> }
  }

  it('opens a canvas through its entry file like any other artifact', async () => {
    const { artifactsDir } = await setup()
    expect(await service.resolveOpen(artifactsDir, 'flow')).toEqual({ rootDir: artifactsDir, filePath: path.join(artifactsDir, 'flow', 'index.html') })
    const item = (await service.listAll()).find(candidate => candidate.name === 'flow')!
    expect(item.entryMissing).toBe(false)
    expect(item.error).toBeNull()
  })

  it('resolves the file of one board for opening it in its own tab', async () => {
    const { artifactsDir } = await setup()
    expect(await service.resolveOpen(artifactsDir, 'flow', 'detail')).toEqual({ rootDir: artifactsDir, filePath: path.join(artifactsDir, 'flow', 'detail.html') })
    await expect(service.resolveOpen(artifactsDir, 'flow', 'nope')).rejects.toThrow('Board not found')
    await writeArtifact(artifactsDir, 'plain', page('Plain'), { 'index.html': 'x' })
    await expect(service.resolveOpen(artifactsDir, 'plain', 'home')).rejects.toThrow('not a canvas')
  })

  it('does not open a board whose file is missing, leaves the folder or is not a plain relative path', async () => {
    const { artifactsDir } = await setup()
    await fs.writeFile(path.join(root, 'secret.html'), 'x')
    await fs.symlink(path.join(root, 'secret.html'), path.join(artifactsDir, 'flow', 'link.html'))
    await writeArtifact(artifactsDir, 'bad', canvas({
      id: 'id-bad',
      boards: [
        { id: 'abs', file: '/etc/hosts', x: 0, y: 0, width: 1, height: 1 },
        { id: 'up', file: '../flow/home.html', x: 0, y: 0, width: 1, height: 1 },
        { id: 'gone', file: 'gone.html', x: 0, y: 0, width: 1, height: 1 },
        { id: 'link', file: 'link.html', x: 0, y: 0, width: 1, height: 1 },
      ],
    }), { 'index.html': CANVAS_ENTRY_HTML })
    await fs.symlink(path.join(root, 'secret.html'), path.join(artifactsDir, 'bad', 'link.html'))
    await expect(service.resolveOpen(artifactsDir, 'bad', 'abs')).rejects.toThrow('not allowed')
    await expect(service.resolveOpen(artifactsDir, 'bad', 'up')).rejects.toThrow('not allowed')
    await expect(service.resolveOpen(artifactsDir, 'bad', 'gone')).rejects.toThrow('not found')
    await expect(service.resolveOpen(artifactsDir, 'bad', 'link')).rejects.toThrow('not found')
  })

  it('writes a board position and changes nothing else in the manifest', async () => {
    const { artifactsDir } = await setup()
    const before = JSON.parse(await fs.readFile(path.join(artifactsDir, 'flow', 'artifact.json'), 'utf-8'))
    const result = await service.updateBoard(artifactsDir, 'flow', 'detail', { x: 10.5, y: -20, width: 640, height: 480 })
    const after = JSON.parse(await fs.readFile(path.join(artifactsDir, 'flow', 'artifact.json'), 'utf-8'))
    expect(after.boards[1]).toEqual({ id: 'detail', file: 'detail.html', x: 10.5, y: -20, width: 640, height: 480 })
    expect(after.boards[0]).toEqual(before.boards[0])
    expect({ ...after, boards: undefined }).toEqual({ ...before, boards: undefined })
    const entry = (await service.listAll()).find(candidate => candidate.name === 'flow')!
    expect(result.latestMtimeMs).toBe(entry.latestMtimeMs)
    expect((await fs.readdir(path.join(artifactsDir, 'flow'))).filter(file => file.endsWith('.tmp'))).toEqual([])
  })

  it('refuses an unknown board, a page artifact and a folder that is not a known artifacts directory', async () => {
    const { repo, artifactsDir } = await setup()
    await writeArtifact(artifactsDir, 'plain', page('Plain'), { 'index.html': 'x' })
    const rect = { x: 0, y: 0, width: 1, height: 1 }
    await expect(service.updateBoard(artifactsDir, 'flow', 'nope', rect)).rejects.toThrow('Board not found')
    await expect(service.updateBoard(artifactsDir, 'plain', 'home', rect)).rejects.toThrow('not a canvas')
    await expect(service.updateBoard(artifactsDir, '../x', 'home', rect)).rejects.toThrow('Invalid artifact name')
    await expect(service.updateBoard(path.join(root, 'elsewhere', 'dc_artifacts'), 'flow', 'home', rect)).rejects.toThrow('known artifacts directory')
    expect(JSON.parse(await fs.readFile(path.join(repo, 'dc_artifacts', 'flow', 'artifact.json'), 'utf-8')).boards[0].x).toBe(0)
  })

  it('serves the board write over PATCH and validates the body', async () => {
    const { artifactsDir } = await setup()
    const ok = await patch({ dir: artifactsDir, name: 'flow', boardId: 'home', x: 1, y: 2, width: 3, height: 4 })
    expect(ok.status).toBe(200)
    expect(typeof ok.body.latestMtimeMs).toBe('number')
    expect((await patch({ dir: artifactsDir, name: 'flow', boardId: 'home', x: 'a', y: 2, width: 3, height: 4 })).status).toBe(400)
    expect((await patch({ dir: artifactsDir, name: 'flow', boardId: 'home', x: 1, y: 2, width: 0, height: 4 })).status).toBe(400)
    expect((await patch({ dir: artifactsDir, name: 'flow', x: 1, y: 2, width: 3, height: 4 })).status).toBe(400)
    expect((await patch({ dir: artifactsDir, name: 'flow', boardId: 'zzz', x: 1, y: 2, width: 3, height: 4 })).status).toBe(404)
  })
})

