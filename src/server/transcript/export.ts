import type { SessionTranscript, TranscriptAttachment, TranscriptItem } from './items.js'

/**
 * Renders a session for "Export…" (#133). The server only renders; the desktop
 * writes the file the user picked, so this API never takes a path.
 */
export type ExportFormat = 'markdown' | 'json'

export type ExportOptions = {
  includeThinking: boolean
  /** Off: tool results are cut to TOOL_OUTPUT_LINES lines, like the chat's summary. */
  fullToolOutput: boolean
  /** Applied to every string in the output, e.g. the diagnostics redaction. */
  redact?: (text: string) => string
}

export type ExportMeta = {
  title: string
  workDir?: string | null
  createdAt?: string | null
  exportedAt: Date
  appVersion?: string
}

export const TOOL_OUTPUT_LINES = 20
const TOOL_OUTPUT_CHARS = 4000
const TOOL_INPUT_LINES = 40

type ToolUse = Extract<TranscriptItem, { type: 'tool_use' }>
type ToolResult = Extract<TranscriptItem, { type: 'tool_result' }>

/** The transcript exactly as `GET /api/sessions/:id/transcript` returns it, optionally redacted. */
export function renderSessionJson(transcript: SessionTranscript, options: Pick<ExportOptions, 'redact'> = {}): string {
  const value = options.redact ? redactDeep(transcript, options.redact) : transcript
  return `${JSON.stringify(value, null, 2)}\n`
}

