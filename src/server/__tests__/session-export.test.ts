import { describe, expect, test } from 'bun:test'
import * as os from 'node:os'
import { diagnosticsService } from '../services/diagnosticsService.js'
import { closeOpenFences, exportFileName, renderSessionJson, renderSessionMarkdown, TOOL_OUTPUT_LINES } from '../transcript/export.js'
import type { SessionTranscript, TranscriptItem } from '../transcript/items.js'

const longOutput = Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join('\n')
// Built at runtime so secret scanners don't flag a fake key in the source.
const SECRET = ['sk', 'ant', 'api03', 'x'.repeat(20)].join('-')

const items: TranscriptItem[] = [
  {
    id: 'u1', type: 'user_text', content: 'Fix the login bug', timestamp: 1,
    attachments: [{ type: 'image', name: 'screenshot.png', data: 'AAAA', mimeType: 'image/png' }],
  },
  { id: 't1', type: 'thinking', content: 'Let me look at auth.ts first.', timestamp: 2 },
  { id: 'a1', type: 'assistant_text', content: 'I will check the code.', timestamp: 3 },
  { id: 'r1', type: 'tool_use', toolName: 'Read', toolUseId: 'read-1', input: { file_path: 'src/auth.ts' }, timestamp: 4 },
  { id: 'r1r', type: 'tool_result', toolUseId: 'read-1', content: 'export const token = 1', isError: false, timestamp: 5 },
  { id: 'b1', type: 'tool_use', toolName: 'Bash', toolUseId: 'bash-1', input: { command: 'ls -la', description: 'List files' }, timestamp: 6 },
  { id: 'b1r', type: 'tool_result', toolUseId: 'bash-1', content: longOutput, isError: false, timestamp: 7 },
  { id: 'e1', type: 'tool_use', toolName: 'Edit', toolUseId: 'edit-1', input: { file_path: 'src/auth.ts', old_string: 'a = 1', new_string: 'a = 2' }, timestamp: 8 },
  { id: 'e1r', type: 'tool_result', toolUseId: 'edit-1', content: 'old_string not found', isError: true, timestamp: 9 },
  { id: 'a2', type: 'assistant_text', content: `Use the key ${SECRET} from ${os.homedir()}/secrets`, timestamp: 10 },
]
const transcript: SessionTranscript = { items, agentNotifications: {}, lastTodos: null, hasMessagesAfterTaskCompletion: false }
const meta = { title: 'Fix login', workDir: '/work/app', createdAt: '2026-10-20T00:00:00.000Z', exportedAt: new Date('2026-10-20T08:00:00Z'), appVersion: '0.6.0' }
const redact = (text: string) => diagnosticsService.sanitizeString(text, Number.MAX_SAFE_INTEGER)

describe('session export', () => {
  test('renders a readable Markdown transcript with defaults', () => {
    const md = renderSessionMarkdown(transcript, meta, { includeThinking: false, fullToolOutput: false })
    expect(md.startsWith('# Fix login\n')).toBe(true)
    expect(md).toContain('## User\n\nFix the login bug')
    expect(md).toContain('_Attachments: image `screenshot.png` (not included)_')
    expect(md).not.toContain('AAAA')
    expect(md).not.toContain('Let me look at auth.ts')
    expect(md).toContain('**Read** `src/auth.ts`')
    expect(md).not.toContain('export const token')
    expect(md).toContain('**Bash** — List files')
    expect(md).toContain('$ ls -la')
    expect(md).toContain(`line-${TOOL_OUTPUT_LINES}`)
    expect(md).not.toContain(`line-${TOOL_OUTPUT_LINES + 1}\n`)
    expect(md).toContain('… 10 more lines')
    expect(md).toContain('**Edit** `src/auth.ts`')
    expect(md).toContain('- a = 1\n+ a = 2')
    expect(md).toContain('Error:\n```text\nold_string not found')
    // One Assistant heading for the whole reply.
    expect(md.match(/## Assistant/g)).toHaveLength(1)
  })

  test('includes thinking and full output when asked', () => {
    const md = renderSessionMarkdown(transcript, meta, { includeThinking: true, fullToolOutput: true })
    expect(md).toContain('> **Thinking**\n>\n> Let me look at auth.ts first.')
    expect(md).toContain('line-30')
    expect(md).not.toContain('more lines')
  })

  test('redaction removes tokens and the home path', () => {
    const plain = renderSessionMarkdown(transcript, meta, { includeThinking: false, fullToolOutput: false })
    expect(plain).toContain(os.homedir())
    expect(plain).toContain(SECRET)
    const md = renderSessionMarkdown(transcript, meta, { includeThinking: false, fullToolOutput: false, redact })
    expect(md).not.toContain(os.homedir())
    expect(md).not.toContain(SECRET)
    const json = renderSessionJson(transcript, { redact })
    expect(json).not.toContain(os.homedir())
    expect(json).not.toContain(SECRET)
    expect(JSON.parse(json).items).toHaveLength(items.length)
  })

  test('JSON is the transcript as the API returns it', () => {
    expect(JSON.parse(renderSessionJson(transcript))).toEqual(JSON.parse(JSON.stringify(transcript)))
  })

  test('fences cannot be closed by backticks in the content', () => {
    const fenced: SessionTranscript = {
      ...transcript,
      items: [
        { id: 'x', type: 'tool_use', toolName: 'Bash', toolUseId: 'x1', input: { command: 'echo ```' }, timestamp: 1 },
      ],
    }
    const md = renderSessionMarkdown(fenced, meta, { includeThinking: false, fullToolOutput: false })
    expect(md).toContain('````sh\n$ echo ```\n````')
  })

  test('builds file names that work on Windows and macOS', () => {
    const day = new Date('2026-10-20T08:00:00Z')
    expect(exportFileName('Fix login', day, 'markdown')).toBe('2026-10-20-Fix-login.md')
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', day, 'json')).toBe('2026-10-20-a-b-c-d-e-f-g-h-i-j.json')
    expect(exportFileName('修复 登录. ', day, 'markdown')).toBe('2026-10-20-修复-登录.md')
    expect(exportFileName('CON', day, 'markdown')).toBe('2026-10-20-session-CON.md')
    expect(exportFileName('???', day, 'markdown')).toBe('2026-10-20-session.md')
    expect(exportFileName('x'.repeat(200), day, 'markdown')).toBe(`2026-10-20-${'x'.repeat(80)}.md`)
    const emoji = exportFileName(`${'x'.repeat(79)}😀😀`, day, 'markdown')
    expect(emoji).toBe(`2026-10-20-${'x'.repeat(79)}😀.md`)
    expect(emoji.isWellFormed()).toBe(true)
  })

  test('closes a code fence an interrupted reply left open', () => {
    expect(closeOpenFences('text\n```ts\nconst a = 1')).toBe('text\n```ts\nconst a = 1\n```')
    expect(closeOpenFences('```\nok\n```')).toBe('```\nok\n```')
    expect(closeOpenFences('````md\n```\ninner\n```')).toBe('````md\n```\ninner\n```\n````')
    const interrupted: SessionTranscript = {
      ...transcript,
      items: [
        { id: 'a', type: 'assistant_text', content: 'Here:\n```js\nlet x', timestamp: 1 },
        { id: 'u', type: 'user_text', content: 'continue', timestamp: 2 },
      ],
    }
    const md = renderSessionMarkdown(interrupted, meta, { includeThinking: false, fullToolOutput: false })
    expect(md).toContain('let x\n```\n\n## User')
  })
})
