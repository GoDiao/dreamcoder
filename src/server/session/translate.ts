import { SHOW_UI_TOOL_NAME } from '../../tools/ShowUITool/constants.js'
import { parseUiPageResult } from '../../utils/uiPages.js'
import { isPermissionMode } from '../services/permissionModes.js'
import {
  extractCompactSummary,
  extractLocalCommandOutput,
  isCompactCommandOutput,
  parseBackgroundTaskMessage,
  parseGoalEvent,
  parseLocalCommand,
  parseMemorySaved,
  readCompactMetadata,
  type BackgroundTaskMessageSubtype,
} from '../transcript/classify.js'
import type { LiveTranscriptItem, ServerMessage } from '../ws/protocol.js'
import type { PendingPermission, SessionSlashCommand, SessionStateEvent } from './state/types.js'

export type SessionStreamState = {
  hasReceivedStreamEvents: boolean
  activeBlockTypes: Map<number, 'text' | 'tool_use' | 'thinking'>
  activeToolBlocks: Map<number, { toolName: string; toolUseId: string; inputJson: string; parentToolUseId?: string }>
  pendingLocalCommand?: { name: string; args: string }
  pendingToolBlocks: Map<string, { toolName: string; toolUseId: string; parentToolUseId?: string }>
  streamedToolUseIds: Set<string>
  toolParentUseIds: Map<string, string>
  showUiToolUseIds: Set<string>
  lastApiError?: {
    message: string
    code: string
  }
  stopRequested: boolean
}

export type TranslateResult = {
  messages: ServerMessage[]
  events: SessionStateEvent[]
}

export function createStreamState(): SessionStreamState {
  return {
    hasReceivedStreamEvents: false,
    activeBlockTypes: new Map(),
    activeToolBlocks: new Map(),
    pendingLocalCommand: undefined,
    pendingToolBlocks: new Map(),
    streamedToolUseIds: new Set(),
    toolParentUseIds: new Map(),
    showUiToolUseIds: new Set(),
    lastApiError: undefined,
    stopRequested: false,
  }
}

function toPendingPermission(cliMsg: any): PendingPermission {
  const request = cliMsg.request ?? {}
  return {
    requestId: cliMsg.request_id,
    toolName: typeof request.tool_name === 'string' && request.tool_name ? request.tool_name : 'Unknown',
    ...(typeof request.tool_use_id === 'string' && request.tool_use_id.trim() ? { toolUseId: request.tool_use_id } : {}),
    input: request.input && typeof request.input === 'object' ? request.input : {},
    ...(typeof request.description === 'string' && request.description.trim() ? { description: request.description } : {}),
    ...(Array.isArray(request.permission_suggestions) ? { suggestions: request.permission_suggestions } : {}),
  }
}

function initSlashCommands(cliMsg: any): SessionSlashCommand[] | null {
  return Array.isArray(cliMsg.slash_commands) ? normalizeSessionSlashCommands(cliMsg.slash_commands) : null
}

function initEvents(cliMsg: any): SessionStateEvent[] {
  const events: SessionStateEvent[] = []
  if (typeof cliMsg.cwd === 'string' && cliMsg.cwd.trim()) {
    events.push({ type: 'workspace_reported', workspace: { workDir: cliMsg.cwd, workDirExists: true } })
  }
  const commands = initSlashCommands(cliMsg)
  if (commands) events.push({ type: 'slash_commands_reported', commands })
  if (typeof cliMsg.model === 'string' || cliMsg.model === null) {
    events.push({ type: 'runtime_effective_reported', modelId: cliMsg.model ?? null })
  }
  if (isPermissionMode(cliMsg.permissionMode)) {
    events.push({ type: 'permission_effective_reported', mode: cliMsg.permissionMode })
  }
  return events
}

function hasTextBlock(content: unknown[]): boolean {
  return content.some((block) => {
    const record = block as { type?: unknown; text?: unknown }
    return record?.type === 'text' && typeof record.text === 'string' && record.text.length > 0
  })
}

