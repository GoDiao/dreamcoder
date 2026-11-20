import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
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

  it('includes a full settings schema that accepts plugin flags and version lists', async () => {
    const [block] = await updateConfigSkill().getPromptForCommand('Set the language to en', {} as never)
    if (block?.type !== 'text') throw new Error('Expected a settings prompt')
    const json = block.text.match(/## Full Settings JSON Schema\s*```json\n([\s\S]*?)\n```/)?.[1]
    if (!json) throw new Error('Missing settings schema in prompt')

    const schema = JSON.parse(json)
    expect(schema.properties.permissions).toBeDefined()
    const validate = new Ajv2020({ validateFormats: false }).compile(schema)
    expect(validate({ enabledPlugins: { 'a@local': true, 'b@local': false, 'c@local': ['1.0'] } })).toBe(true)
    expect(validate({ enabledPlugins: { 'a@local': null } })).toBe(false)
    expect(validate({ enabledPlugins: { 'c@local': [1] } })).toBe(false)
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
