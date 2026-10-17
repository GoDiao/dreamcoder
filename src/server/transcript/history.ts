import type { MessageEntry } from './entries.js'
import {
  extractCompactSummary,
  extractLeadingFileReferences,
  extractLocalCommandOutput,
  extractTeammateMessages,
  formatLocalCommand,
  isCompactCommandOutput,
  isTeammateMessage,
  parseGoalEvent,
  parseLocalCommand,
  type LocalCommand,
  type TaskNotification,
} from './classify.js'
import type {
  MemoryEventFile,
  SessionTranscript,
  TodoItem,
  TranscriptAttachment,
  TranscriptItem,
} from './items.js'

type AssistantBlock = { type: string; text?: string; thinking?: string; name?: string; id?: string; input?: unknown }
type UserBlock = {
  type: string
  text?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  source?: { data?: string }
  mimeType?: string
  media_type?: string
  name?: string
}
type CompactSummaryItem = Extract<TranscriptItem, { type: 'compact_summary' }>
type AssistantTextItem = Extract<TranscriptItem, { type: 'assistant_text' }>

export type InterpretOptions = {
  /** Team member transcripts show prompts sent by teammates; the lead's own session hides them. */
  includeTeammateMessages?: boolean
}

const TASK_RELATED_TOOL_NAMES = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])

