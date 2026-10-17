/**
 * Recognizers for the special content the CLI writes into a transcript:
 * local command breadcrumbs, `/goal` output, compaction summaries, task
 * notifications, teammate messages and leading file references.
 *
 * History interpretation (`entries.ts`, `history.ts`) and the live WebSocket
 * translator (`ws/handler.ts`) share these rules.
 */
import type { MemoryEventFile } from './items.js'

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

/** Resource use a background task reports when it finishes or progresses. */
export type TaskUsage = {
  totalTokens?: number
  toolUses?: number
  durationMs?: number
}

/** A background task's state as one CLI `task_started`, `task_progress` or `task_notification` message reports it. */
export type BackgroundTaskEvent = {
  taskId: string
  toolUseId?: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  description?: string
  taskType?: string
  workflowName?: string
  prompt?: string
  summary?: string
  lastToolName?: string
  outputFile?: string
  usage?: TaskUsage
}

export type TaskNotification = {
  taskId: string
  toolUseId: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
  result?: string
  outputFile?: string
  usage?: TaskUsage
  timestamp?: string
}

export type FileReference = {
  type: 'file'
  name: string
  path: string
}

/**
 * Local-command tags are read the way Claude Code displays them: only
 * `&amp;`, `&lt;` and `&gt;` are decoded.
 */
function decodeLocalCommandText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Returns the trimmed, entity-decoded body of the first `<tag>…</tag>`; `''` for an empty tag. */
export function readXmlTag(
  xml: string,
  tag: string,
  decode: (text: string) => string = decodeXmlText,
): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decode((match[1] ?? '').trim()) : undefined
}

function readLocalCommandTag(text: string, tag: string): string | undefined {
  return readXmlTag(text, tag, decodeLocalCommandText)
}

/** A string, or the `text` of every block in a content array joined by newlines. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? [text] : []
    })
    .join('\n')
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
  const text = contentText(content).trim()
  if (!text) return null
  const commandName = readLocalCommandTag(text, 'command-name')
  if (!commandName) return null
  return {
    name: commandName.replace(/^\//, ''),
    args: readLocalCommandTag(text, 'command-args') ?? '',
  }
}

export function formatLocalCommand(command: LocalCommand): string {
  const normalizedName = command.name.replace(/^\//, '')
  const args = command.args.trim()
  return `/${normalizedName}${args ? ` ${args}` : ''}`
}

/**
 * Returns the `<local-command-stdout>` (or stderr) body of a breadcrumb.
 * `allowUntagged` takes the whole text as output, for the CLI's
 * `local_command_output` messages that carry it without tags.
 */
export function extractLocalCommandOutput(
  content: unknown,
  options: { allowUntagged?: boolean } = {},
): string | null {
  const text = contentText(content).trim()
  if (!text) return null
  const stdout = readLocalCommandTag(text, 'local-command-stdout')
  const stderr = readLocalCommandTag(text, 'local-command-stderr')
  if (stdout === undefined && stderr === undefined) {
    return options.allowUntagged ? text : null
  }
  return stdout || stderr || null
}

/**
 * `/compact` reports `Compacted`, followed by the output of any PreCompact or
 * PostCompact hooks; the compaction card already covers it.
 */
export function isCompactCommandOutput(output: string): boolean {
  return /^Compacted(?:\s|$)/.test(output.trim())
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

/** What the CLI records about a compaction (`compactMetadata` in a transcript, `compact_metadata` live). */
export type CompactMetadata = {
  trigger?: 'manual' | 'auto'
  preTokens?: number
  messagesSummarized?: number
}

/** Reads compaction metadata in either the transcript's camelCase or the stream's snake_case. */
export function readCompactMetadata(raw: unknown): CompactMetadata {
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  const trigger = record.trigger
  const preTokens = record.preTokens ?? record.pre_tokens
  const messagesSummarized = record.messagesSummarized ?? record.messages_summarized
  return {
    ...(trigger === 'manual' || trigger === 'auto' ? { trigger } : {}),
    ...(typeof preTokens === 'number' ? { preTokens } : {}),
    ...(typeof messagesSummarized === 'number' ? { messagesSummarized } : {}),
  }
}

/** A CLI `memory_saved` event (`writtenPaths`, `teamCount`, `message`), or null when it saved nothing. */
export function parseMemorySaved(
  data: unknown,
): { files: MemoryEventFile[]; message?: string; teamCount?: number } | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const files = Array.isArray(record.writtenPaths)
    ? record.writtenPaths
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .map((path) => ({ path, action: 'saved' as const }))
    : []
  if (files.length === 0) return null
  const teamCount = record.teamCount
  return {
    files,
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
    ...(typeof teamCount === 'number' && Number.isFinite(teamCount) ? { teamCount } : {}),
  }
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

function readNonEmptyString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readTaskUsage(value: unknown): TaskUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const usage: TaskUsage = {}
  const totalTokens = record.total_tokens ?? record.totalTokens
  const toolUses = record.tool_uses ?? record.toolUses
  const durationMs = record.duration_ms ?? record.durationMs
  if (typeof totalTokens === 'number') usage.totalTokens = totalTokens
  if (typeof toolUses === 'number') usage.toolUses = toolUses
  if (typeof durationMs === 'number') usage.durationMs = durationMs
  return Object.keys(usage).length > 0 ? usage : undefined
}

export type BackgroundTaskMessageSubtype = 'task_started' | 'task_progress' | 'task_notification'

/**
 * Reads a CLI background-task message. A `task_notification` is terminal
 * and also yields the notification the task's tool card shows.
 */
export function parseBackgroundTaskMessage(
  data: unknown,
  subtype: BackgroundTaskMessageSubtype,
): { event: BackgroundTaskEvent; notification?: TaskNotification } | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const taskId = readNonEmptyString(record, 'task_id', 'taskId')
  const toolUseId = readNonEmptyString(record, 'tool_use_id', 'toolUseId')
  const id = taskId ?? toolUseId
  if (!id) return null

  const rawStatus = readNonEmptyString(record, 'status')
  const status = rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'stopped'
    ? rawStatus
    : rawStatus === 'killed'
      ? 'stopped'
      : subtype === 'task_notification'
        ? 'completed'
        : 'running'

  const event: BackgroundTaskEvent = {
    taskId: id,
    status,
    ...optional('toolUseId', toolUseId),
    ...optional('description', readNonEmptyString(record, 'description', 'message', 'title')),
    ...optional('taskType', readNonEmptyString(record, 'task_type', 'taskType')),
    ...optional('workflowName', readNonEmptyString(record, 'workflow_name', 'workflowName')),
    ...optional('prompt', readNonEmptyString(record, 'prompt')),
    ...optional('summary', readNonEmptyString(record, 'summary')),
    ...optional('lastToolName', readNonEmptyString(record, 'last_tool_name', 'lastToolName')),
    ...optional('outputFile', readNonEmptyString(record, 'output_file', 'outputFile')),
    ...optional('usage', readTaskUsage(record.usage)),
  }

  const notificationToolUseId = typeof record.tool_use_id === 'string' && record.tool_use_id.trim()
    ? record.tool_use_id
    : undefined
  const terminal = rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'stopped'
    ? rawStatus
    : undefined
  if (subtype !== 'task_notification' || !notificationToolUseId || !terminal) return { event }

  return {
    event,
    notification: {
      taskId: event.taskId,
      toolUseId: notificationToolUseId,
      status: terminal,
      ...optional('summary', event.summary),
      ...optional('result', readNonEmptyString(record, 'result')),
      ...optional('outputFile', event.outputFile),
      ...optional('usage', event.usage),
    },
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}
