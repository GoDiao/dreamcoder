import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import { getTaskReminderTurnCounts } from '../attachments.js'
import { createAssistantMessage, normalizeMessages } from '../messages.js'

function responses(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => {
    const message = createAssistantMessage({
      content: [
        { type: 'text', text: `response ${index}` },
        {
          type: 'tool_use',
          id: `tool-${index}`,
          name: 'Bash',
          input: { command: 'pwd' },
        },
        { type: 'text', text: 'done' },
      ] as never,
    })
    message.requestId = `request-${index}`
    return normalizeMessages([message])
  }).flat()
}

describe('getTaskReminderTurnCounts', () => {
  test('reaches the reminder threshold after ten complete responses', () => {
    expect(getTaskReminderTurnCounts(responses(9))).toEqual({
      turnsSinceLastTaskManagement: 9,
      turnsSinceLastReminder: 9,
    })
    expect(getTaskReminderTurnCounts(responses(10))).toEqual({
      turnsSinceLastTaskManagement: 10,
      turnsSinceLastReminder: 10,
    })
  })

  test('detects task updates in any content block of a response', () => {
    const message = createAssistantMessage({
      content: [
        { type: 'text', text: 'updating the task' },
        {
          type: 'tool_use',
          id: 'task-update',
          name: 'TaskUpdate',
          input: { taskId: '1', status: 'completed' },
        },
        { type: 'text', text: 'updated' },
      ] as never,
    })
    message.requestId = 'task-request'

    expect(getTaskReminderTurnCounts(normalizeMessages([message]))).toEqual({
      turnsSinceLastTaskManagement: 0,
      turnsSinceLastReminder: 1,
    })
  })

  test('keeps counting assistant messages without request ids individually', () => {
    const messages = [
      createAssistantMessage({ content: 'first' }),
      createAssistantMessage({ content: 'second' }),
    ]

    expect(getTaskReminderTurnCounts(messages)).toEqual({
      turnsSinceLastTaskManagement: 2,
      turnsSinceLastReminder: 2,
    })
  })
})
