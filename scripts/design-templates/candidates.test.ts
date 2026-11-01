import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { localReferences } from '../../src/utils/artifactCheck'
import { findCandidates } from './candidates'

const skill = (mode: string, extra = '') => `---
name: demo
description: A demo.
od:
  mode: ${mode}
  platform: desktop
  scenario: marketing
${extra}---
# Demo
`

let root: string

async function write(sourceDir: string, id: string, files: Record<string, string>) {
  const folder = path.join(root, sourceDir, id)
  await fs.mkdir(folder, { recursive: true })
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(folder, name), content)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-candidates-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('local references of a template', () => {
  it('lists local files and ignores addresses, anchors, data and script bodies', () => {
    const html = `<img src="./a.png"><a href="#top"></a><a href="https://x.com/"></a><link href="//cdn/x.css"><div style="background:url('b.jpg')"></div><i style="background:url(data:image/png;base64,AAAA)"></i><script>const x = '<img src="c.png">'</script>`
    expect(localReferences(html)).toEqual(['./a.png', 'b.jpg'])
  })
})

describe('findCandidates', () => {
  it('takes page and template modes that have an example, from both source folders', async () => {
    await write('design-templates', 'proto', { 'SKILL.md': skill('prototype'), 'example.html': '<h1>x</h1>' })
    await write('design-templates', 'tmpl', { 'SKILL.md': skill('template'), 'example.html': '<h1>yy</h1>' })
    await write('skills', 'extra', { 'SKILL.md': skill('prototype'), 'example.html': '<h1>z</h1>' })
    const found = await findCandidates(root)
    expect(found.map(item => [item.sourceDir, item.id, item.mode])).toEqual([
      ['design-templates', 'proto', 'prototype'],
      ['design-templates', 'tmpl', 'template'],
      ['skills', 'extra', 'prototype'],
    ])
    expect(found[0]).toMatchObject({ platform: 'desktop', scenario: 'marketing', bytes: 10, relativeReferences: [] })
  })

  it('skips other modes, folders without an example or a SKILL.md, and plain files', async () => {
    await write('design-templates', 'image', { 'SKILL.md': skill('image'), 'example.html': 'x' })
    await write('design-templates', 'noexample', { 'SKILL.md': skill('prototype') })
    await write('design-templates', 'noskill', { 'example.html': 'x' })
    await fs.writeFile(path.join(root, 'design-templates', 'README.md'), 'x')
    await write('skills', 'deck', { 'SKILL.md': skill('deck'), 'example.html': 'x' })
    expect(await findCandidates(root)).toEqual([])
  })

  it('flags templates that point at files next to them without excluding them', async () => {
    await write('skills', 'shell', { 'SKILL.md': skill('template'), 'example.html': '<iframe src="./assets/template.html"></iframe>' })
    expect(await findCandidates(root)).toEqual([expect.objectContaining({ id: 'shell', relativeReferences: ['./assets/template.html'] })])
  })

  it('tolerates a checkout that has only one of the folders', async () => {
    await write('skills', 'only', { 'SKILL.md': skill('prototype'), 'example.html': 'x' })
    expect((await findCandidates(root)).map(item => item.id)).toEqual(['only'])
  })
})
