/**
 * Recognizers for the special content the CLI writes into a transcript:
 * local command breadcrumbs, `/goal` output, compaction summaries, task
 * notifications, teammate messages and leading file references.
 *
 * History interpretation (`entries.ts`, `history.ts`) and the live WebSocket
 * translator share these rules. The live translator still reads local-command
 * tags with its own helpers in `ws/handler.ts`, which also accept content
 * arrays and untagged output.
 */

export const COMPACT_SUMMARY_PREFIX =
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.'

const COMPACT_SUMMARY_CUTOFFS = [
  '\n\nIf you need specific details from before compaction',
  '\n\nContinue the conversation from where it left off',
  '\nContinue the conversation from where it left off',
]

const TASK_NOTIFICATION_RE = /^<task-notification>\s*[\s\S]*<\/task-notification>$/i
const TASK_NOTIFICATION_BLOCK_RE = /<task-notification>\s*[\s\S]*?<\/task-notification>/i
const TEAMMATE_CONTENT_RE = /<teammate-message\s+teammate_id="([^"]+)"[^>]*>\n?([\s\S]*?)\n?<\/teammate-message>/g

/** Teammate protocol messages that are bookkeeping, not visible conversation. */
export const AGENT_LIFECYCLE_TYPES = new Set([
  'shutdown_approved',
  'shutdown_rejected',
  'shutdown_request',
  'teammate_terminated',
  'idle_notification',
])

export type GoalEventAction =
  | 'created'
  | 'replaced'
  | 'status'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'cleared'
  | 'message'

export type GoalEvent = {
  action: GoalEventAction
  status?: string
  objective?: string
  budget?: string
  elapsed?: string
  continuations?: string
  message?: string
}

export type LocalCommand = { name: string; args: string }

export type TaskNotification = {
  taskId: string
  toolUseId: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
  result?: string
  outputFile?: string
  timestamp?: string
}

export type FileReference = {
  type: 'file'
  name: string
  path: string
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Returns the trimmed, entity-decoded body of the first `<tag>…</tag>`. */
export function readXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1] ? decodeXmlText(match[1].trim()) : undefined
}

/** Non-empty, trimmed text of a string or of the `text` blocks in a content array. */
export function extractTextBlocks(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []

  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .map((text) => text.trim())
    .filter(Boolean)
}

