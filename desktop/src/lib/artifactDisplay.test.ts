import { describe, expect, it } from 'vitest'
import type { ArtifactListItem } from '../types/artifact'
import { artifactBranch, artifactDetail, artifactKey, artifactOpenable, artifactRoot, artifactTitle } from './artifactDisplay'

const t = ((key: string, params?: Record<string, string | number>) => (params ? `${key}:${params.reason}` : key)) as Parameters<typeof artifactDetail>[0]
const manifest = (kind: 'page' | 'canvas'): ArtifactListItem['manifest'] => ({ version: 1, id: 'a', kind, title: 'A', entry: 'index.html' })

describe('artifactDetail', () => {
  it('reports a manifest error before anything else', () => {
    expect(artifactDetail(t, { error: 'bad json', entryMissing: true, manifest: null })).toBe('artifacts.invalidManifest:bad json')
  })

  it('reports a missing entry file before the kind', () => {
    expect(artifactDetail(t, { error: null, entryMissing: true, manifest: manifest('page') })).toBe('artifacts.entryMissing')
  })

  it('names the kind of a healthy artifact', () => {
    expect(artifactDetail(t, { error: null, entryMissing: false, manifest: manifest('page') })).toBe('artifacts.kind.page')
    expect(artifactDetail(t, { error: null, entryMissing: false, manifest: manifest('canvas') })).toBe('artifacts.kind.canvas')
  })

  it('is empty without a manifest', () => {
    expect(artifactDetail(t, { error: null, entryMissing: false, manifest: null })).toBe('')
  })
})

describe('artifact item helpers', () => {
  it('takes the title from the manifest and falls back to the folder name', () => {
    expect(artifactTitle({ name: 'report', manifest: manifest('page') })).toBe('A')
    expect(artifactTitle({ name: 'report', manifest: null })).toBe('report')
  })

  it('keys an item by its artifacts folder and name', () => {
    expect(artifactKey({ artifactsDir: '/repo/dc_artifacts', name: 'report' })).toBe('/repo/dc_artifacts\u0000report')
  })

  it('opens only an item with a manifest and an entry file', () => {
    expect(artifactOpenable({ manifest: manifest('page'), entryMissing: false })).toBe(true)
    expect(artifactOpenable({ manifest: manifest('page'), entryMissing: true })).toBe(false)
    expect(artifactOpenable({ manifest: null, entryMissing: false })).toBe(false)
  })

  it('prefers the branch of the folder and falls back to the origin branch', () => {
    expect(artifactBranch({ branch: 'main', origin: { workDir: null, projectRoot: null, branch: 'old' } })).toBe('main')
    expect(artifactBranch({ branch: null, origin: { workDir: null, projectRoot: null, branch: 'old' } })).toBe('old')
    expect(artifactBranch({ branch: null, origin: null })).toBeNull()
  })

  it('uses the global root for an item without a work folder', () => {
    expect(artifactRoot({ workDir: null, artifactsDir: '/config/dc_artifacts' })).toBe('global')
    expect(artifactRoot({ workDir: '/repo', artifactsDir: '/repo/dc_artifacts' })).toBe('/repo/dc_artifacts')
  })
})
