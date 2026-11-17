import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { CANVAS_ENTRY_HTML, isCanvasEntryHtml } from '../../utils/canvas.js'
import { DECK_ENTRY_HTML, isDeckEntryHtml } from '../../utils/deck.js'
import { initBundledSkills } from './index.js'
import { SLIDES_USER_CHANGES_RULE } from './slides.js'

const canvasShell = readFileSync(join(import.meta.dir, '..', '..', '..', 'desktop', 'public', 'artifact-shell', 'canvas.js'), 'utf-8')

function shellLabel(language: 'en' | 'zh', key: 'interact' | 'stopInteract'): string {
  const table = new RegExp(`${language}: \\{[^}]*\\b${key}: '([^']+)'`).exec(canvasShell)
  if (!table) throw new Error(`canvas.js has no ${language} ${key} label`)
  return table[1]!
}

async function promptOf(args: string): Promise<string> {
  const skill = getBundledSkills().find(command => command.name === 'artifacts')
  if (!skill || skill.type !== 'prompt') throw new Error('artifacts skill not registered')
  const blocks = await skill.getPromptForCommand(args, {} as never)
  return blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

describe('artifacts skill', () => {
  beforeEach(() => {
    clearBundledSkills()
    initBundledSkills()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  it('is registered and the model can invoke it', () => {
    const skill = getBundledSkills().find(command => command.name === 'artifacts')
    expect(skill).toBeDefined()
    expect(skill?.disableModelInvocation).toBe(false)
    expect(skill?.userInvocable).toBe(true)
  })

  it('tells the agent to ask before creating, write only in its own dc_artifacts and show the page in a new tab', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('AskUserQuestion')
    expect(prompt).toContain('dc_artifacts/')
    expect(prompt).toContain('read-only')
    expect(prompt).toContain('UUID')
    expect(prompt).toContain('ArtifactCheck')
    expect(prompt).toContain('ArtifactCopy')
    expect(prompt).toContain('A background agent cannot copy')
    expect(prompt).toContain('`mcp__dreamcoder-browser__navigate`')
    expect(prompt).toContain('newTab: true')
    expect(prompt).toContain('`mcp__dreamcoder-browser__close_tab`')
    expect(prompt).toContain('.git/info/exclude')
  })

  it('treats a request for a page or a display as a question to ask, not as a request for an artifact', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('Create one directly only when the user says so')
    expect(prompt).toContain('is not asking for an artifact')
    expect(prompt).toContain('If the user declines, show it with ShowUI')
  })

  it('appends the user request', async () => {
    expect(await promptOf('make a report')).toContain('## User Request\n\nmake a report')
  })

  it('describes the canvas: manifest, the fixed entry file, board rules, snapshot budget and export', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('## Canvas')
    expect(prompt).toContain('"kind": "canvas"')
    expect(prompt).toContain('"boards"')
    expect(prompt).toContain(CANVAS_ENTRY_HTML)
    expect(prompt).toContain('/__dreamcoder__/canvas.js')
    expect(prompt).toContain('cannot be an absolute path, a web address or contain `..`')
    expect(prompt).toContain('at most 150')
    expect(prompt).toContain('`mcp__dreamcoder-browser__snapshot`')
    expect(prompt).toContain('`region`')
    expect(prompt).toContain('opens one board in its own tab and exports it')
    expect(prompt).toContain('measure its content height')
    expect(prompt).toContain('document.documentElement.scrollHeight')
    expect(prompt).not.toContain('cannot be opened')
  })

  it('tells the agent that a board takes no input until it is in interaction mode, and how to enter it', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('until it is in interaction mode')
    expect(prompt).toContain('`mcp__dreamcoder-browser__click`')
    expect(prompt).toContain('`mcp__dreamcoder-browser__type`')
    expect(prompt).toContain(`\`${shellLabel('en', 'interact')}: <board title>\``)
    expect(prompt).toContain(`\`${shellLabel('zh', 'interact')}: <board title>\``)
    expect(prompt).toContain(`\`${shellLabel('en', 'stopInteract')}: <board title>\``)
    expect(prompt).toContain('the board id stands in for the title')
    expect(prompt).toContain('press Escape to leave')
    expect(prompt).toContain('needs no interaction mode')
  })

  it('gives an entry file text that the canvas check accepts', async () => {
    const prompt = await promptOf('')
    const block = /```html\n([\s\S]*?)```/.exec(prompt)
    expect(block).not.toBeNull()
    expect(isCanvasEntryHtml(block![1]!)).toBe(true)
  })

  it('describes the deck: kind, manifest, the fixed entry file and where the rules are', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('`deck` for slides')
    expect(prompt).toContain('## Deck')
    expect(prompt).toContain('"kind": "deck"')
    expect(prompt).toContain('"slides": ["cover", "agenda"]')
    expect(prompt).toContain(DECK_ENTRY_HTML)
    expect(prompt).toContain('/__dreamcoder__/deck.js')
    expect(prompt).toContain('load the `slides` skill')
    expect(prompt).toContain("window.__dreamcoderDeck.goTo('<id>')")
    const blocks = [...prompt.matchAll(/```html\n([\s\S]*?)```/g)].map(match => match[1]!)
    expect(blocks.some(isDeckEntryHtml)).toBe(true)
  })

  it('tells the agent that the user edits artifacts in the app, that writes wait for the user, and to write with Write and Edit', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('## When the user edits an artifact')
    expect(prompt).toContain('a Write or Edit into it waits until they are done')
    expect(prompt).toContain('read the files the user changed before you change the artifact, keep their changes')
    expect(prompt).toContain('Use shell commands in an artifact folder only to delete or rename files.')
  })

  it('gives a session that edits a deck without the slides skill the same rule about changes the user made in the app', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain(SLIDES_USER_CHANGES_RULE)
  })
})

