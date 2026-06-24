import { describe, expect, it } from 'bun:test'
import type { SerializedMessage } from '../../types/logs.js'
import { deriveFirstPrompt, SessionBranchingError } from '../sessionBranching.js'

describe('sessionBranching', () => {
  it('derives a compact branch title from multiline user text', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: '  first line\n\nsecond    line  ',
      },
    } as SerializedMessage

    expect(deriveFirstPrompt(message)).toBe('first line second line')
  })

  it('keeps branching errors identifiable by code', () => {
    const error = new SessionBranchingError(
      'INVALID_TARGET',
      'targetMessageId must reference a main conversation message',
    )

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SessionBranchingError')
    expect(error.code).toBe('INVALID_TARGET')
  })
})
