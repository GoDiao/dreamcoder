import {
  extractLocalCommandOutput,
  extractTextBlocks,
  isGoalCommandOutput,
  isTaskNotificationContent,
  parseLocalCommand,
  parseTaskNotification,
  type TaskNotification,
} from './classify.js'

/** One line of a CLI transcript JSONL file, as far as transcript interpretation reads it. */
export type TranscriptEntry = {
  type?: string
  subtype?: string
  content?: unknown
  uuid?: string
  parentUuid?: string | null
  parent_tool_use_id?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
    model?: string
  }
  [key: string]: unknown
}

/** A visible conversation message, before it is split into display items. */
export type MessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  toolUseResult?: unknown
  timestamp: string
  model?: string
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}

type ContentBlock = Record<string, unknown>

const USER_INTERRUPTION_TEXTS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
])

const NO_RESPONSE_REQUESTED_TEXT = 'No response requested.'

function entryToMessage(entry: TranscriptEntry, parentToolUseId?: string): MessageEntry | null {
  const msg = entry.message
  if (!msg || !msg.role) return null

  let type: MessageEntry['type']
  if (msg.role === 'user') {
    const hasToolResult = Array.isArray(msg.content) &&
      msg.content.some((block: ContentBlock) => block.type === 'tool_result')
    type = hasToolResult ? 'tool_result' : 'user'
  } else if (msg.role === 'assistant') {
    const hasToolUse = Array.isArray(msg.content) &&
      msg.content.some((block: ContentBlock) => block.type === 'tool_use')
    type = hasToolUse ? 'tool_use' : 'assistant'
  } else {
    type = 'system'
  }

  return {
    id: entry.uuid || crypto.randomUUID(),
    type,
    content: msg.content,
    ...(entry.toolUseResult !== undefined ? { toolUseResult: entry.toolUseResult } : {}),
    timestamp: entry.timestamp || new Date().toISOString(),
    model: msg.model,
    parentUuid: entry.parentUuid ?? undefined,
    parentToolUseId,
    isSidechain: entry.isSidechain,
  }
}

function isInternalCommandBreadcrumb(content: unknown): boolean {
  if (typeof content !== 'string') return false
  return (
    content.includes('<command-name>') ||
    content.includes('<command-message>') ||
    content.includes('<command-args>') ||
    content.includes('<local-command-caveat>')
  )
}

function isSyntheticUserInterruption(content: unknown): boolean {
  const textBlocks = extractTextBlocks(content)
  return textBlocks.length > 0 && textBlocks.every((text) => USER_INTERRUPTION_TEXTS.has(text))
}

function isSyntheticNoResponseAssistant(content: unknown): boolean {
  const textBlocks = extractTextBlocks(content)
  return textBlocks.length > 0 && textBlocks.every((text) => text === NO_RESPONSE_REQUESTED_TEXT)
}

function isToolResultContent(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((block) =>
      block &&
      typeof block === 'object' &&
      (block as ContentBlock).type === 'tool_result'
    )
  )
}

/** CLI bookkeeping that is written as a user or assistant message but is not conversation. */
export function shouldHideTranscriptEntry(entry: TranscriptEntry): boolean {
  const role = entry.message?.role
  const content = entry.message?.content

  if (role === 'user') {
    return (
      isInternalCommandBreadcrumb(content) ||
      isSyntheticUserInterruption(content) ||
      isTaskNotificationContent(content)
    )
  }

  if (role === 'assistant') {
    return isSyntheticNoResponseAssistant(content)
  }

  return false
}

/** `/goal` breadcrumbs are the only local command entries the conversation shows. */
function goalLocalCommandEntryToMessage(entry: TranscriptEntry): MessageEntry | null {
  if (entry.type !== 'system' || entry.subtype !== 'local_command' || typeof entry.content !== 'string') {
    return null
  }

  const command = parseLocalCommand(entry.content)
  let isGoal: boolean
  if (command?.name) {
    isGoal = command.name === 'goal'
  } else {
    const output = extractLocalCommandOutput(entry.content)
    isGoal = output ? isGoalCommandOutput(output) : false
  }
  if (!isGoal) return null

  return {
    id: entry.uuid || crypto.randomUUID(),
    type: 'system',
    content: entry.content,
    timestamp: entry.timestamp || new Date().toISOString(),
    parentUuid: entry.parentUuid ?? undefined,
    isSidechain: entry.isSidechain,
  }
}

function agentToolUseId(entry: TranscriptEntry): string | undefined {
  const content = entry.message?.content
  if (!Array.isArray(content)) return undefined

  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' && block.name === 'Agent' && typeof block.id === 'string') {
      return block.id
    }
  }
  return undefined
}

/**
 * The Agent tool call a sidechain entry belongs to: its explicit
 * `parent_tool_use_id`, or the nearest ancestor that issued an Agent call.
 */
