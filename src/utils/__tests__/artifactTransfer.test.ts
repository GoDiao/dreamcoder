import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyArtifactFolder, moveArtifactsToGlobalStore } from '../artifactTransfer.js'
import { checkArtifact } from '../artifactCheck.js'
import { getGlobalArtifactsDir, readArtifactEntry } from '../artifacts.js'
import { preserveWorktreeArtifacts, removeAgentWorktree, type MovedArtifact } from '../worktree.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
let root: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'artifact-transfer-')))
  process.env.DREAMCODER_CONFIG_DIR = join(root, 'config')
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await rm(root, { recursive: true, force: true })
})

async function artifact(artifactsDir: string, name: string, files: Record<string, string> = { 'index.html': '<p>hi</p>' }, id = `id-${name}`) {
  const dir = join(artifactsDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'artifact.json'), JSON.stringify({ version: 1, id, kind: 'page', title: name, entry: 'index.html' }))
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true })
    await writeFile(join(dir, file), content)
  }
  return dir
}

async function artifactWithSystem(artifactsDir: string, name: string) {
  const dir = join(artifactsDir, name)
  await mkdir(join(artifactsDir, 'systems', 'alpha'), { recursive: true })
  await mkdir(dir, { recursive: true })
  await writeFile(join(artifactsDir, 'systems', 'alpha', 'system.json'), '{}')
  await writeFile(join(artifactsDir, 'systems', 'alpha', 'DESIGN.md'), '# alpha')
  await writeFile(join(artifactsDir, 'systems', 'alpha', 'tokens.css'), ':root{--a:1}')
  await writeFile(join(dir, 'artifact.json'), JSON.stringify({ version: 1, id: `id-${name}`, kind: 'page', title: name, entry: 'index.html', designSystem: 'systems/alpha' }))
  await writeFile(join(dir, 'index.html'), '<link rel="stylesheet" href="../systems/alpha/tokens.css">')
  return dir
}

const exists = (path: string) => stat(path).then(() => true, () => false)
const idOf = async (dir: string) => JSON.parse(await readFile(join(dir, 'artifact.json'), 'utf-8')).id as string

describe('copyArtifactFolder', () => {
  test('copies the whole folder, keeps the source and gives the copy a new id', async () => {
    const source = await artifact(join(root, 'a', 'dc_artifacts'), 'report', { 'index.html': 'x', 'img/logo.png': 'png' })
    const copied = await copyArtifactFolder({ source, destArtifactsDir: join(root, 'b', 'dc_artifacts'), removeSource: false })

    expect(copied).toEqual({ name: 'report', dir: join(root, 'b', 'dc_artifacts', 'report') })
    expect(await readFile(join(copied.dir, 'img', 'logo.png'), 'utf-8')).toBe('png')
    expect(await exists(source)).toBe(true)
    expect(await idOf(source)).toBe('id-report')
    const copyId = await idOf(copied.dir)
    expect(copyId).not.toBe('id-report')
    expect(copyId.length).toBeGreaterThan(8)
    expect((await readArtifactEntry(join(root, 'b', 'dc_artifacts'), 'report'))!.manifest?.title).toBe('report')
  })

  test('keeps the id when the source is removed, so the artifact is the same one in a new place', async () => {
    const source = await artifact(join(root, 'a', 'dc_artifacts'), 'report')
    const copied = await copyArtifactFolder({ source, destArtifactsDir: join(root, 'b', 'dc_artifacts'), removeSource: true })
    expect(await exists(source)).toBe(false)
    expect(await idOf(copied.dir)).toBe('id-report')
  })

  test('adds a number to the name when it is taken', async () => {
    const source = await artifact(join(root, 'a', 'dc_artifacts'), 'report')
    const dest = join(root, 'b', 'dc_artifacts')
    await artifact(dest, 'report')
    await artifact(dest, 'report-2')
    expect((await copyArtifactFolder({ source, destArtifactsDir: dest, removeSource: false })).name).toBe('report-3')
  })

  test('writes the origin when one is given and leaves it out of a copy into a project', async () => {
    const source = await artifact(join(root, 'a', 'dc_artifacts'), 'report')
    const inGlobal = await copyArtifactFolder({
      source,
      destArtifactsDir: getGlobalArtifactsDir(),
      removeSource: true,
      origin: { workDir: '/wt', projectRoot: '/repo', branch: 'feature' },
    })
    expect((await readArtifactEntry(getGlobalArtifactsDir(), inGlobal.name))!.origin).toEqual({ workDir: '/wt', projectRoot: '/repo', branch: 'feature' })

    const backInProject = await copyArtifactFolder({ source: inGlobal.dir, destArtifactsDir: join(root, 'b', 'dc_artifacts'), removeSource: true })
    expect(await exists(join(backInProject.dir, '.origin.json'))).toBe(false)
    expect(await idOf(backInProject.dir)).toBe('id-report')
  })

  test('refuses a missing source, an unsafe name and a copy into the same artifacts folder', async () => {
    const dest = join(root, 'b', 'dc_artifacts')
    await expect(copyArtifactFolder({ source: join(root, 'a', 'dc_artifacts', 'gone'), destArtifactsDir: dest, removeSource: false })).rejects.toThrow('not found')
    await expect(copyArtifactFolder({ source: join(root, 'a', 'dc_artifacts', 'systems'), destArtifactsDir: dest, removeSource: false })).rejects.toThrow('not an artifact name')
    const inside = await artifact(dest, 'here')
    await expect(copyArtifactFolder({ source: inside, destArtifactsDir: dest, removeSource: false })).rejects.toThrow('already in this directory')
  })
})

