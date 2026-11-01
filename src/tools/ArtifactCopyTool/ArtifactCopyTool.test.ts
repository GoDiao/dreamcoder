import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import { getGlobalArtifactsDir } from '../../utils/artifacts.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { drainSdkEvents } from '../../utils/sdkEventQueue.js'
import { ARTIFACT_COPY_TOOL_NAME } from './constants.js'
import { ArtifactCopyTool } from './ArtifactCopyTool.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
const originalCwd = getOriginalCwd()
let root: string
let project: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'artifact-copy-')))
  process.env.DREAMCODER_CONFIG_DIR = join(root, 'config')
  project = join(root, 'project')
  await mkdir(project, { recursive: true })
  setOriginalCwd(project)
})

afterEach(async () => {
  setOriginalCwd(originalCwd)
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await rm(root, { recursive: true, force: true })
})

async function artifact(artifactsDir: string, name: string) {
  const dir = join(artifactsDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'artifact.json'), JSON.stringify({ version: 1, id: `id-${name}`, kind: 'page', title: name, entry: 'index.html' }))
  await writeFile(join(dir, 'index.html'), '<p>hi</p>')
  return dir
}

const exists = (path: string) => stat(path).then(() => true, () => false)
const validate = (path: string) => ArtifactCopyTool.validateInput!({ path }, {} as never)
const permission = (path: string) => ArtifactCopyTool.checkPermissions({ path }, {} as never)

describe('ArtifactCopy validation and permission', () => {
  test('rejects a path that is not an artifact folder', async () => {
    expect((await validate(join(project, 'src'))).result).toBe(false)
    expect((await validate(join(project, 'dc_artifacts', 'a', 'index.html'))).result).toBe(false)
  })

  test('rejects an artifact that is already in the working directory', async () => {
    const own = await artifact(join(project, 'dc_artifacts'), 'mine')
    const result = await validate(own)
    expect(result.result).toBe(false)
    expect(result.result === false && result.message).toContain('already in this directory')
  })

  test('says the artifact was moved or deleted when its folder is gone', async () => {
    const result = await validate(join(root, 'wt', 'dc_artifacts', 'gone'))
    expect(result.result).toBe(false)
    expect(result.result === false && result.message).toContain('moved or deleted')
  })

  test('always asks the user first', async () => {
    const foreign = await artifact(join(root, 'other', 'dc_artifacts'), 'a')
    expect((await permission(foreign)).behavior).toBe('ask')
  })
})

describe('ArtifactCopy call', () => {
  test('copies an artifact of another project and leaves the original', async () => {
    const foreign = await artifact(join(root, 'other', 'dc_artifacts'), 'a')
    const { data } = await ArtifactCopyTool.call({ path: foreign }, {} as never, undefined as never, undefined as never)
    expect(data).toEqual({ name: 'a', path: join(project, 'dc_artifacts', 'a'), movedFromGlobalStore: false })
    expect(await exists(join(foreign, 'index.html'))).toBe(true)
    expect(await exists(join(project, 'dc_artifacts', 'a', 'index.html'))).toBe(true)
    const copiedId = JSON.parse(await readFile(join(project, 'dc_artifacts', 'a', 'artifact.json'), 'utf-8')).id
    expect(copiedId).not.toBe('id-a')
  })

  test('tells the sidecar the copy was written, so the lists refresh at once', async () => {
    const foreign = await artifact(join(root, 'other', 'dc_artifacts'), 'a')
    drainSdkEvents()
    await ArtifactCopyTool.call({ path: foreign }, {} as never, undefined as never, undefined as never)
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      subtype: 'artifact_written',
      path: join(project, 'dc_artifacts', 'a', 'artifact.json'),
      tool_name: ARTIFACT_COPY_TOOL_NAME,
    })
  })

  test('moves an artifact out of the global store', async () => {
    const global = await artifact(getGlobalArtifactsDir(), 'g')
    const { data } = await ArtifactCopyTool.call({ path: global }, {} as never, undefined as never, undefined as never)
    expect(data.movedFromGlobalStore).toBe(true)
    expect(await exists(global)).toBe(false)
    expect(await exists(join(project, 'dc_artifacts', 'g', 'index.html'))).toBe(true)
    expect(JSON.parse(await readFile(join(project, 'dc_artifacts', 'g', 'artifact.json'), 'utf-8')).id).toBe('id-g')
  })

  test('copies into the sub-agent work root rather than the session directory', async () => {
    const worktree = join(root, 'worktree')
    await mkdir(worktree, { recursive: true })
    const foreign = await artifact(join(root, 'other', 'dc_artifacts'), 'a')
    await runWithCwdOverride(worktree, () => ArtifactCopyTool.call({ path: foreign }, {} as never, undefined as never, undefined as never))
    expect(await exists(join(worktree, 'dc_artifacts', 'a', 'index.html'))).toBe(true)
    expect(await exists(join(project, 'dc_artifacts', 'a'))).toBe(false)
  })

  test('adds a number to the name when it is taken', async () => {
    await artifact(join(project, 'dc_artifacts'), 'a')
    const foreign = await artifact(join(root, 'other', 'dc_artifacts'), 'a')
    const { data } = await ArtifactCopyTool.call({ path: foreign }, {} as never, undefined as never, undefined as never)
    expect(data.name).toBe('a-2')
  })
})
