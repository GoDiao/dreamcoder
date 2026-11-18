import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { createAssistantMessage, createUserMessage, normalizeMessagesForAPI } from '../messages.js'
import { isClaudeModelName } from '../model/claudeModelName.js'

const midTurnMessage = 'I have finished the schema change.'

function toolTurnWithReminder(): Message[] {
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

describe('text that arrives after a tool result', () => {
  test('is folded into the tool result for Claude models', () => {
    const last = normalizeMessagesForAPI(toolTurnWithReminder(), [], { foldIntoToolResults: true }).at(-1)!

    const content = last.message.content as Array<{ type: string; content?: unknown }>
    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
    expect(String(content[0]!.content)).toStartWith('12 pass\n\n')
    expect(String(content[0]!.content)).toContain(midTurnMessage)
  })

  test('stays a separate text block for other models', () => {
    const last = normalizeMessagesForAPI(toolTurnWithReminder(), [], { foldIntoToolResults: false }).at(-1)!

    const content = last.message.content as Array<{ type: string; text?: string }>
    expect(content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 pass' })
    expect(content.slice(1).map(block => block.type)).toEqual(['text'])
    expect(content[1]!.text).toContain(midTurnMessage)
  })

  test.each([
    ['claude-sonnet-4-6', true],
    ['Claude-Opus-4-7', true],
    ['glm-5.1', false],
    ['deepseek-chat', false],
    [undefined, false],
  ])('treats %s as a Claude model: %s', (model, expected) => {
    expect(isClaudeModelName(model)).toBe(expected)
  })
})