/** Hands out deterministic ids, suffixing repeats so every item id stays unique. */
function createIdAllocator() {
  const used = new Set<string>()
  return (base: string): string => {
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}#${n}`
    used.add(id)
    return id
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** AskUserQuestion results keep the structured answers in `toolUseResult`. */
function toolResultContent(content: unknown, toolUseResult: unknown): unknown {
  const result = readRecord(toolUseResult)
  const answers = readRecord(result?.answers)
  if (!result || !answers || !Array.isArray(result.questions)) return content
  return { questions: result.questions, answers }
}

function memoryEventFiles(data: unknown): MemoryEventFile[] {
  const writtenPaths = readRecord(data)?.writtenPaths
  if (!Array.isArray(writtenPaths)) return []
  return writtenPaths
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map((path) => ({ path, action: 'saved' as const }))
}

function memoryTeamCount(data: unknown): number | undefined {
  const teamCount = readRecord(data)?.teamCount
  return typeof teamCount === 'number' && Number.isFinite(teamCount) ? teamCount : undefined
}

function teammateContents(text: string): string[] {
  return extractTeammateMessages(text).map((message) => message.content)
}

/**
 * Turns the visible messages of a transcript (from `entriesToMessages`) into
 * display items, in order. Compaction collapses into one summary card, and
 * `/goal` breadcrumbs become a visible command plus a goal event.
 */
export function interpretTranscript(messages: MessageEntry[], options?: InterpretOptions): TranscriptItem[] {
  const includeTeammateMessages = options?.includeTeammateMessages === true
  const items: TranscriptItem[] = []
  const allocateId = createIdAllocator()
  let pendingCommand: LocalCommand | null = null

  const upsertTailCompactSummary = (
    update: Partial<Omit<CompactSummaryItem, 'id' | 'type' | 'timestamp'>>,
    baseId: string,
    timestamp: number,
  ) => {
    const tail = items[items.length - 1]
    if (tail?.type === 'compact_summary') {
      items[items.length - 1] = { ...tail, ...update, title: update.title ?? tail.title, timestamp: tail.timestamp }
      return
    }
    items.push({
      id: allocateId(`${baseId}:compact`),
      type: 'compact_summary',
      title: update.title ?? 'Context compacted',
      ...update,
      timestamp,
    })
  }

  const pushAssistantText = (
    content: string,
    baseId: string,
    timestamp: number,
    model: string | undefined,
    transcriptMessageId: string | undefined,
  ) => {
    if (!content.trim()) return
    const last = items[items.length - 1]
    const canMergeIntoLast =
      last?.type === 'assistant_text' &&
      (transcriptMessageId ? last.transcriptMessageId === transcriptMessageId : !last.transcriptMessageId)
    if (canMergeIntoLast) {
      const merged: AssistantTextItem = { ...last, content: last.content + content }
      if (model && !merged.model) merged.model = model
      if (transcriptMessageId && !merged.transcriptMessageId) merged.transcriptMessageId = transcriptMessageId
      items[items.length - 1] = merged
      return
    }
    items.push({
      id: allocateId(baseId),
      type: 'assistant_text',
      content,
      timestamp,
      ...(transcriptMessageId ? { transcriptMessageId } : {}),
      ...(model ? { model } : {}),
    })
  }

  const pushUserText = (msg: MessageEntry, text: string, timestamp: number, extra: TranscriptAttachment[] = []) => {
    const parsed = extractLeadingFileReferences(text)
    const attachments: TranscriptAttachment[] = [...(parsed.attachments ?? []), ...extra]
    items.push({
      id: allocateId(msg.id),
      type: 'user_text',
      content: parsed.content,
      ...(msg.id ? { transcriptMessageId: msg.id } : {}),
      ...(parsed.modelContent ? { modelContent: parsed.modelContent } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      timestamp,
    })
  }

  for (const msg of messages) {
    const timestamp = new Date(msg.timestamp).getTime()

    if (msg.type === 'system' && typeof msg.content === 'string') {
      const text = msg.content.trim()
      if (text === 'Conversation compacted' || text === 'Context compacted') {
        upsertTailCompactSummary({ title: 'Context compacted', phase: 'complete' }, msg.id, timestamp)
        continue
      }

      const command = parseLocalCommand(msg.content)
      if (command) {
        pendingCommand = command
        if (command.name === 'goal') {
          items.push({ id: allocateId(msg.id), type: 'user_text', content: formatLocalCommand(command), timestamp })
        }
        continue
      }

      const output = extractLocalCommandOutput(msg.content)
      if (output) {
        const goalEvent = parseGoalEvent(output, pendingCommand)
        pendingCommand = null
        if (goalEvent) {
          items.push({ id: allocateId(msg.id), type: 'goal_event', ...goalEvent, timestamp })
        }
        continue
      }
    }

    if (msg.type === 'user' && typeof msg.content === 'string') {
      const output = extractLocalCommandOutput(msg.content)
      if (output && isCompactCommandOutput(output)) continue

      const summary = extractCompactSummary(msg.content)
      if (summary) {
        upsertTailCompactSummary({ title: 'Context compacted', phase: 'complete', summary }, msg.id, timestamp)
        continue
      }

      if (isTeammateMessage(msg.content)) {
        if (!includeTeammateMessages) continue
        const contents = teammateContents(msg.content)
        if (contents.length === 0) continue
        items.push({
          id: allocateId(msg.id),
          type: 'user_text',
          content: contents.join('\n\n'),
          ...(msg.id ? { transcriptMessageId: msg.id } : {}),
          timestamp,
        })
        continue
      }

      pushUserText(msg, msg.content, timestamp)
      continue
    }

    if (msg.type === 'assistant' && typeof msg.content === 'string') {
      if (!msg.content.trim()) continue
      items.push({
        id: allocateId(msg.id),
        type: 'assistant_text',
        content: msg.content,
        ...(msg.id ? { transcriptMessageId: msg.id } : {}),
        timestamp,
        model: msg.model,
      })
      continue
    }

    if ((msg.type === 'assistant' || msg.type === 'tool_use') && Array.isArray(msg.content)) {
      const blocks = msg.content as AssistantBlock[]
      blocks.forEach((block, index) => {
        const blockId = `${msg.id}:${index}`
        if (block.type === 'thinking' && block.thinking) {
          items.push({ id: allocateId(blockId), type: 'thinking', content: block.thinking, timestamp })
        } else if (block.type === 'text' && block.text) {
          pushAssistantText(block.text, blockId, timestamp, msg.model, msg.id || undefined)
        } else if (block.type === 'tool_use') {
          items.push({
            id: allocateId(blockId),
            type: 'tool_use',
            toolName: block.name ?? 'unknown',
            toolUseId: block.id ?? '',
            input: block.input,
            timestamp,
            parentToolUseId: msg.parentToolUseId,
          })
        }
      })
      continue
    }

    if ((msg.type === 'user' || msg.type === 'tool_result') && Array.isArray(msg.content)) {
      const textParts: string[] = []
      const attachments: TranscriptAttachment[] = []
      const blocks = msg.content as UserBlock[]
      blocks.forEach((block, index) => {
        if (block.type === 'text' && block.text && isTeammateMessage(block.text)) {
          if (includeTeammateMessages) textParts.push(...teammateContents(block.text))
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        } else if (block.type === 'image') {
          attachments.push({
            type: 'image',
            name: block.name || 'image',
            data: block.source?.data,
            mimeType: block.mimeType || block.media_type,
          })
        } else if (block.type === 'file') {
          attachments.push({ type: 'file', name: block.name || 'file' })
        } else if (block.type === 'tool_result') {
          items.push({
            id: allocateId(`${msg.id}:${index}`),
            type: 'tool_result',
            toolUseId: block.tool_use_id ?? '',
            content: toolResultContent(block.content, msg.toolUseResult),
            isError: !!block.is_error,
            timestamp,
            parentToolUseId: msg.parentToolUseId,
          })
        }
      })
      if (textParts.length > 0 || attachments.length > 0) {
        pushUserText(msg, textParts.join('\n'), timestamp, attachments)
      }
    }

    if (msg.type === 'system' && msg.content && typeof msg.content === 'object') {
      const record = msg.content as { subtype?: unknown; message?: unknown }
      if (record.subtype === 'memory_saved') {
        const files = memoryEventFiles(msg.content)
        if (files.length > 0) {
          items.push({
            id: allocateId(msg.id),
            type: 'memory_event',
            event: 'saved',
            files,
            message: typeof record.message === 'string' ? record.message : undefined,
            teamCount: memoryTeamCount(msg.content),
            timestamp,
          })
        }
      }
    }
  }

  return items
}

function userText(msg: MessageEntry): string {
  if (typeof msg.content === 'string') return msg.content
  if (!Array.isArray(msg.content)) return ''
  return (msg.content as UserBlock[])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
}

/**
 * Terminal notifications for the session's background tasks and agents,
 * keyed by the tool use id of the call that started them.
 *
 * Team agents report back through teammate messages instead of task
 * notifications, so an agent's first visible teammate reply counts as its
 * completion. An explicit task notification for the same call wins.
 */
export function collectAgentNotifications(
  messages: MessageEntry[],
  taskNotifications: TaskNotification[],
): Record<string, TaskNotification> {
  const notifications: Record<string, TaskNotification> = {}

  const agentToolUseIds = new Map<string, string>()
  for (const msg of messages) {
    if ((msg.type !== 'assistant' && msg.type !== 'tool_use') || !Array.isArray(msg.content)) continue
    for (const block of msg.content as AssistantBlock[]) {
      if (block.type !== 'tool_use' || block.name !== 'Agent' || !block.id) continue
      const name = readRecord(block.input)?.name
      if (typeof name === 'string' && name && !agentToolUseIds.has(name)) agentToolUseIds.set(name, block.id)
    }
  }

  if (agentToolUseIds.size > 0) {
    const firstReplies = new Map<string, string>()
    for (const msg of messages) {
      if (msg.type !== 'user') continue
      const text = userText(msg)
      if (!text.includes('<teammate-message')) continue
      for (const { teammateId, content } of extractTeammateMessages(text)) {
        if (!firstReplies.has(teammateId)) firstReplies.set(teammateId, content)
      }
    }
    for (const [name, toolUseId] of agentToolUseIds) {
      const summary = firstReplies.get(name)
      if (summary) notifications[toolUseId] = { taskId: toolUseId, toolUseId, status: 'completed', summary }
    }
  }

  for (const notification of taskNotifications) {
    notifications[notification.toolUseId] = notification
  }

  return notifications
}

/** The latest TodoWrite list, or null once it was completed and the user sent another message. */
export function findLastTodos(messages: MessageEntry[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if ((msg.type !== 'assistant' && msg.type !== 'tool_use') || !Array.isArray(msg.content)) continue
    const blocks = msg.content as AssistantBlock[]
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = blocks[j]!
      if (block.type !== 'tool_use' || block.name !== 'TodoWrite') continue
      const todos = readRecord(block.input)?.todos
      if (!Array.isArray(todos)) continue
      const typedTodos = todos as TodoItem[]
      if (typedTodos.every((todo) => todo.status === 'completed')) {
        for (let k = i + 1; k < messages.length; k++) {
          if (messages[k]!.type === 'user' && messages[k]!.content) return null
        }
      }
      return typedTodos
    }
  }
  return null
}

/** True when the user wrote again after the last task-tracking tool call. */
export function hasUserMessagesAfterTaskCompletion(messages: MessageEntry[]): boolean {
  let lastTaskIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if ((msg.type === 'assistant' || msg.type === 'tool_use') && Array.isArray(msg.content)) {
      const blocks = msg.content as AssistantBlock[]
      if (blocks.some((block) => block.type === 'tool_use' && TASK_RELATED_TOOL_NAMES.has(block.name ?? ''))) {
        lastTaskIndex = i
        break
      }
    }
  }
  if (lastTaskIndex < 0) return false
  for (let i = lastTaskIndex + 1; i < messages.length; i++) {
    if (messages[i]!.type === 'user') return true
  }
  return false
}

/** Everything the desktop needs to restore a session, from its visible messages and recorded task notifications. */
export function buildSessionTranscript(
  messages: MessageEntry[],
  taskNotifications: TaskNotification[],
  options?: InterpretOptions,
): SessionTranscript {
  return {
    items: interpretTranscript(messages, options),
    agentNotifications: collectAgentNotifications(messages, taskNotifications),
    lastTodos: findLastTodos(messages),
    hasMessagesAfterTaskCompletion: hasUserMessagesAfterTaskCompletion(messages),
  }
}
