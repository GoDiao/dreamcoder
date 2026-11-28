import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { zodToJsonSchema } from '../utils/zodToJsonSchema.js'
import { getPrompt as getAgentPrompt } from './AgentTool/prompt.js'
import { AskUserQuestionTool } from './AskUserQuestionTool/AskUserQuestionTool.js'
import { FileReadTool } from './FileReadTool/FileReadTool.js'
import { getPrompt as getSkillPrompt } from './SkillTool/prompt.js'
import { StartSessionTool } from './StartSessionTool/StartSessionTool.js'
import { TaskOutputTool } from './TaskOutputTool/TaskOutputTool.js'

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

type ObjectSchema = {
  required?: string[]
  additionalProperties?: boolean
  properties: Record<string, { items?: ObjectSchema }>
}

function schemaOf(tool: { inputSchema: unknown }): ObjectSchema {
  return zodToJsonSchema(
    tool.inputSchema as Parameters<typeof zodToJsonSchema>[0],
  ) as unknown as ObjectSchema
}

describe('Read description', () => {
  test('states the real default and both limits', async () => {
    const prompt = await FileReadTool.prompt()

    expect(prompt).toContain('By default, it reads the whole file')
    expect(prompt).toContain('256KB')
    expect(prompt).toContain('25,000 tokens')
    expect(prompt).not.toContain('2000 lines')
    expect(prompt).not.toContain('recommended to read the whole file')
  })
})

describe('Agent description', () => {
  test('names the configured model behind each model value', async () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    process.env.ANTHROPIC_MODEL = 'kimi-main'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'kimi-main'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'kimi-main'
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'kimi-fast'

    const prompt = await getAgentPrompt([])

    expect(prompt).toContain(
      'sonnet = kimi-main, opus = kimi-main, haiku = kimi-fast',
    )
  })

  test('names the override model when every agent is pinned to one', async () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'pinned-model'

    const prompt = await getAgentPrompt([])

    expect(prompt).toContain(
      'sonnet = pinned-model, opus = pinned-model, haiku = pinned-model',
    )
  })
})

describe('Skill description', () => {
  test('names no skill that DreamCoder does not ship', async () => {
    const prompt = await getSkillPrompt('/nonexistent/skill-prompt')

    expect(prompt).toContain('skill: "<name>"')
    for (const name of ['pdf', 'commit', 'review-pr', 'ms-office-suite']) {
      expect(prompt).not.toContain(name)
    }
  })
})

describe('parameters with defaults', () => {
  test('TaskOutput requires only the task id', () => {
    const schema = schemaOf(TaskOutputTool)

    expect(schema.required).toEqual(['task_id'])
    expect(schema.additionalProperties).toBe(false)
  })

  test('StartSession does not require worktree', () => {
    const schema = schemaOf(StartSessionTool)

    expect(Object.keys(schema.properties)).toContain('worktree')
    expect(schema.required).not.toContain('worktree')
  })

  test('AskUserQuestion does not require multiSelect', () => {
    const question = schemaOf(AskUserQuestionTool).properties.questions!.items!

    expect(question.required).toContain('question')
    expect(question.required).not.toContain('multiSelect')
  })
})
