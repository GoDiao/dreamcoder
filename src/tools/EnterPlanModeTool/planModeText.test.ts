import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Message } from '../../types/message.js'
import { normalizeAttachmentForAPI } from '../../utils/messages.js'
import { EnterPlanModeTool } from './EnterPlanModeTool.js'
import { getEnterPlanModeToolPrompt } from './prompt.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
const configDir = mkdtempSync(join(tmpdir(), 'plan-mode-text-'))

beforeAll(() => {
  process.env.DREAMCODER_CONFIG_DIR = configDir
})

afterAll(() => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  rmSync(configDir, { recursive: true, force: true })
})

function textOf(messages: Message[]): string {
  return messages
    .map(message => {
      if (message.type !== 'user') return ''
      const content = message.message.content
      return typeof content === 'string' ? content : content.map(block => ('text' in block ? block.text : '')).join('')
    })
    .join('')
}

function planModeReminder(reminderType: 'full' | 'sparse'): string {
  return textOf(
    normalizeAttachmentForAPI({
      type: 'plan_mode',
      reminderType,
      planFilePath: '/plans/fix.md',
      planExists: false,
    } as never),
  )
}

describe('plan mode has one procedure', () => {
  test('the tool description leaves the procedure to the plan mode reminder', () => {
    expect(getEnterPlanModeToolPrompt()).not.toContain('What Happens in Plan Mode')
  })

  test('the tool result allows writing the plan file', () => {
    const result = JSON.stringify(
      EnterPlanModeTool.mapToolResultToToolResultBlockParam({ message: 'Entered plan mode.' }, 'toolu_1'),
    )

    expect(result).not.toContain('DO NOT write or edit any files yet')
    expect(result).toContain('except the plan file')
  })

  test('the reminder is the iterative workflow, without required subagents', () => {
    const reminder = planModeReminder('full')

    expect(reminder).toContain('/plans/fix.md')
    expect(reminder).toContain('Iterative Planning Workflow')
    expect(reminder).not.toContain('Phase 1')
    expect(reminder).not.toContain('Launch at least 1 Plan agent')
  })

  test('the short reminder names the same workflow', () => {
    const reminder = planModeReminder('sparse')

    expect(reminder).toContain('/plans/fix.md')
    expect(reminder).not.toContain('5-phase')
  })
})
