import { afterEach, describe, expect, test } from 'bun:test'
import { getQuestionPreviewFormat, setQuestionPreviewFormat } from '../../bootstrap/state.js'
import { toolToAPISchema } from '../../utils/api.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { AskUserQuestionTool } from './AskUserQuestionTool.js'

const question = {
  question: 'Which layout?',
  header: 'Layout',
  options: [
    { label: 'Grid', description: 'Cards in a grid' },
    { label: 'List', description: 'One card per row' },
  ],
  multiSelect: false,
}

const originalPreviewFormat = getQuestionPreviewFormat()

afterEach(() => {
  setQuestionPreviewFormat(originalPreviewFormat)
})

async function modelSchema() {
  const api = (await toolToAPISchema(AskUserQuestionTool, {
    getToolPermissionContext: async () => getEmptyToolPermissionContext(),
    tools: [],
    agents: [],
  })) as { input_schema: { properties: Record<string, any> } }
  return api.input_schema.properties
}

describe('AskUserQuestion schema', () => {
  test('the model gets the questions and their options only', async () => {
    setQuestionPreviewFormat(undefined)

    const properties = await modelSchema()
    expect(Object.keys(properties)).toEqual(['questions'])
    expect(Object.keys(properties.questions.items.properties.options.items.properties)).toEqual(['label', 'description'])
  })

  test('a client that renders previews keeps the preview field the description asks for', async () => {
    setQuestionPreviewFormat('markdown')

    const properties = await modelSchema()
    expect(Object.keys(properties)).toEqual(['questions'])
    expect(Object.keys(properties.questions.items.properties.options.items.properties)).toEqual(['label', 'description', 'preview'])
  })

  test("the desktop app's answer still passes the tool's input check", () => {
    const answered = { questions: [question], answers: { 'Which layout?': 'Grid' } }

    expect(AskUserQuestionTool.inputSchema.safeParse(answered).success).toBe(true)
  })
})
