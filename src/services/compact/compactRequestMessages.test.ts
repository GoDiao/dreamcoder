import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { createAssistantMessage, createUserMessage } from '../../utils/messages.js'
import { compactRequestMessages } from './compact.js'

const midTurnMessage = 'I have finished the schema change.'

function toolTurnWithMidTurnMessage(): Message[] {
  return [
    createUserMessage({ content: 'run the tests' }),
    createAssistantMessage({
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'bun test' } }] as never,
    }),
    createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 pass' }],
      toolUseResult: '12 pass',
    }),
    createAttachmentMessage({ type: 'queued_command', prompt: midTurnMessage, commandMode: 'prompt' } as never),
  ]
}

function toolResultTurn(model: string) {
  const summaryRequest = createUserMessage({ content: 'Summarize the conversation.' })
  const forApi = compactRequestMessages(toolTurnWithMidTurnMessage(), summaryRequest, [], model)
  const turn = forApi.find(
    message => Array.isArray(message.message.content) && message.message.content.some(block => block.type === 'tool_result'),
  )!
  return turn.message.content as Array<{ type: string; content?: unknown; text?: string }>
}

describe('messages of the compaction request', () => {
  test('keep text that arrived after a tool result as its own block for non-Claude models', () => {
    const content = toolResultTurn('glm-5.1')

    expect(content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 pass' })
    expect(content.slice(1).some(block => block.type === 'text' && block.text?.includes(midTurnMessage))).toBe(true)
  })

  test('fold it into the tool result for Claude models, as the main request does', () => {
    const content = toolResultTurn('claude-sonnet-4-6')

    expect(content[0]!.type).toBe('tool_result')
    expect(String(content[0]!.content)).toContain(midTurnMessage)
  })
})
