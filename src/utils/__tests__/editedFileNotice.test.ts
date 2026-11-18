import { describe, expect, test } from 'bun:test'
import { getSnippetForTwoFileDiff } from '../../tools/FileEditTool/utils.js'
import type { Message } from '../../types/message.js'
import { normalizeAttachmentForAPI } from '../messages.js'

function textOf(messages: Message[]): string {
  return messages
    .map(message => {
      if (message.type !== 'user') return ''
      const content = message.message.content
      return typeof content === 'string' ? content : content.map(block => ('text' in block ? block.text : '')).join('')
    })
    .join('')
}

describe('notice for a file changed after the model read it', () => {
  test('does not guess who changed it and does not ask the model to keep it from the user', () => {
    const notice = textOf(
      normalizeAttachmentForAPI({ type: 'edited_text_file', filename: '/repo/api.ts', snippet: '1\tconst a = 1' }),
    )

    expect(notice).toContain('/repo/api.ts')
    expect(notice).toContain('const a = 1')
    expect(notice).not.toContain('linter')
    expect(notice).not.toContain("Don't tell the user")
    expect(notice).toContain('another session')
  })

  test('keeps a large change to about 2 KB and points to Read for the rest', () => {
    const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
    const after = Array.from({ length: 400 }, (_, i) => `changed line ${i} with a longer body`).join('\n')

    const snippet = getSnippetForTwoFileDiff(before, after)

    expect(snippet.length).toBeLessThan(2_200)
    expect(snippet).toContain('lines truncated')
    expect(snippet).toContain('Read the file')
  })
})
