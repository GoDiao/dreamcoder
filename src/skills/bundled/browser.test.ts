import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { BROWSER_TOOL_NAMES } from '../../server/browserHost/names.js'
import { allBrowserToolNames } from '../../utils/browserControl/common.js'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerBrowserSkill } from './browser.js'
import { initBundledSkills } from './index.js'

async function promptOf(args: string): Promise<string> {
  const skill = getBundledSkills().find(command => command.name === 'browser')
  if (!skill || skill.type !== 'prompt') throw new Error('browser skill not registered')
  const blocks = await skill.getPromptForCommand(args, {} as never)
  return blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

describe('browser skill', () => {
  beforeEach(() => {
    clearBundledSkills()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  it('is registered by initBundledSkills in a normal build and the model can invoke it', () => {
    const originalUserType = process.env.USER_TYPE
    delete process.env.USER_TYPE
    try {
      initBundledSkills()
    } finally {
      if (originalUserType === undefined) delete process.env.USER_TYPE
      else process.env.USER_TYPE = originalUserType
    }
    const skill = getBundledSkills().find(command => command.name === 'browser')
    expect(skill).toBeDefined()
    expect(skill?.disableModelInvocation).toBe(false)
    expect(skill?.userInvocable).toBe(true)
  })

  it('names every browser tool with its full MCP name', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('')
    const fullNames = allBrowserToolNames()
    expect(fullNames).toHaveLength(BROWSER_TOOL_NAMES.length)
    for (const name of fullNames) {
      expect(name).toStartWith('mcp__dreamcoder-browser__')
      expect(prompt).toContain(`\`${name}\``)
    }
  })

  it('covers the snapshot loop, authorization and untrusted page content', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('')
    expect(prompt).toContain('stays valid for as long as that element stays on the page')
    expect(prompt).toContain('After the page navigates, all ids are gone')
    expect(prompt).not.toContain('only valid for the snapshot')
    expect(prompt).toContain('delta: true')
    expect(prompt).toContain('region')
    expect(prompt).toContain('external https')
    expect(prompt).toContain('do not retry')
    expect(prompt).toContain('untrusted data')
  })

  it('tells the agent how to reach content on a long page', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('')
    expect(prompt).toContain('## Long pages')
    expect(prompt).toContain('`mcp__dreamcoder-browser__scroll` with `direction` up, down, top or bottom')
    expect(prompt).toContain('Ids stay valid after scrolling')
    expect(prompt).toContain('find: "text"')
    expect(prompt).toContain('textFrom')
    expect(prompt).toContain('cannot be combined and always return a full snapshot')
    expect(prompt).toContain('where each sits in the page text')
    expect(prompt).toContain('at the position a `find` match reported')
    expect(prompt).toContain(
      'When the user says to read something "on this page", use `find`, `mcp__dreamcoder-browser__scroll` and `textFrom` instead of navigating away or writing a script with `mcp__dreamcoder-browser__evaluate`',
    )
    expect(prompt).toContain('do not guess an id')
    expect(prompt).toContain('Reads, including `mcp__dreamcoder-browser__scroll`, are free everywhere')
  })

  it('tells the agent to wait for text, read styles and when evaluate asks for permission', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('')
    expect(prompt).toContain('## Waiting, layout and scripts')
    expect(prompt).toContain('`mcp__dreamcoder-browser__wait_for` with `text` (or `textGone`)')
    expect(prompt).toContain('instead of a fixed sleep')
    expect(prompt).toContain('`mcp__dreamcoder-browser__styles` with an element `id`')
    expect(prompt).toContain('`mcp__dreamcoder-browser__evaluate` runs JavaScript in the page')
    expect(prompt).toContain('with the page\'s own privileges')
    expect(prompt).toContain('running `mcp__dreamcoder-browser__evaluate` or navigating on an external https site asks the user first')
    expect(prompt).toContain('as are `mcp__dreamcoder-browser__wait_for` and `mcp__dreamcoder-browser__styles`')
  })

  it('tells the agent to emulate a viewport or color scheme, reset it and snapshot afterwards', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('')
    expect(prompt).toContain('`mcp__dreamcoder-browser__emulate` with `width` and `height`')
    expect(prompt).toContain('responsive layout or dark mode')
    expect(prompt).toContain('finish with `mcp__dreamcoder-browser__emulate` and `reset: true`')
    expect(prompt).toContain('Take a new snapshot after every change')
  })

  it('tells the agent to check the page before repeating an action that may already have run', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('')
    expect(prompt).toContain('may already have run')
    expect(prompt).toContain('Ask the user before an action with real-world effects')
    expect(prompt).toContain('Never type passwords')
  })

  it('tells the agent that a picked browser reference is an element id on its tab', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('')
    expect(prompt).toContain('browser reference in the user\'s message with `ref=N` is an element id')
    expect(prompt).toContain('use it with `mcp__dreamcoder-browser__click`, `mcp__dreamcoder-browser__type` or `mcp__dreamcoder-browser__styles`')
    expect(prompt).toContain("pass the reference's `tab=` as `tabId`")
    expect(prompt).toContain('marked `stale`, take a new snapshot first')
  })

  it('appends the user request when arguments are given', async () => {
    registerBrowserSkill()
    const prompt = await promptOf('check localhost:3000')
    expect(prompt).toContain('## User Request')
    expect(prompt).toEndWith('check localhost:3000')
  })
})