/** Parses a `<command-name>` breadcrumb into a command name (without `/`) and args. */
export function parseLocalCommand(content: unknown): LocalCommand | null {
  if (typeof content !== 'string') return null
  const text = content.trim()
  if (!text) return null
  const commandName = readXmlTag(text, 'command-name')
  if (!commandName) return null
  return {
    name: commandName.replace(/^\//, ''),
    args: readXmlTag(text, 'command-args') ?? '',
  }
}

export function formatLocalCommand(command: LocalCommand): string {
  const normalizedName = command.name.replace(/^\//, '')
  const args = command.args.trim()
  return `/${normalizedName}${args ? ` ${args}` : ''}`
}

/** Returns the `<local-command-stdout>` (or stderr) body of a breadcrumb string. */
export function extractLocalCommandOutput(content: unknown): string | null {
  if (typeof content !== 'string') return null
  const text = content.trim()
  if (!text) return null
  return readXmlTag(text, 'local-command-stdout') ?? readXmlTag(text, 'local-command-stderr') ?? null
}

/** `/compact` reports `Compacted`; the compaction card already covers it. */
export function isCompactCommandOutput(output: string): boolean {
  return output.trim() === 'Compacted'
}

export function isGoalCommandOutput(output: string): boolean {
  const trimmed = output.trim()
  return (
    trimmed.startsWith('Goal set:') ||
    trimmed.startsWith('Goal cleared:') ||
    trimmed === 'Goal cleared.' ||
    trimmed === 'Goal marked complete.' ||
    trimmed === 'No active goal.'
  )
}

/**
 * Turns `/goal` command output into a goal event. When the issuing command is
 * known and is not `/goal`, the output is not a goal event.
 */
export function parseGoalEvent(output: string, command?: LocalCommand | null): GoalEvent | null {
  if (command && command.name !== 'goal') return null

  const trimmed = output.trim()
  if (!trimmed) return null

  if (trimmed === 'Goal cleared.' || trimmed.startsWith('Goal cleared:')) {
    return { action: 'cleared', message: trimmed }
  }
  if (trimmed === 'Goal marked complete.') {
    return { action: 'completed', message: trimmed }
  }
  if (trimmed === 'No active goal.') {
    return { action: 'message', message: trimmed }
  }

  if (trimmed.startsWith('Goal set:')) {
    const objective = trimmed.slice('Goal set:'.length).trim()
    return {
      action: 'created',
      status: 'active',
      objective: objective || undefined,
      message: trimmed,
    }
  }

  return command?.name === 'goal' ? { action: 'message', message: trimmed } : null
}

export function isCompactSummaryContent(content: unknown): content is string {
  return typeof content === 'string' && content.trim().startsWith(COMPACT_SUMMARY_PREFIX)
}

/** Returns the summary text of a compaction message, without the CLI's boilerplate. */
export function extractCompactSummary(content: unknown): string | null {
  if (!isCompactSummaryContent(content)) return null

  let summary = content.trim().slice(COMPACT_SUMMARY_PREFIX.length).trim()
  for (const marker of COMPACT_SUMMARY_CUTOFFS) {
    const index = summary.indexOf(marker)
    if (index >= 0) {
      summary = summary.slice(0, index).trim()
    }
  }
  return summary || null
}

function extractTaskNotificationXml(text: string): string | null {
  const trimmed = text.trim()
  if (TASK_NOTIFICATION_RE.test(trimmed)) return trimmed
  return trimmed.match(TASK_NOTIFICATION_BLOCK_RE)?.[0] ?? null
}

/** True when every text block of the message is a `<task-notification>`. */
export function isTaskNotificationContent(content: unknown): boolean {
  const textBlocks = extractTextBlocks(content)
  return textBlocks.length > 0 && textBlocks.every((text) => extractTaskNotificationXml(text) !== null)
}

/** Parses the first terminal `<task-notification>` in a message. */
export function parseTaskNotification(content: unknown, timestamp?: string): TaskNotification | null {
  const xml = extractTextBlocks(content)
    .map((text) => extractTaskNotificationXml(text))
    .find((value): value is string => value !== null)
  if (!xml) return null

  const toolUseId = readXmlTag(xml, 'tool-use-id')
  const status = readXmlTag(xml, 'status')
  if (
    !toolUseId ||
    (status !== 'completed' && status !== 'failed' && status !== 'stopped')
  ) {
    return null
  }

  const taskId = readXmlTag(xml, 'task-id') || toolUseId
  const summary = readXmlTag(xml, 'summary')
  const result = readXmlTag(xml, 'result')
  const outputFile = readXmlTag(xml, 'output-file')
  return {
    taskId,
    toolUseId,
    status,
    ...(summary ? { summary } : {}),
    ...(result ? { result } : {}),
    ...(outputFile ? { outputFile } : {}),
    ...(timestamp ? { timestamp } : {}),
  }
}

export function isTeammateMessage(text: string): boolean {
  return text.includes('<teammate-message') && text.includes('</teammate-message>')
}

function isLifecycleMessage(content: string): boolean {
  if (!content.startsWith('{') || !content.endsWith('}')) return false
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return typeof parsed.type === 'string' && AGENT_LIFECYCLE_TYPES.has(parsed.type)
  } catch {
    return false
  }
}

/** Visible teammate messages in a text, with the sender's teammate id. */
export function extractTeammateMessages(text: string): Array<{ teammateId: string; content: string }> {
  const messages: Array<{ teammateId: string; content: string }> = []
  for (const match of text.matchAll(TEAMMATE_CONTENT_RE)) {
    const content = match[2]?.trim()
    if (!match[1] || !content || isLifecycleMessage(content)) continue
    messages.push({ teammateId: match[1], content })
  }
  return messages
}

function referenceName(referencePath: string): string {
  const normalized = referencePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const name = normalized.split('/').filter(Boolean).pop()
  return name || referencePath
}

/**
 * Splits the CLI's leading `@"path"` mentions off a user prompt. `modelContent`
 * keeps the original text, which rewind matching compares against.
 */
export function extractLeadingFileReferences(text: string): {
  content: string
  attachments?: FileReference[]
  modelContent?: string
} {
  const attachments: FileReference[] = []
  let remaining = text

  while (true) {
    const match = remaining.match(/^@"([^"]+)"\s*/)
    if (!match?.[1]) break

    attachments.push({ type: 'file', name: referenceName(match[1]), path: match[1] })
    remaining = remaining.slice(match[0].length)
  }

  if (attachments.length === 0) {
    return { content: text }
  }

  return {
    content: remaining.trimStart(),
    attachments,
    modelContent: text,
  }
}
