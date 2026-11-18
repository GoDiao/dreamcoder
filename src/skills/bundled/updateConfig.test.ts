import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerUpdateConfigSkill } from './updateConfig.js'

function updateConfigSkill() {
  const skill = getBundledSkills().find(command => command.name === 'update-config')
  if (!skill || skill.type !== 'prompt') throw new Error('update-config skill not registered')
  return skill
}

describe('update-config skill', () => {
  beforeEach(() => {
    clearBundledSkills()
    registerUpdateConfigSkill()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  it('describes DreamCoder and does not send the model to a Config tool it does not have', async () => {
    const skill = updateConfigSkill()
    const blocks = await skill.getPromptForCommand('[hooks-only]', {} as never)
    const prompt = blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')

    for (const text of [skill.description, prompt]) {
      expect(text).not.toContain('Claude Code')
      expect(text).not.toContain('Config tool')
    }
    expect(skill.description).toContain('DreamCoder')
  })
})
