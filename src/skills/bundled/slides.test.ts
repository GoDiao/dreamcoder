import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import { isDeckEntryHtml } from '../../utils/deck.js'
import { designSystemUsage, installDesignSystem } from '../../utils/designSystems.js'
import { systemRecord, writeSystems } from '../../utils/__tests__/designSystemFixtures.js'
import { templateRecord, writeTemplates } from '../../utils/__tests__/designTemplateFixtures.js'
import { clearBundledSkills, getBundledSkillExtractDir, getBundledSkills } from '../bundledSkills.js'
import { initBundledSkills } from './index.js'

const deckShell = readFileSync(join(import.meta.dir, '..', '..', '..', 'desktop', 'public', 'artifact-shell', 'deck.js'), 'utf-8')
const originalAppRoot = process.env.CLAUDE_APP_ROOT
const originalCwd = getOriginalCwd()
let root: string

function skill() {
  const found = getBundledSkills().find(command => command.name === 'slides')
  if (!found || found.type !== 'prompt') throw new Error('slides skill not registered')
  return found
}

async function promptOf(args: string): Promise<string> {
  const blocks = await skill().getPromptForCommand(args, {} as never)
  return blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

async function reference(name: string): Promise<string> {
  await promptOf('')
  return readFile(join(getBundledSkillExtractDir('slides'), name), 'utf-8')
}

async function writeDeck(name: string, manifest: Record<string, unknown> = {}) {
  const dir = join(root, 'project', 'dc_artifacts', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'artifact.json'), JSON.stringify({ version: 1, id: 'd', kind: 'deck', title: 'Talk', entry: 'index.html', slides: [], ...manifest }))
  return dir
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'slides-skill-')))
  await mkdir(join(root, 'Resources', 'bin'), { recursive: true })
  process.env.CLAUDE_APP_ROOT = join(root, 'Resources', 'bin')
  await writeTemplates(join(root, 'Resources', 'design-templates'), [templateRecord('saas')])
  await writeSystems(join(root, 'Resources', 'design-systems'), [
    systemRecord('starter-one', { origin: 'starter', category: 'Editorial', name: { en: 'One', zh: '一' }, description: { en: 'Warm paper.', zh: '暖纸' } }),
    systemRecord('alpha', { category: 'Fintech' }),
  ])
  setOriginalCwd(join(root, 'project'))
  clearBundledSkills()
  initBundledSkills()
})

afterEach(async () => {
  clearBundledSkills()
  setOriginalCwd(originalCwd)
  if (originalAppRoot === undefined) delete process.env.CLAUDE_APP_ROOT
  else process.env.CLAUDE_APP_ROOT = originalAppRoot
  await rm(root, { recursive: true, force: true })
})

describe('slides skill', () => {
  it('is registered apart from design, user invocable and invocable by the model', () => {
    expect(skill().disableModelInvocation).toBe(false)
    expect(skill().userInvocable).toBe(true)
    expect(skill().description).toContain('slide deck')
    expect(skill().whenToUse).toContain('use the design skill')
    const design = getBundledSkills().find(command => command.name === 'design')
    expect(design?.whenToUse).toContain('use the slides skill')
  })

  it('walks through interview, design system, making and checking, and defers the artifact rules to the artifacts skill', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('four steps')
    expect(prompt).toContain('`artifacts` skill')
    expect(prompt).toContain('AskUserQuestion')
    expect(prompt).toContain('UseDesignSystem')
    expect(prompt).toContain('ArtifactCheck')
    for (const file of ['interview.md', 'format.md', 'layout.md', 'design-systems.md', 'checks.md']) expect(prompt).toContain(`\`${file}\``)
    expect(prompt).toContain('in the language of the user')
    expect(prompt).toContain('only /slides and a path')
  })

  it('tells the agent to show the deck after the first slide and to list every slide as it writes it', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('and the first slide')
    expect(prompt).toContain('Open the deck in a new tab')
    expect(prompt).toContain('in the same step as you write its file')
  })

  it('has no template step and lists no templates, while it lists the design system library', async () => {
    const prompt = await promptOf('make a pitch deck')
    expect(prompt).not.toContain('Template index')
    expect(prompt).not.toContain('ChooseDesignTemplate')
    expect(prompt).not.toContain('saas')
    expect(prompt).toContain('## Design system library index')
    expect(prompt).toContain('- starter-one (One): Warm paper.')
    expect(prompt).toContain('## User Request\n\nmake a pitch deck')
  })

  it('points at an existing deck the user names and at the design system that deck uses, without telling it to edit the entry', async () => {
    await installDesignSystem({ systemId: 'alpha', artifactsDir: join(root, 'project', 'dc_artifacts'), systemsDir: join(root, 'Resources', 'design-systems') })
    const dir = await writeDeck('talk', { designSystem: 'systems/alpha' })
    const prompt = await promptOf(dir)
    expect(prompt).toContain(`The deck ${dir} already exists`)
    expect(prompt).toContain('## Design system of the deck')
    expect(prompt).toContain(join(root, 'project', 'dc_artifacts', 'systems', 'alpha'))
    expect(prompt).toContain('Do not edit index.html')
    expect(prompt).not.toContain('<link rel="stylesheet"')
    expect(prompt).not.toContain('## Design system library index')
  })

  it('does not treat a folder that is not a deck as a deck to work on', async () => {
    const dir = join(root, 'project', 'dc_artifacts', 'report')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'artifact.json'), JSON.stringify({ version: 1, id: 'p', kind: 'page', title: 'Report', entry: 'index.html' }))
    expect(await promptOf(dir)).not.toContain('## Deck to work on')
  })
})