export function renderSessionMarkdown(
  transcript: SessionTranscript,
  meta: ExportMeta,
  options: ExportOptions,
): string {
  const results = new Map<string, ToolResult>()
  for (const item of transcript.items) {
    if (item.type === 'tool_result') results.set(item.toolUseId, item)
  }

  const out: string[] = [`# ${oneLine(meta.title) || 'Untitled session'}`, '']
  if (meta.workDir) out.push(`- Project: \`${meta.workDir}\``)
  if (meta.createdAt) out.push(`- Started: ${meta.createdAt}`)
  out.push(`- Exported: ${meta.exportedAt.toISOString()}${meta.appVersion ? ` from DreamCoder ${meta.appVersion}` : ''}`)
  out.push('')

  let speaker: 'user' | 'assistant' | null = null
  const startTurn = (next: 'user' | 'assistant') => {
    if (speaker === next) return
    speaker = next
    out.push(next === 'user' ? '## User' : '## Assistant', '')
  }
  const renderedResults = new Set<string>()

  for (const item of transcript.items) {
    switch (item.type) {
      case 'user_text': {
        speaker = null
        startTurn('user')
        out.push(closeOpenFences(item.content.trim()) || '_(empty message)_', '')
        const attachments = (item.attachments ?? []).map(describeAttachment)
        if (attachments.length > 0) out.push(`_Attachments: ${attachments.join(', ')}_`, '')
        break
      }
      case 'assistant_text':
        startTurn('assistant')
        out.push(closeOpenFences(item.content.trim()), '')
        break
      case 'thinking':
        if (!options.includeThinking || !item.content.trim()) break
        startTurn('assistant')
        out.push('> **Thinking**', '>', ...item.content.trim().split('\n').map((line) => (line ? `> ${line}` : '>')), '')
        break
      case 'tool_use': {
        startTurn('assistant')
        const result = results.get(item.toolUseId)
        if (result) renderedResults.add(item.toolUseId)
        out.push(...renderTool(item, result, options), '')
        break
      }
      case 'tool_result':
        // Results are shown under their call; one without a call is shown on its own.
        if (renderedResults.has(item.toolUseId)) break
        startTurn('assistant')
        out.push(...renderResult(item, options), '')
        break
      case 'compact_summary':
        speaker = null
        out.push('---', '', `_${oneLine(item.title)}_`, '')
        break
      case 'goal_event':
        out.push(`_Goal ${item.action}${item.objective ? `: ${oneLine(item.objective)}` : ''}_`, '')
        break
      case 'memory_event':
        out.push(`_Memory saved: ${item.files.map((file) => `\`${file.path}\``).join(', ')}_`, '')
        break
    }
  }

  const markdown = `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
  return options.redact ? options.redact(markdown) : markdown
}

function renderTool(item: ToolUse, result: ToolResult | undefined, options: ExportOptions): string[] {
  const input = (item.input && typeof item.input === 'object' ? item.input : {}) as Record<string, unknown>
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  const sub = item.parentToolUseId ? ' (subagent)' : ''
  const lines: string[] = []

  switch (item.toolName) {
    case 'Bash':
      lines.push(`**Bash**${sub}${str('description') ? ` — ${oneLine(str('description'))}` : ''}`, ...fence(`$ ${str('command')}`, 'sh'))
      break
    case 'Edit': {
      const diff = [
        ...str('old_string').split('\n').map((line) => `- ${line}`),
        ...str('new_string').split('\n').map((line) => `+ ${line}`),
      ]
      lines.push(`**Edit**${sub} \`${str('file_path')}\``, ...fence(limitLines(diff, TOOL_INPUT_LINES).join('\n'), 'diff'))
      break
    }
    case 'Write': {
      const lineCount = str('content').split('\n').length
      lines.push(`**Write**${sub} \`${str('file_path')}\` (${lineCount} ${lineCount === 1 ? 'line' : 'lines'})`)
      break
    }
    case 'Read':
      lines.push(`**Read**${sub} \`${str('file_path')}\``)
      // The file's contents are not repeated, as in the chat.
      return result?.isError ? [...lines, ...renderResult(result, options)] : lines
    case 'Glob':
    case 'Grep':
      lines.push(`**${item.toolName}**${sub} \`${str('pattern')}\`${str('path') ? ` in \`${str('path')}\`` : ''}`)
      break
    case 'WebFetch':
      lines.push(`**WebFetch**${sub} ${str('url')}`)
      break
    case 'WebSearch':
      lines.push(`**WebSearch**${sub} ${oneLine(str('query'))}`)
      break
    default: {
      const json = JSON.stringify(item.input ?? {}, null, 2)
      lines.push(`**${item.toolName}**${sub}`, ...fence(limitLines(json.split('\n'), TOOL_INPUT_LINES).join('\n'), 'json'))
    }
  }

  if (result) lines.push(...renderResult(result, options))
  return lines
}

function renderResult(result: ToolResult, options: ExportOptions): string[] {
  const text = resultText(result.content).replace(/\x1B\[[0-9;]*m/g, '').trimEnd()
  if (!text) return result.isError ? ['Error (no output)'] : []
  let body = text
  if (!options.fullToolOutput) {
    body = limitLines(text.split('\n'), TOOL_OUTPUT_LINES).join('\n')
    if (body.length > TOOL_OUTPUT_CHARS) body = `${body.slice(0, TOOL_OUTPUT_CHARS)}\n… (truncated)`
  }
  return [result.isError ? 'Error:' : 'Output:', ...fence(body, 'text')]
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object') {
          const typed = block as { type?: string; text?: string }
          if (typed.type === 'image') return '[image]'
          if (typeof typed.text === 'string') return typed.text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2)
  return ''
}

function describeAttachment(attachment: TranscriptAttachment): string {
  if (attachment.type === 'image') return `image \`${attachment.name}\` (not included)`
  return `file \`${'path' in attachment ? attachment.path : attachment.name}\``
}

function limitLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines
  const rest = lines.length - max
  return [...lines.slice(0, max), `… ${rest} more ${rest === 1 ? 'line' : 'lines'}`]
}

/** A fence longer than any backtick run inside, so content cannot close it early. */
function fence(body: string, language: string): string[] {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const marker = '`'.repeat(Math.max(3, longest + 1))
  return [`${marker}${language}`, body, marker]
}

/**
 * Closes a code fence left open, e.g. by a reply that was interrupted while
 * streaming, so it cannot swallow the rest of the export.
 */
export function closeOpenFences(text: string): string {
  let open: string | null = null
  for (const line of text.split('\n')) {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1]
    if (!marker) continue
    if (open === null) open = marker
    else if (marker[0] === open[0] && marker.length >= open.length && line.trim() === marker) open = null
  }
  return open === null ? text : `${text}\n${open}`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function redactDeep(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, redact))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactDeep(entry, redact)]))
  }
  return value
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * `<YYYY-MM-DD>-<title>.<ext>`, safe on macOS, Windows and Linux: no reserved
 * characters, no trailing dots or spaces, no reserved device names.
 */
export function exportFileName(title: string, date: Date, format: ExportFormat): string {
  const day = date.toISOString().slice(0, 10)
  let name: string = title
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-. ]+$/g, '')
  // Cut by character, not UTF-16 unit, so an emoji is never split in half.
  name = Array.from(name).slice(0, 80).join('').replace(/[-. ]+$/g, '')
  if (!name || WINDOWS_RESERVED.test(name)) name = name ? `session-${name}` : 'session'
  return `${day}-${name}.${format === 'json' ? 'json' : 'md'}`
}
