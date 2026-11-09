import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { resolveProjectRoot } from './projectRoot.js'

describe('resolveProjectRoot', () => {
  let base: string
  let repo: string
  let worktree: string

  beforeAll(async () => {
    base = await realpath(await mkdtemp(path.join(tmpdir(), 'project-root-')))
    repo = path.join(base, 'repo')
    worktree = path.join(repo, '.claude', 'worktrees', 'feature')
    const worktreeGitDir = path.join(repo, '.git', 'worktrees', 'feature')
    await mkdir(worktreeGitDir, { recursive: true })
    await mkdir(path.join(worktree, 'src'), { recursive: true })
    await writeFile(path.join(worktree, '.git'), `gitdir: ${worktreeGitDir}\n`)
    await writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n')
    await writeFile(path.join(worktreeGitDir, 'gitdir'), `${path.join(worktree, '.git')}\n`)
  })

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  test('a repository resolves to itself', async () => {
    expect(await resolveProjectRoot(repo)).toBe(repo)
  })

  test('a worktree and its subdirectories resolve to the main repository', async () => {
    expect(await resolveProjectRoot(worktree)).toBe(repo)
    expect(await resolveProjectRoot(path.join(worktree, 'src'))).toBe(repo)
  })

  test('a directory under .claude/worktrees outside git resolves to the directory above it', async () => {
    const plain = path.join(base, 'plain')
    const inside = path.join(plain, '.claude', 'worktrees', 'task', 'nested')
    await mkdir(inside, { recursive: true })
    expect(await resolveProjectRoot(inside)).toBe(plain)
  })

  test('a missing path is returned as given', async () => {
    const missing = path.join(base, 'missing', 'dir')
    expect(await resolveProjectRoot(missing)).toBe(missing)
  })
})