describe('slides skill reference files', () => {
  it('gives the fixed entry file, the manifest and the rules of a slide file', async () => {
    const format = await reference('format.md')
    const block = /```html\n(<!doctype[\s\S]*?)```/.exec(format)
    expect(block).not.toBeNull()
    expect(isDeckEntryHtml(block![1]!)).toBe(true)
    expect(format).toContain('"kind": "deck"')
    expect(format).toContain('"slides": ["cover", "agenda"]')
    expect(format).toContain('one `<section>` element and nothing before or after it')
    expect(format).toContain('1920 by 1080')
    expect(format).toContain('No `<script>` and no inline event attributes')
    expect(format).toContain('class="fragment"')
    expect(format).toContain('<iframe src="embeds/demo.html"')
  })

  it('says that paths in a slide start at the artifact folder and paths in an embedded page at its own file', async () => {
    const format = await reference('format.md')
    expect(format).toContain('Relative paths start at the artifact folder, not at `slides/`')
    expect(format).toContain('never `../assets/chart.png`')
    expect(format).toContain('its own paths are relative to its own file')
  })

  it('asks for HTML in the form a browser serializes', async () => {
    const format = await reference('format.md')
    expect(format).toContain('attribute values in double quotes')
    expect(format).toContain('<path d="..."></path>')
  })

  it('keeps the classes it reserves for the stage in step with the stage script', async () => {
    const format = await reference('format.md')
    expect(format).toContain('any class that starts with `dc-`')
    const stageClasses = [...deckShell.matchAll(/className = '([a-z-]+)'/g)].map(match => match[1]!)
    expect(stageClasses.length).toBeGreaterThan(0)
    expect(stageClasses.every(name => name.startsWith('dc-'))).toBe(true)
    expect(deckShell).toContain("querySelectorAll('.fragment')")
  })

  it('asks about use, length, content and look in the interview, with the shared rules', async () => {
    const interview = await reference('interview.md')
    expect(interview).toContain('a speaker presents it to a room, or people read it on their own')
    expect(interview).toContain('only /slides and a path')
    expect(interview).toContain('用示例')
    expect(interview).toContain('Never make the user fill in a form')
  })

  it('sets margins and smallest type sizes and tells the agent to split a slide instead of shrinking it', async () => {
    const layout = await reference('layout.md')
    expect(layout).toContain('at least 96 px from the left and right edges')
    expect(layout).toContain('at least 28 px')
    expect(layout).toContain('split it over two slides or cut words')
    expect(layout).toContain('Do not shrink the type')
  })

  it('describes the check loop with the calls the stage script really offers', async () => {
    const checks = await reference('checks.md')
    expect(checks).toContain('ArtifactCheck')
    expect(checks).toContain('`mcp__dreamcoder-browser__navigate`')
    expect(checks).toContain('`mcp__dreamcoder-browser__evaluate`')
    expect(checks).toContain('`mcp__dreamcoder-browser__screenshot`')
    expect(checks).toContain('the scroll height of a slide tells you nothing')
    for (const call of ['overflow', 'goTo', 'state']) {
      expect(checks).toContain(`window.__dreamcoderDeck.${call}(`)
      expect(deckShell).toMatch(new RegExp(`\\b${call}: ${call},`))
    }
  })

  it('applies a design system to a deck through the manifest and shares how to extract one with design', async () => {
    const forDeck = await reference('design-systems.md')
    expect(forDeck).toContain('## Apply a system to a deck')
    expect(forDeck).toContain('Do not edit index.html')
    expect(forDeck).not.toContain('In the entry HTML add <link')
    expect(forDeck).toContain('too small for a 1920 by 1080 slide')
    expect(forDeck).toContain('## Extract a system from a website')

    const design = getBundledSkills().find(command => command.name === 'design')
    if (!design || design.type !== 'prompt') throw new Error('design skill not registered')
    await design.getPromptForCommand('', {} as never)
    const forPage = await readFile(join(getBundledSkillExtractDir('design'), 'design-systems.md'), 'utf-8')
    expect(forPage).toContain('In the entry HTML add <link')
    expect(forPage.slice(forPage.indexOf('## Extract a system from a website'))).toBe(forDeck.slice(forDeck.indexOf('## Extract a system from a website')))
  })
})

describe('designSystemUsage', () => {
  it('tells a page to link the tokens in its entry and a deck to leave its entry alone', () => {
    const page = designSystemUsage('alpha', '/repo/dc_artifacts/systems/alpha', 'page')
    expect(page).toContain('<link rel="stylesheet" href="../systems/alpha/tokens.css">')
    expect(page).not.toContain('deck')

    const deck = designSystemUsage('alpha', '/repo/dc_artifacts/systems/alpha', 'deck')
    expect(deck).toContain('Do not edit index.html')
    expect(deck).not.toContain('<link')
    expect(deck).toContain('"designSystem": "systems/alpha"')
  })

  it('covers both when the kind of the artifact is not known', () => {
    const usage = designSystemUsage('alpha', '/repo/dc_artifacts/systems/alpha')
    expect(usage).toContain('<link rel="stylesheet" href="../systems/alpha/tokens.css">')
    expect(usage).toContain('A deck (kind "deck") is different')
  })
})
