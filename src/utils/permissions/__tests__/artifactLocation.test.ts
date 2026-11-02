import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

Object.assign(globalThis, { MACRO: (globalThis as { MACRO?: unknown }).MACRO ?? { VERSION: 'test' } })
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, setOriginalCwd } from '../../../bootstrap/state.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { FileEditTool } from '../../../tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '../../../tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../../tools/FileWriteTool/FileWriteTool.js'
import { getGlobalArtifactsDir } from '../../artifacts.js'
import { runWithCwdOverride } from '../../cwd.js'
import { checkReadPermissionForTool, checkWritePermissionForTool, toPosixPath } from '../filesystem.js'
import { isPathAllowed } from '../pathValidation.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
const originalCwd = getOriginalCwd()
let root: string
let project: string
let otherProject: string
let worktree: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'artifact-location-')))
  process.env.DREAMCODER_CONFIG_DIR = join(root, 'config')
  project = join(root, 'project')
  otherProject = join(root, 'other')
  worktree = join(root, 'worktree')
  for (const dir of [project, otherProject, worktree, getGlobalArtifactsDir()]) {
    await mkdir(dir, { recursive: true })
  }
  setOriginalCwd(project)
})

afterEach(async () => {
  setOriginalCwd(originalCwd)
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await rm(root, { recursive: true, force: true })
})

const write = (file: string, mode: 'default' | 'plan' | 'acceptEdits' = 'default') =>
  checkWritePermissionForTool(FileWriteTool, { file_path: file, content: 'x' }, { ...getEmptyToolPermissionContext(), mode })

const edit = (file: string) =>
  checkWritePermissionForTool(FileEditTool, { file_path: file, old_string: 'a', new_string: 'b' }, getEmptyToolPermissionContext())

const read = (file: string) => checkReadPermissionForTool(FileReadTool, { file_path: file }, getEmptyToolPermissionContext())

describe('writing artifacts', () => {
  test('allows Write and Edit inside the work root dc_artifacts without asking', () => {
    expect(write(join(project, 'dc_artifacts', 'a', 'index.html')).behavior).toBe('allow')
    expect(edit(join(project, 'dc_artifacts', 'a', 'index.html')).behavior).toBe('allow')
  })

  test('denies a dc_artifacts folder of another project, another worktree and the global store', () => {
    for (const file of [
      join(otherProject, 'dc_artifacts', 'a', 'index.html'),
      join(worktree, 'dc_artifacts', 'a', 'index.html'),
      join(getGlobalArtifactsDir(), 'a', 'index.html'),
    ]) {
      const result = write(file)
      expect(result.behavior).toBe('deny')
      expect(result.message).toContain('read-only')
      expect(result.message).toContain('ArtifactCopy')
      expect(edit(file).behavior).toBe('deny')
    }
  })

  test('denies the foreign folder in acceptEdits mode as well', () => {
    expect(write(join(otherProject, 'dc_artifacts', 'a', 'x.html'), 'acceptEdits').behavior).toBe('deny')
  })

  test('treats the own artifacts folder as own when the path differs only in letter case', () => {
    expect(write(join(project.toUpperCase(), 'dc_artifacts', 'a', 'index.html')).behavior).toBe('allow')
  })

  test('does not allow silently in plan mode', () => {
    expect(write(join(project, 'dc_artifacts', 'a', 'index.html'), 'plan').behavior).not.toBe('allow')
  })

  test('still asks for protected file names inside an artifact', () => {
    expect(write(join(project, 'dc_artifacts', 'a', '.git', 'config')).behavior).toBe('ask')
  })

  test('does not treat a similarly named folder as an artifact folder', () => {
    expect(write(join(project, 'my_dc_artifacts', 'a.html')).behavior).not.toBe('deny')
  })

  test('follows the sub-agent work root instead of the session directory', () => {
    runWithCwdOverride(worktree, () => {
      expect(write(join(worktree, 'dc_artifacts', 'a', 'index.html')).behavior).toBe('allow')
      expect(write(join(project, 'dc_artifacts', 'a', 'index.html')).behavior).toBe('deny')
    })
  })

  test('uses the real path: a symlinked artifacts folder pointing at another project is denied', async () => {
    const { symlink } = await import('node:fs/promises')
    await mkdir(join(otherProject, 'dc_artifacts', 'a'), { recursive: true })
    await symlink(join(otherProject, 'dc_artifacts'), join(project, 'dc_artifacts'))
    expect(write(join(project, 'dc_artifacts', 'a', 'index.html')).behavior).toBe('deny')
  })

  test('user deny rules still win over the allow', () => {
    const context = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { userSettings: [`Edit(/${toPosixPath(join(project, 'dc_artifacts'))}/**)`] },
    }
    const result = checkWritePermissionForTool(FileWriteTool, { file_path: join(project, 'dc_artifacts', 'a', 'x.html'), content: 'x' }, context)
    expect(result.behavior).toBe('deny')
  })
})

describe('reading artifacts', () => {
  test('reads any dc_artifacts folder without asking, including another project and the global store', () => {
    for (const file of [
      join(project, 'dc_artifacts', 'a', 'index.html'),
      join(otherProject, 'dc_artifacts', 'a', 'index.html'),
      join(getGlobalArtifactsDir(), 'a', 'index.html'),
    ]) {
      expect(read(file).behavior).toBe('allow')
    }
  })

  test('asks when dc_artifacts is a link to a folder outside the artifact folders', async () => {
    const secrets = join(root, 'secrets')
    await mkdir(secrets, { recursive: true })
    await writeFile(join(secrets, 'secret.txt'), 'x')
    await symlink(secrets, join(project, 'dc_artifacts'))
    expect(read(join(project, 'dc_artifacts', 'secret.txt')).behavior).toBe('ask')
  })

  test('still asks for ordinary files outside the working directories', () => {
    expect(read(join(otherProject, 'src', 'a.ts')).behavior).toBe('ask')
  })
})

describe('Bash path validation', () => {
  const check = (file: string, operation: 'read' | 'write' | 'create') => isPathAllowed(file, getEmptyToolPermissionContext(), operation)

  test('allows writes in the work root artifacts and refuses other artifact folders with a hard denial', () => {
    expect(check(join(project, 'dc_artifacts', 'a', 'x.html'), 'create').allowed).toBe(true)
    const foreign = check(join(otherProject, 'dc_artifacts', 'a', 'x.html'), 'write')
    expect(foreign.allowed).toBe(false)
    expect(foreign.decisionReason).toMatchObject({ type: 'other', hardDeny: true })
  })

  test('reads other artifact folders', () => {
    expect(check(join(otherProject, 'dc_artifacts', 'a', 'x.html'), 'read').allowed).toBe(true)
  })
})
