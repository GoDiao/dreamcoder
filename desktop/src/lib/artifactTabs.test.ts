import { describe, expect, it } from 'vitest'
import { artifactFolderOf, isExportableArtifact, tabShowsArtifact } from './artifactTabs'

describe('artifactFolderOf', () => {
  it('gives the first folder of a project page address', () => {
    expect(artifactFolderOf('dreamcoder-project://abc/talk/index.html#agenda')).toBe('talk')
    expect(artifactFolderOf('dreamcoder-project://abc/my%20deck/slides/a.html?x=1')).toBe('my deck')
  })

  it('gives nothing for any other address, a project address without a folder or text that is no address', () => {
    expect(artifactFolderOf('https://example.com/talk/index.html')).toBeNull()
    expect(artifactFolderOf('dreamcoder-project://abc/')).toBeNull()
    expect(artifactFolderOf('')).toBeNull()
  })
})

describe('tabShowsArtifact', () => {
  const artifact = { id: 'id-talk', name: 'talk', mtimeMs: 1 }

  it('is true while the address of the tab is inside the folder of its artifact', () => {
    expect(tabShowsArtifact({ url: 'dreamcoder-project://abc/talk/index.html#agenda', artifact })).toBe(true)
    expect(tabShowsArtifact({ url: 'dreamcoder-project://abc/talk/embeds/demo.html', artifact })).toBe(true)
  })

  it('is false on another site, in another folder, before the page has an address and for a tab without an artifact', () => {
    expect(tabShowsArtifact({ url: 'http://localhost:3000/talk/index.html', artifact })).toBe(false)
    expect(tabShowsArtifact({ url: 'dreamcoder-project://abc/talk-2/index.html', artifact })).toBe(false)
    expect(tabShowsArtifact({ url: '', artifact })).toBe(false)
    expect(tabShowsArtifact({ url: 'dreamcoder-project://abc/talk/index.html' })).toBe(false)
  })
})

describe('isExportableArtifact', () => {
  it('is false for a canvas only', () => {
    expect(isExportableArtifact({ canvas: true })).toBe(false)
    expect(isExportableArtifact({ canvas: false })).toBe(true)
    expect(isExportableArtifact({})).toBe(true)
  })
})
