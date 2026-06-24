import { describe, expect, test } from 'bun:test'
import { getAttributionHeader } from './system.js'

describe('getAttributionHeader', () => {
  test('uses Claude Code compatibility version and always includes CCH placeholder', () => {
    const originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'

    try {
      expect(getAttributionHeader('abc')).toBe(
        'x-anthropic-billing-header: cc_version=2.1.92.abc; cc_entrypoint=cli; cch=00000;',
      )
    } finally {
      if (originalEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
      else process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint
    }
  })
})