function resolveParentToolUseId(
  entry: TranscriptEntry,
  entriesByUuid: Map<string, TranscriptEntry>,
  cache: Map<string, string | undefined>,
): string | undefined {
  if (typeof entry.parent_tool_use_id === 'string' && entry.parent_tool_use_id.length > 0) {
    return entry.parent_tool_use_id
  }

  if (entry.isSidechain !== true) return undefined

  const cacheKey = entry.uuid
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)

  let resolved: string | undefined
  let currentParentUuid = typeof entry.parentUuid === 'string' ? entry.parentUuid : undefined
  const visited = new Set<string>()

  while (currentParentUuid && !visited.has(currentParentUuid)) {
    visited.add(currentParentUuid)
    const parentEntry = entriesByUuid.get(currentParentUuid)
    if (!parentEntry) break

    const directAgentToolUseId = agentToolUseId(parentEntry)
    if (directAgentToolUseId) {
      resolved = directAgentToolUseId
      break
    }

    if (parentEntry.uuid && cache.has(parentEntry.uuid)) {
      resolved = cache.get(parentEntry.uuid)
      break
    }

    currentParentUuid = typeof parentEntry.parentUuid === 'string' ? parentEntry.parentUuid : undefined
  }

  if (cacheKey) cache.set(cacheKey, resolved)
  return resolved
}

/**
 * The visible conversation of a transcript, in order.
 *
 * Drops meta entries, CLI bookkeeping and task-notification turns (the
 * notification and the assistant's reply to it, up to the next real user
 * message). Notifications themselves are read by `collectTaskNotifications`.
 */
export function entriesToMessages(entries: TranscriptEntry[]): MessageEntry[] {
  const messages: MessageEntry[] = []
  const entriesByUuid = new Map<string, TranscriptEntry>()
  const parentToolUseIdCache = new Map<string, string | undefined>()
  let suppressTaskNotificationResponse = false

  for (const entry of entries) {
    if (typeof entry.uuid === 'string' && entry.uuid.length > 0) {
      entriesByUuid.set(entry.uuid, entry)
    }
  }

  for (const entry of entries) {
    const goalMessage = goalLocalCommandEntryToMessage(entry)
    if (goalMessage) {
      messages.push(goalMessage)
      continue
    }

    if (!entry.message?.role) continue
    if (entry.isMeta) continue

    if (entry.message.role === 'user' && isTaskNotificationContent(entry.message.content)) {
      suppressTaskNotificationResponse = true
      continue
    }

    if (entry.message.role === 'user' && !isToolResultContent(entry.message.content)) {
      suppressTaskNotificationResponse = false
    } else if (suppressTaskNotificationResponse) {
      continue
    }

    if (shouldHideTranscriptEntry(entry)) continue

    if (entry.type !== 'user' && entry.type !== 'assistant' && entry.type !== 'system') {
      continue
    }

    const parentToolUseId = resolveParentToolUseId(entry, entriesByUuid, parentToolUseIdCache)
    const msg = entryToMessage(entry, parentToolUseId)
    if (msg) messages.push(msg)
  }
  return messages
}

/** Terminal background-task notifications recorded in the transcript. */
export function collectTaskNotifications(entries: TranscriptEntry[]): TaskNotification[] {
  const notifications: TaskNotification[] = []
  for (const entry of entries) {
    if (entry.message?.role !== 'user') continue
    const notification = parseTaskNotification(entry.message.content, entry.timestamp)
    if (notification) notifications.push(notification)
  }
  return notifications
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as ContentBlock[])
    .flatMap((block) => (typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
}

/**
 * Subagents whose own transcript should be merged into the session: maps the
 * Agent tool use id to the agent id the tool result reports (`agentId: …`).
 */
export function findSubagentLinks(messages: MessageEntry[]): Map<string, string> {
  const agentToolUseIds = new Set(
    messages.flatMap((message) => {
      if (message.type !== 'tool_use' || !Array.isArray(message.content)) return []
      return (message.content as ContentBlock[])
        .filter((block) => block.type === 'tool_use' && block.name === 'Agent')
        .flatMap((block) => (typeof block.id === 'string' ? [block.id] : []))
    }),
  )
  const links = new Map<string, string>()

  for (const message of messages) {
    if (message.type !== 'tool_result' || !Array.isArray(message.content)) continue

    for (const block of message.content as ContentBlock[]) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      if (!agentToolUseIds.has(block.tool_use_id)) continue

      const agentId = textOf(block.content).match(/(?:^|\n)\s*agentId:\s*([A-Za-z0-9_-]+)/)?.[1]
      if (agentId) links.set(block.tool_use_id, agentId)
    }
  }

  return links
}

/** Tool ids inside a subagent transcript are namespaced so they cannot collide with the parent's. */
function namespaceSubagentContentIds(content: unknown, namespace: string): unknown {
  if (!Array.isArray(content)) return content

  return (content as ContentBlock[]).map((block) => {
    if (!block || typeof block !== 'object') return block
    if (block.type === 'tool_use' && typeof block.id === 'string') {
      return { ...block, id: `${namespace}/${block.id}` }
    }
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      return { ...block, tool_use_id: `${namespace}/${block.tool_use_id}` }
    }
    return block
  })
}

/** The tool calls and results of a subagent transcript, nested under the Agent call that ran it. */
export function subagentEntriesToMessages(
  entries: TranscriptEntry[],
  parentToolUseId: string,
  agentId: string,
): MessageEntry[] {
  const namespace = `${parentToolUseId}/${agentId}`
  const messages: MessageEntry[] = []

  for (const entry of entries) {
    if (!entry.message?.role || entry.isMeta) continue
    if (shouldHideTranscriptEntry(entry)) continue
    if (entry.type !== 'user' && entry.type !== 'assistant' && entry.type !== 'system') continue

    const message = entryToMessage(
      {
        ...entry,
        message: { ...entry.message, content: namespaceSubagentContentIds(entry.message.content, namespace) },
      },
      parentToolUseId,
    )
    if (message && (message.type === 'tool_use' || message.type === 'tool_result')) {
      messages.push(message)
    }
  }

  return messages
}