describe('design system of a copied artifact', () => {
  test('is carried into the destination and stays in the source when only copying', async () => {
    const sourceDir = join(root, 'a', 'dc_artifacts')
    const source = await artifactWithSystem(sourceDir, 'report')
    const copied = await copyArtifactFolder({ source, destArtifactsDir: join(root, 'b', 'dc_artifacts'), removeSource: false })

    expect(await exists(join(root, 'b', 'dc_artifacts', 'systems', 'alpha', 'tokens.css'))).toBe(true)
    expect(await exists(join(sourceDir, 'systems', 'alpha', 'tokens.css'))).toBe(true)
    expect(await checkArtifact(copied.dir)).toEqual([])
  })

  test('is carried into the global store when a worktree artifact is moved, and an existing system is kept', async () => {
    const workDir = join(root, 'wt')
    await artifactWithSystem(join(workDir, 'dc_artifacts'), 'report')
    await mkdir(join(getGlobalArtifactsDir(), 'systems', 'alpha'), { recursive: true })
    await writeFile(join(getGlobalArtifactsDir(), 'systems', 'alpha', 'DESIGN.md'), '# mine')

    await moveArtifactsToGlobalStore(workDir, { projectRoot: null, branch: null })

    expect(await exists(join(getGlobalArtifactsDir(), 'systems', 'alpha', 'tokens.css'))).toBe(true)
    expect(await readFile(join(getGlobalArtifactsDir(), 'systems', 'alpha', 'DESIGN.md'), 'utf-8')).toBe('# mine')
    expect(await checkArtifact(join(getGlobalArtifactsDir(), 'report'))).toEqual([])
  })
})

describe('moveArtifactsToGlobalStore', () => {
  test('moves every artifact folder into the global store with its id and origin', async () => {
    const workDir = join(root, 'wt')
    await artifact(join(workDir, 'dc_artifacts'), 'one')
    await artifact(join(workDir, 'dc_artifacts'), 'two')
    await artifact(getGlobalArtifactsDir(), 'one', undefined, 'other-id')

    const moved = await moveArtifactsToGlobalStore(workDir, { projectRoot: join(root, 'proj'), branch: 'b' })

    expect(moved.map(item => item.name).sort()).toEqual(['one-2', 'two'])
    expect(await exists(join(workDir, 'dc_artifacts', 'one'))).toBe(false)
    expect(await idOf(join(getGlobalArtifactsDir(), 'one-2'))).toBe('id-one')
    expect((await readArtifactEntry(getGlobalArtifactsDir(), 'two'))!.origin).toEqual({ workDir, projectRoot: join(root, 'proj'), branch: 'b' })
  })

  test('does nothing for a directory without artifacts', async () => {
    expect(await moveArtifactsToGlobalStore(join(root, 'empty'), { projectRoot: null, branch: null })).toEqual([])
  })
})

describe('worktree deletion keeps artifacts', () => {
  async function repoWithWorktree() {
    const repo = join(root, 'repo')
    await mkdir(repo, { recursive: true })
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'a@example.com')
    git(repo, 'config', 'user.name', 'A')
    await writeFile(join(repo, 'README.md'), 'x')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'init')
    const worktree = join(root, 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'worktree-agent-a1234567', worktree)
    return { repo: await realpath(repo), worktree: await realpath(worktree) }
  }

  test('preserveWorktreeArtifacts records the project and branch with the moved artifact', async () => {
    const { repo, worktree } = await repoWithWorktree()
    await artifact(join(worktree, 'dc_artifacts'), 'made-by-agent')

    const moved = await preserveWorktreeArtifacts(worktree)

    expect(moved).toHaveLength(1)
    expect((await readArtifactEntry(getGlobalArtifactsDir(), 'made-by-agent'))!.origin).toEqual({ workDir: worktree, projectRoot: repo, branch: 'worktree-agent-a1234567' })
  })

  test('removeAgentWorktree moves the artifacts first, reports them and then removes the worktree', async () => {
    const { repo, worktree } = await repoWithWorktree()
    await artifact(join(worktree, 'dc_artifacts'), 'made-by-agent')
    const moved: MovedArtifact[] = []

    expect(await removeAgentWorktree(worktree, 'worktree-agent-a1234567', repo, undefined, moved)).toBe(true)

    expect(moved).toEqual([{ name: 'made-by-agent', dir: join(getGlobalArtifactsDir(), 'made-by-agent') }])
    expect(await exists(worktree)).toBe(false)
    expect(await idOf(join(getGlobalArtifactsDir(), 'made-by-agent'))).toBe('id-made-by-agent')
  })

  test('keeps the worktree and its artifacts when they cannot be moved', async () => {
    const { repo, worktree } = await repoWithWorktree()
    await artifact(join(worktree, 'dc_artifacts'), 'made-by-agent')
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'config', 'artifacts-global'), 'not a directory')

    expect(await removeAgentWorktree(worktree, 'worktree-agent-a1234567', repo)).toBe(false)

    expect(await exists(join(worktree, 'dc_artifacts', 'made-by-agent', 'index.html'))).toBe(true)
  })

  test('removes a worktree without artifacts as before', async () => {
    const { repo, worktree } = await repoWithWorktree()
    const moved: MovedArtifact[] = []
    expect(await removeAgentWorktree(worktree, 'worktree-agent-a1234567', repo, undefined, moved)).toBe(true)
    expect(moved).toEqual([])
    expect(await exists(worktree)).toBe(false)
  })
})
