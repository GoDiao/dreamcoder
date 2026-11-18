import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import { deserializeMessagesWithInterruptDetection } from '../conversationRecovery.js'
import {
  createAssistantMessage,
  createUserInterruptionMessage,
  createUserMessage,
  normalizeMessagesForAPI,
} from '../messages.js'

function textOf(message: Message): string {
  if (message.type !== 'user' && message.type !== 'assistant') return ''
  const content = message.message.content
  if (typeof content === 'string') return content
  return content.map(block => ('text' in block && typeof block.text === 'string' ? block.text : '')).join('')
}

function toolTurn(): Message[] {
  return [
    createUserMessage({ content: 'run the tests' }),
    createAssistantMessage({
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'bun test' } }] as never,
    }),
    createUserMessage({
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '3 pass' }],
      toolUseResult: '3 pass',
    }),
  ]
}

describe('resuming a transcript without auto-continue', () => {
  test('a turn that stopped after a tool result gets no synthetic continuation or reply', () => {
    const { messages, turnInterruptionState } = deserializeMessagesWithInterruptDetection(toolTurn())

    expect(messages.map(textOf)).not.toContain('Continue from where you left off.')
    expect(messages.map(textOf)).not.toContain('No response requested.')
    expect(messages).toHaveLength(3)
    expect(turnInterruptionState.kind).toBe('interrupted_turn')
  })

  test('a turn the user interrupted keeps the interruption marker as the last message', () => {
    const transcript = [
      createUserMessage({ content: 'refactor the parser' }),
      createAssistantMessage({ content: 'Looking at the parser.' }),
      createUserInterruptionMessage({ toolUse: false }),
    ]

    const { messages } = deserializeMessagesWithInterruptDetection(transcript)

    expect(messages.map(textOf)).toEqual(['refactor the parser', 'Looking at the parser.', '[Request interrupted by user]'])
  })

  test("the user's next message joins the interrupted turn into a valid request", () => {
    const { messages } = deserializeMessagesWithInterruptDetection(toolTurn())
    const next = createUserMessage({ content: 'use plan B instead' })

    const forApi = normalizeMessagesForAPI([...messages, next])

    expect(forApi.map(message => message.type)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(forApi.at(-1)!.message.content)).toContain('use plan B instead')
  })
})
