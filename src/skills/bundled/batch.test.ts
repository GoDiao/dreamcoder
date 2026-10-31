import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerBatchSkill } from './batch.js'

async function batchPrompt(args: string): Promise<string> {
  const skill = getBundledSkills().find(command => command.name === 'batch')
  if (!skill || skill.type !== 'prompt') throw new Error('batch skill not registered')
  const blocks = await skill.getPromptForCommand(args, {} as never)
  return blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

describe('batch skill e2e recipe guidance', () => {
  beforeEach(() => {
    clearBundledSkills()
    registerBatchSkill()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  it('offers the side browser tools for UI verification', async () => {
    const prompt = await batchPrompt('rename foo to bar')
    expect(prompt).toContain('mcp__dreamcoder-browser__*')
    expect(prompt).toContain('side browser')
  })

  it('no longer mentions the chrome extension', async () => {
    const prompt = await batchPrompt('rename foo to bar')
    expect(prompt.toLowerCase()).not.toContain('chrome extension')
  })
})
