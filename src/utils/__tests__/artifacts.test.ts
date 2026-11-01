import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  latestMtimeMs,
  artifactIdentity,
  artifactNameOf,
  artifactsDirOf,
  getGlobalArtifactsDir,
  hasArtifactsSegment,
  isGlobalArtifactsPath,
  isSafeArtifactName,
  parseArtifactManifest,
  readArtifactEntry,
  resolveArtifactEntryFile,
  scanArtifactsDir,
} from '../artifacts.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'artifacts-util-'))
  process.env.DREAMCODER_CONFIG_DIR = join(root, 'config')
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await rm(root, { recursive: true, force: true })
})

async function writeArtifact(artifactsDir: string, name: string, manifest: unknown, files: Record<string, string> = {}) {
  const dir = join(artifactsDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'artifact.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  for (const [file, content] of Object.entries(files)) await writeFile(join(dir, file), content)
}

describe('artifact paths', () => {
  test('recognises the dc_artifacts segment and splits the artifact location', () => {
    const file = join(root, 'project', 'dc_artifacts', 'report', 'index.html')
    expect(hasArtifactsSegment(file)).toBe(true)
    expect(hasArtifactsSegment(join(root, 'project', 'src', 'index.html'))).toBe(false)
    expect(artifactsDirOf(file)).toBe(join(root, 'project', 'dc_artifacts'))
    expect(artifactNameOf(file)).toBe('report')
    expect(artifactNameOf(join(root, 'project', 'dc_artifacts'))).toBeNull()
  })

  test('puts the global store under the config directory', () => {
    expect(getGlobalArtifactsDir()).toBe(join(root, 'config', 'artifacts-global', 'dc_artifacts'))
    expect(isGlobalArtifactsPath(join(getGlobalArtifactsDir(), 'a', 'index.html'))).toBe(true)
    expect(isGlobalArtifactsPath(join(root, 'project', 'dc_artifacts', 'a'))).toBe(false)
  })

  test('rejects reserved and traversing names', () => {
    expect(isSafeArtifactName('report')).toBe(true)
    expect(isSafeArtifactName('systems')).toBe(false)
    expect(isSafeArtifactName('..')).toBe(false)
    expect(isSafeArtifactName('a/b')).toBe(false)
    expect(isSafeArtifactName('')).toBe(false)
  })
})

describe('parseArtifactManifest', () => {
  test('accepts a page manifest and ignores unknown fields', () => {
    const { manifest, error } = parseArtifactManifest(JSON.stringify({ version: 1, id: 'id-1', kind: 'page', title: 'T', entry: 'index.html', extra: 1 }))
    expect(error).toBeNull()
    expect(manifest).toEqual({ version: 1, id: 'id-1', kind: 'page', title: 'T', entry: 'index.html' })
  })

  test('keeps valid boards only and requires an entry for a canvas like for any other kind', () => {
    const base = {
      version: 1,
      id: 'id-2',
      kind: 'canvas',
      title: 'C',
      boards: [{ id: 'a', file: 'a.html', x: 0, y: 1, width: 2, height: 3 }, { id: 'b', file: 'b.html' }],
    }
    expect(parseArtifactManifest(JSON.stringify({ ...base, entry: 'index.html' })).manifest?.boards).toEqual([
      { id: 'a', file: 'a.html', x: 0, y: 1, width: 2, height: 3 },
    ])
    expect(parseArtifactManifest(JSON.stringify(base)).error).toBe('entry is required')
  })

  test('reports every missing required field', () => {
    const { manifest, error } = parseArtifactManifest(JSON.stringify({ kind: 'page' }))
    expect(manifest).toBeNull()
    expect(error).toContain('version must be 1')
    expect(error).toContain('id is required')
    expect(error).toContain('title is required')
    expect(error).toContain('entry is required')
  })

  test('does not accept a deck as a kind', () => {
    const { manifest, error } = parseArtifactManifest(JSON.stringify({ version: 1, id: 'd', kind: 'deck', title: 'T', entry: 'index.html' }))
    expect(manifest).toBeNull()
    expect(error).toContain('kind must be one of page, canvas')
  })

  test('treats a manifest without an id as invalid', () => {
    const { manifest, error } = parseArtifactManifest(JSON.stringify({ version: 1, kind: 'page', title: 'T', entry: 'i.html' }))
    expect(manifest).toBeNull()
    expect(error).toBe('id is required')
    expect(parseArtifactManifest(JSON.stringify({ version: 1, id: '  ', kind: 'page', title: 'T', entry: 'i.html' })).manifest).toBeNull()
  })

  test('reports invalid JSON', () => {
    expect(parseArtifactManifest('{').error).toContain('not valid JSON')
    expect(parseArtifactManifest('[]').error).toContain('JSON object')
  })
})

describe('scanArtifactsDir', () => {
  test('lists folders that have a manifest and marks broken ones', async () => {
    const artifactsDir = join(root, 'p', 'dc_artifacts')
    await writeArtifact(artifactsDir, 'good', { version: 1, id: 'good-id', kind: 'page', title: 'Good', entry: 'index.html' }, { 'index.html': '<p>hi</p>' })
    await writeArtifact(artifactsDir, 'broken', '{nope')
    await writeArtifact(artifactsDir, 'systems', { version: 1, id: 'sys-id', kind: 'page', title: 'S', entry: 'x.html' })
    await mkdir(join(artifactsDir, 'no-manifest'), { recursive: true })

    const entries = await scanArtifactsDir(artifactsDir)
    expect(entries.map((entry) => entry.name)).toEqual(['broken', 'good'])
    expect(entries[0]!.manifest).toBeNull()
    expect(entries[0]!.error).toContain('not valid JSON')
    expect(entries[1]!.manifest?.title).toBe('Good')
    expect(artifactIdentity(entries[1]!)).toBe('good-id')
    expect(artifactIdentity(entries[0]!)).toBe(`path:${entries[0]!.dir}`)
    expect(await latestMtimeMs(entries[1]!.dir)).toBeGreaterThan(0)
  })

  test('returns nothing for a missing directory', async () => {
    expect(await scanArtifactsDir(join(root, 'missing', 'dc_artifacts'))).toEqual([])
  })
})

describe('artifact origin', () => {
  test('reads the origin file that travels with a moved artifact', async () => {
    const artifactsDir = join(root, 'p', 'dc_artifacts')
    await writeArtifact(artifactsDir, 'moved', { version: 1, id: 'm', kind: 'page', title: 'M', entry: 'index.html' })
    await writeFile(join(artifactsDir, 'moved', '.origin.json'), JSON.stringify({ workDir: '/wt', projectRoot: '/repo', branch: 'feature' }))
    expect((await readArtifactEntry(artifactsDir, 'moved'))!.origin).toEqual({ workDir: '/wt', projectRoot: '/repo', branch: 'feature' })
    await writeArtifact(artifactsDir, 'plain', { version: 1, id: 'p', kind: 'page', title: 'P', entry: 'index.html' })
    expect((await readArtifactEntry(artifactsDir, 'plain'))!.origin).toBeNull()
  })
})

describe('resolveArtifactEntryFile', () => {
  test('resolves an entry inside the artifact folder', async () => {
    const artifactsDir = join(root, 'p', 'dc_artifacts')
    await writeArtifact(artifactsDir, 'a', { version: 1, id: 'a-id', kind: 'page', title: 'A', entry: 'index.html' }, { 'index.html': 'x' })
    const entry = (await readArtifactEntry(artifactsDir, 'a'))!
    expect(await resolveArtifactEntryFile(entry)).toBe(join(artifactsDir, 'a', 'index.html'))
  })

  test('refuses an entry that leaves the folder, by path or by symlink', async () => {
    const artifactsDir = join(root, 'p', 'dc_artifacts')
    await writeFile(join(root, 'secret.html'), 'secret')
    await writeArtifact(artifactsDir, 'up', { version: 1, id: 'up-id', kind: 'page', title: 'A', entry: '../../../secret.html' })
    await writeArtifact(artifactsDir, 'link', { version: 1, id: 'link-id', kind: 'page', title: 'A', entry: 'link.html' })
    await symlink(join(root, 'secret.html'), join(artifactsDir, 'link', 'link.html'))
    expect(await resolveArtifactEntryFile((await readArtifactEntry(artifactsDir, 'up'))!)).toBeNull()
    expect(await resolveArtifactEntryFile((await readArtifactEntry(artifactsDir, 'link'))!)).toBeNull()
  })

  test('returns null when the entry file does not exist', async () => {
    const artifactsDir = join(root, 'p', 'dc_artifacts')
    await writeArtifact(artifactsDir, 'a', { version: 1, id: 'miss-id', kind: 'page', title: 'A', entry: 'missing.html' })
    expect(await resolveArtifactEntryFile((await readArtifactEntry(artifactsDir, 'a'))!)).toBeNull()
  })
})
