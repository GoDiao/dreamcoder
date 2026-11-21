import { describe, expect, test } from 'bun:test'
import type { Command } from '../../commands.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage, skillListingForHistory } from '../attachments.js'
import { normalizeAttachmentForAPI } from '../messages.js'

function skill(name: string): Command {
  return {
    type: 'prompt',
    name,
    description: `The ${name} skill`,
    source: 'bundled',
    loadedFrom: 'bundled',
    progressMessage: '',
    contentLength: 0,
    getPromptForCommand: async () => [],
  } as unknown as Command
}

function announce(names: string[], history: Message[]) {
  return skillListingForHistory(names.map(skill), history, 200_000)
}

function textOf(message: Message): string {
  if (message.type !== 'user') return ''
  const content = message.message.content
  return typeof content === 'string' ? content : content.map(block => ('text' in block ? block.text : '')).join('')
}

describe('skill listing derived from the conversation history', () => {
  test('an empty history gets the full list', () => {
    const listing = announce(['slides', 'design'], [])

    expect(listing).toMatchObject({ type: 'skill_listing', skillNames: ['slides', 'design'], isInitial: true })
  })

  test('skills already listed in the history are not listed again, as after a restart', () => {
    const first = announce(['slides', 'design'], [])!
    const history = [createAttachmentMessage(first)]

    expect(announce(['slides', 'design'], history)).toBeNull()
  })

  test('a skill added to the skill directories is listed on its own', () => {
    const history = [createAttachmentMessage(announce(['slides', 'design'], [])!)]

    const delta = announce(['slides', 'design', 'release'], history)

    expect(delta).toMatchObject({ skillNames: ['release'], isInitial: false })
    expect(delta!.content).not.toContain('slides')
  })

  test('after compaction removes the earlier listing, the full list is sent again', () => {
    const summaryOnly = [createAttachmentMessage({ type: 'date_change', newDate: '2026-11-18' } as never)]

    expect(announce(['slides', 'design'], summaryOnly)).toMatchObject({ skillNames: ['slides', 'design'], isInitial: true })
  })

  test('a later listing says the skills are added to the earlier ones', () => {
    const history = [createAttachmentMessage(announce(['slides'], [])!)]
    const delta = announce(['slides', 'release'], history)!

    const rendered = normalizeAttachmentForAPI(delta).map(textOf).join('')

    expect(rendered).toContain('also available')
    expect(rendered).toContain('- release:')
  })
})