function replayedUserMessage(cliMsg: any): ServerMessage | null {
  if (!cliMsg.isReplay || cliMsg.isSynthetic || typeof cliMsg.uuid !== 'string') return null
  const content = cliMsg.message?.content
  if (extractLocalCommandOutput(content) || extractCompactSummary(content)) return null
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('\n')
      : ''
  if (!text.trim() || (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result'))) return null
  return { type: 'user_message', id: cliMsg.uuid, content: text }
}

function unstreamedToolUse(streamState: SessionStreamState, cliMsg: any, block: any): ServerMessage {
  const parentToolUseId = cliParentToolUseId(cliMsg)
  rememberToolParentUseId(streamState, block.id, parentToolUseId)
  return { type: 'tool_use_complete', toolName: block.name, toolUseId: block.id, input: block.input, parentToolUseId }
}

function cliParentToolUseId(cliMsg: any): string | undefined {
  return typeof cliMsg.parent_tool_use_id === 'string' && cliMsg.parent_tool_use_id.length > 0
    ? cliMsg.parent_tool_use_id
    : undefined
}

function rememberToolParentUseId(
  streamState: SessionStreamState,
  toolUseId: string | undefined,
  parentToolUseId: string | undefined,
): void {
  if (!toolUseId || !parentToolUseId) return
  streamState.toolParentUseIds.set(toolUseId, parentToolUseId)
}

function consumeToolParentUseId(
  streamState: SessionStreamState,
  toolUseId: string | undefined,
): string | undefined {
  if (!toolUseId) return undefined
  const parentToolUseId = streamState.toolParentUseIds.get(toolUseId)
  streamState.toolParentUseIds.delete(toolUseId)
  return parentToolUseId
}

function extractAssistantText(cliMsg: any): string {
  const content = cliMsg?.message?.content
  if (!Array.isArray(content)) return ''
  const textBlock = content.find(
    (block: unknown): block is { type: string; text: string } =>
      !!block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string',
  )
  return textBlock?.text || ''
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeAskUserQuestionToolResult(content: unknown, toolUseResult: unknown): unknown {
  const result = readObject(toolUseResult)
  const answers = readObject(result?.answers)
  if (!result || !answers || !Array.isArray(result.questions)) return content
  return {
    questions: result.questions,
    answers,
  }
}

function isDuplicateOfLastApiError(
  lastApiError: SessionStreamState['lastApiError'],
  resultMessage: string,
): boolean {
  if (!lastApiError?.message) return false
  if (resultMessage === lastApiError.message) return true
  return (
    resultMessage.includes(lastApiError.message) &&
    /CLI (?:process exited unexpectedly|exited during startup)/i.test(resultMessage)
  )
}

export function translateCliOutput(cliMsg: any, streamState: SessionStreamState, now = Date.now()): TranslateResult {
  const events: SessionStateEvent[] = []
  const messages = translateMessages(cliMsg, streamState, events, now)
  return { messages, events }
}

function translateMessages(
  cliMsg: any,
  streamState: SessionStreamState,
  events: SessionStateEvent[],
  now: number,
): ServerMessage[] {
  switch (cliMsg.type) {
    case 'assistant': {
      if (cliMsg.error || cliMsg.isApiErrorMessage) {
        const message = extractAssistantText(cliMsg) || cliMsg.error || 'Unknown API error'
        const code = typeof cliMsg.error === 'string' ? cliMsg.error : 'API_ERROR'
        streamState.lastApiError = { message, code }
        return [{
          type: 'error',
          message,
          code,
        }]
      }

      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        const messages: ServerMessage[] = []

        for (const block of cliMsg.message.content) {
          if (block.type === 'tool_use' && block.name === SHOW_UI_TOOL_NAME) streamState.showUiToolUseIds.add(block.id)
          if (streamState.hasReceivedStreamEvents) {
            if (block.type === 'tool_use' && streamState.pendingToolBlocks.has(block.id)) {
              const pending = streamState.pendingToolBlocks.get(block.id)!
              streamState.pendingToolBlocks.delete(block.id)
              rememberToolParentUseId(streamState, block.id, pending.parentToolUseId)
              messages.push({
                type: 'tool_use_complete',
                toolName: pending.toolName || block.name,
                toolUseId: block.id,
                input: block.input,
                parentToolUseId: pending.parentToolUseId,
              })
            } else if (block.type === 'tool_use' && !streamState.streamedToolUseIds.has(block.id)) {
              messages.push(unstreamedToolUse(streamState, cliMsg, block))
            }
          } else {
            if (block.type === 'thinking' && block.thinking) {
              messages.push({ type: 'thinking', text: block.thinking })
            } else if (block.type === 'text' && block.text) {
              messages.push({ type: 'content_start', blockType: 'text' })
              messages.push({ type: 'content_delta', text: block.text })
            } else if (block.type === 'tool_use') {
              messages.push(unstreamedToolUse(streamState, cliMsg, block))
            }
          }
        }

        streamState.hasReceivedStreamEvents = false
        streamState.pendingToolBlocks.clear()
        streamState.streamedToolUseIds.clear()
        if (typeof cliMsg.uuid === 'string' && hasTextBlock(cliMsg.message.content)) {
          messages.push({ type: 'message_id', id: cliMsg.uuid })
        }
        return messages
      }
      return []
    }

    case 'user': {
      const messages: ServerMessage[] = []
      const echo = replayedUserMessage(cliMsg)
      if (echo) return [echo]

      const compactSummary = extractCompactSummary(cliMsg.message?.content)
      if (compactSummary) {
        messages.push(liveItem({ type: 'compact_summary', title: 'Context compacted', phase: 'complete', summary: compactSummary }))
      }

      const localCommandOutput = extractLocalCommandOutput(
        cliMsg.message?.content,
      )
      if (localCommandOutput) {
        const pendingLocalCommand = streamState.pendingLocalCommand
        streamState.pendingLocalCommand = undefined
        if (!isCompactCommandOutput(localCommandOutput)) {
          const goalEvent = parseGoalEvent(
            localCommandOutput,
            pendingLocalCommand,
          )
          if (goalEvent) {
            events.push({ type: 'goal_reported', goal: goalEvent, at: now })
            messages.push(liveItem({ type: 'goal_event', ...goalEvent }))
          } else {
            messages.push({ type: 'content_start', blockType: 'text' })
            messages.push({ type: 'content_delta', text: localCommandOutput })
          }
        }
      }

      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        for (const block of cliMsg.message.content) {
          if (block.type === 'tool_result') {
            const rememberedParentToolUseId = consumeToolParentUseId(streamState, block.tool_use_id)
            const parentToolUseId =
              cliParentToolUseId(cliMsg) ?? rememberedParentToolUseId
            if (streamState.showUiToolUseIds.delete(block.tool_use_id) && !block.is_error) {
              const page = parseUiPageResult(block.content)
              if (page) events.push({ type: 'ui_page_reported', page })
            }
            messages.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              content: normalizeAskUserQuestionToolResult(block.content, cliMsg.toolUseResult),
              isError: !!block.is_error,
              parentToolUseId,
            })
          }
        }
      }

      return messages
    }

    case 'stream_event': {
      streamState.hasReceivedStreamEvents = true
      const event = cliMsg.event
      if (!event) return []

      switch (event.type) {
        case 'message_start': {
          events.push({ type: 'turn_activity_reported', activity: 'thinking' })
          return []
        }

        case 'content_block_start': {
          const contentBlock = event.content_block
          if (!contentBlock) return []

          const index = event.index ?? 0

          if (contentBlock.type === 'tool_use') {
            events.push({ type: 'turn_activity_reported', activity: 'tool' })
            const parentToolUseId = cliParentToolUseId(cliMsg)
            streamState.activeBlockTypes.set(index, 'tool_use')
            if (contentBlock.id) streamState.streamedToolUseIds.add(contentBlock.id)
            streamState.activeToolBlocks.set(index, {
              toolName: contentBlock.name || '',
              toolUseId: contentBlock.id || '',
              inputJson: '',
              parentToolUseId,
            })
            return [{
              type: 'content_start',
              blockType: 'tool_use',
              toolName: contentBlock.name,
              toolUseId: contentBlock.id,
              parentToolUseId,
            }]
          }

          if (contentBlock.type === 'thinking' || contentBlock.type === 'redacted_thinking') {
            events.push({ type: 'turn_activity_reported', activity: 'thinking' })
            streamState.activeBlockTypes.set(index, 'thinking')
            return []
          }

          events.push({ type: 'turn_activity_reported', activity: 'streaming' })
          streamState.activeBlockTypes.set(index, 'text')
          return [{ type: 'content_start', blockType: 'text' }]
        }

        case 'content_block_delta': {
          const delta = event.delta
          if (!delta) return []

          if (delta.type === 'text_delta' && delta.text) {
            return [{ type: 'content_delta', text: delta.text }]
          }
          if (delta.type === 'input_json_delta' && delta.partial_json) {
            const index = event.index ?? 0
            const toolBlock = streamState.activeToolBlocks.get(index)
            if (toolBlock) toolBlock.inputJson += delta.partial_json
            return [{ type: 'content_delta', toolInput: delta.partial_json }]
          }
          if (delta.type === 'thinking_delta' && delta.thinking) {
            return [{ type: 'thinking', text: delta.thinking }]
          }
          return []
        }

        case 'content_block_stop': {
          const index = event.index ?? 0
          const blockType = streamState.activeBlockTypes.get(index)
          streamState.activeBlockTypes.delete(index)

          if (blockType === 'tool_use') {
            const toolBlock = streamState.activeToolBlocks.get(index)
            streamState.activeToolBlocks.delete(index)
            if (toolBlock) {
              const parentToolUseId =
                cliParentToolUseId(cliMsg) ?? toolBlock.parentToolUseId
              let parsedInput = null
              try { parsedInput = JSON.parse(toolBlock.inputJson) } catch {}

              if (parsedInput !== null) {
                rememberToolParentUseId(streamState, toolBlock.toolUseId, parentToolUseId)
                return [{
                  type: 'tool_use_complete',
                  toolName: toolBlock.toolName,
                  toolUseId: toolBlock.toolUseId,
                  input: parsedInput,
                  parentToolUseId,
                }]
              }

              console.warn(
                `[WS] Tool input JSON parse failed for ${toolBlock.toolName} (${toolBlock.toolUseId}), deferring to assistant message`,
              )
              streamState.pendingToolBlocks.set(toolBlock.toolUseId, {
                toolName: toolBlock.toolName,
                toolUseId: toolBlock.toolUseId,
                parentToolUseId,
              })
            }
          }
          return []
        }

        case 'message_stop': {
          return []
        }

        case 'message_delta': {
          return []
        }

        default:
          return []
      }
    }

    case 'control_request': {
      if (cliMsg.request?.subtype === 'can_use_tool' && typeof cliMsg.request_id === 'string') {
        events.push({ type: 'permission_request_opened', request: toPendingPermission(cliMsg), at: now })
      }
      return []
    }

    case 'control_response':
      return []

    case 'control_cancel_request':
      if (typeof cliMsg.request_id === 'string') {
        events.push({ type: 'permission_request_cancelled', requestId: cliMsg.request_id })
      }
      return []

    case 'result': {
      events.push({ type: 'turn_ended' })
      const usage = {
        input_tokens: cliMsg.usage?.input_tokens || 0,
        output_tokens: cliMsg.usage?.output_tokens || 0,
      }

      if (cliMsg.is_error) {
        if (streamState.stopRequested) {
          streamState.stopRequested = false
          return [{ type: 'message_complete', usage }]
        }

        const resultMessage =
          (typeof cliMsg.result === 'string' && cliMsg.result) ||
          (Array.isArray(cliMsg.errors) && cliMsg.errors.length > 0
            ? cliMsg.errors.join('\n')
            : 'Unknown error')
        if (isDuplicateOfLastApiError(streamState.lastApiError, resultMessage)) {
          streamState.lastApiError = undefined
          return [{ type: 'message_complete', usage }]
        }
        return [
          {
            type: 'error',
            message: resultMessage,
            code: 'CLI_ERROR',
          },
          { type: 'message_complete', usage },
        ]
      }

      streamState.stopRequested = false
      streamState.lastApiError = undefined
      return [{ type: 'message_complete', usage }]
    }

    case 'system': {
      const subtype = cliMsg.subtype
      if (subtype === 'api_retry') {
        const apiRetryMessage = toApiRetryServerMessage(cliMsg)
        return apiRetryMessage ? [apiRetryMessage] : []
      }
      if (subtype === 'init') {
        events.push(...initEvents(cliMsg))
        const messages: ServerMessage[] = [
          { type: 'system_notification', subtype: 'init', message: `Model: ${cliMsg.model || 'unknown'}`, data: { model: cliMsg.model } },
        ]
        const cmds = initSlashCommands(cliMsg)
        if (cmds && cmds.length > 0) {
          messages.push({
            type: 'system_notification',
            subtype: 'slash_commands',
            data: cmds,
          })
        }
        return messages
      }
      if (subtype === 'memory_saved') {
        const saved = parseMemorySaved(cliMsg)
        return saved ? [liveItem({ type: 'memory_event', event: 'saved', ...saved })] : []
      }
      if (subtype === 'status') {
        if (isPermissionMode(cliMsg.permissionMode)) {
          events.push({ type: 'permission_effective_reported', mode: cliMsg.permissionMode })
          return []
        }
        if (cliMsg.status === 'compacting') {
          events.push({ type: 'turn_activity_reported', activity: 'compacting' })
          return []
        }
        if (cliMsg.status == null) {
          events.push({ type: 'turn_activity_reported', activity: 'thinking' })
          return []
        }
        return []
      }
      if (subtype === 'hook_started' || subtype === 'hook_response') {
        return []
      }
      if (subtype === 'local_command' || subtype === 'local_command_output') {
        const localCommand = parseLocalCommand(cliMsg.content ?? cliMsg.message)
        if (localCommand) {
          streamState.pendingLocalCommand = localCommand
          return []
        }

        const localCommandOutput = extractLocalCommandOutput(
          cliMsg.content ?? cliMsg.message,
          { allowUntagged: subtype === 'local_command_output' },
        )
        if (!localCommandOutput) return []
        const goalEvent = parseGoalEvent(
          localCommandOutput,
          streamState.pendingLocalCommand,
        )
        streamState.pendingLocalCommand = undefined
        if (goalEvent) {
          events.push({ type: 'goal_reported', goal: goalEvent, at: now })
          return [liveItem({ type: 'goal_event', ...goalEvent })]
        }
        return [
          { type: 'content_start', blockType: 'text' },
          { type: 'content_delta', text: localCommandOutput },
        ]
      }
      if (subtype === 'task_notification') {
        return backgroundTaskMessages(cliMsg, subtype, events, now)
      }
      if (subtype === 'task_started') {
        events.push({ type: 'turn_activity_reported', activity: 'tool' })
        return backgroundTaskMessages(cliMsg, subtype, events, now)
      }
      if (subtype === 'task_progress') {
        events.push({ type: 'turn_activity_reported', activity: 'tool' })
        return backgroundTaskMessages(cliMsg, subtype, events, now)
      }
      if (subtype === 'session_state_changed') {
        if (cliMsg.state === 'running' || cliMsg.state === 'requires_action' || cliMsg.state === 'idle') {
          events.push({ type: 'turn_state_reported', state: cliMsg.state, at: now })
        }
        return []
      }
      if (subtype === 'compact_boundary') {
        return [liveItem({
          type: 'compact_summary',
          title: getCompactBoundaryMessage(cliMsg),
          phase: 'complete',
          ...readCompactMetadata(cliMsg.compact_metadata ?? cliMsg),
        })]
      }
      return []
    }

    default:
      console.log(`[WS] Unknown CLI message type: ${cliMsg.type}`, JSON.stringify(cliMsg).substring(0, 200))
      return []
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeRetryCount(value: unknown): number | null {
  const numeric = finiteNumber(value)
  if (numeric === null) return null
  return Math.max(0, Math.trunc(numeric))
}

function readRetryErrorRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readRetryErrorString(value: unknown, keys: string[]): string | undefined {
  const record = readRetryErrorRecord(value)
  if (!record) return undefined
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

function toApiRetryServerMessage(cliMsg: any): ServerMessage | null {
  const attempt = normalizeRetryCount(cliMsg.attempt)
  const maxRetries = normalizeRetryCount(cliMsg.max_retries)
  const retryDelayMs = normalizeRetryCount(cliMsg.retry_delay_ms)
  if (attempt === null || maxRetries === null || retryDelayMs === null) return null

  const embeddedError = readRetryErrorRecord(cliMsg.error)
  const embeddedStatus = embeddedError ? finiteNumber(embeddedError.status) : null
  const rawStatus = cliMsg.error_status === null
    ? null
    : finiteNumber(cliMsg.error_status) ?? embeddedStatus
  const errorType = typeof cliMsg.error === 'string' && cliMsg.error.trim()
    ? cliMsg.error.trim()
    : readRetryErrorString(cliMsg.error, ['type', 'code', 'name'])
  const errorMessage = readRetryErrorString(cliMsg.error, ['message', 'error'])

  return {
    type: 'api_retry',
    attempt,
    maxRetries,
    retryDelayMs,
    errorStatus: rawStatus === null ? null : Math.trunc(rawStatus),
    ...(errorType ? { errorType } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  }
}

type LiveItemContent<T = LiveTranscriptItem> = T extends LiveTranscriptItem ? Omit<T, 'id' | 'timestamp'> : never

function liveItem(content: LiveItemContent): ServerMessage {
  return {
    type: 'transcript_item',
    item: { ...content, id: crypto.randomUUID(), timestamp: Date.now() } as LiveTranscriptItem,
  }
}

function backgroundTaskMessages(
  cliMsg: unknown,
  subtype: BackgroundTaskMessageSubtype,
  events: SessionStateEvent[],
  now: number,
): ServerMessage[] {
  const parsed = parseBackgroundTaskMessage(cliMsg, subtype)
  if (!parsed) return []
  events.push({ type: 'background_task_reported', task: parsed.event, at: now })
  return [{ type: 'background_task', ...parsed }]
}

function getCompactBoundaryMessage(cliMsg: any): string {
  const message = typeof cliMsg?.message === 'string' ? cliMsg.message.trim() : ''
  if (message) return message

  const content = typeof cliMsg?.content === 'string' ? cliMsg.content.trim() : ''
  if (content) return content

  return 'Context compacted'
}

export function normalizeSessionSlashCommands(commands: unknown[]): SessionSlashCommand[] {
  return commands
    .map(normalizeSessionSlashCommand)
    .filter((command): command is SessionSlashCommand => command !== null)
}

function normalizeSessionSlashCommand(command: unknown): SessionSlashCommand | null {
  if (typeof command === 'string') {
    return command.trim() ? { name: command, description: '' } : null
  }
  if (!command || typeof command !== 'object') return null

  const record = command as {
    name?: unknown
    command?: unknown
    description?: unknown
    argumentHint?: unknown
  }
  const name =
    typeof record.name === 'string'
      ? record.name
      : typeof record.command === 'string'
        ? record.command
        : ''
  if (!name.trim()) return null

  return {
    name,
    description: typeof record.description === 'string' ? record.description : '',
    ...(typeof record.argumentHint === 'string' ? { argumentHint: record.argumentHint } : {}),
  }
}

