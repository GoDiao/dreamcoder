import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage, nestedMemoryPathsInHistory } from '../attachments.js'
import { withoutRepeatedSessionStartContext } from '../conversationRecovery.js'
import { createUserMessage } from '../messages.js'

function sessionStartContext(content: string[]): Message {
  return createAttachmentMessage({
    type: 'hook_additional_context',
    content,
    hookName: 'SessionStart',
    toolUseID: 'SessionStart',
    hookEvent: 'SessionStart',
  })
}

describe('context a restarted CLI already has in its history', () => {
  test('nested instruction files already attached are found in the history', () => {
    const history = [
      createUserMessage({ content: 'read desktop/src/foo.tsx' }),
      createAttachmentMessage({
        type: 'nested_memory',
        path: '/repo/desktop/CLAUDE.md',
        content: { path: '/repo/desktop/CLAUDE.md', type: 'Project', content: 'rules' },
        displayPath: 'desktop/CLAUDE.md',
      } as never),
    ]

    expect(nestedMemoryPathsInHistory(history)).toEqual(['/repo/desktop/CLAUDE.md'])
  })

  test('SessionStart output identical to the last one in the history is not appended again', () => {
    const history = [createUserMessage({ content: 'hi' }), sessionStartContext(['branch: main'])]

    expect(withoutRepeatedSessionStartContext(history, [sessionStartContext(['branch: main'])])).toEqual([])
  })

  test('SessionStart output that changed is appended', () => {
    const history = [sessionStartContext(['branch: main'])]
    const changed = sessionStartContext(['branch: feature'])

    expect(withoutRepeatedSessionStartContext(history, [changed])).toEqual([changed])
  })
})
