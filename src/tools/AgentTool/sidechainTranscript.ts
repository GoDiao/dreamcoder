import type { UUID } from 'crypto'
import type { Message } from '../../types/message.js'

/**
 * One sidechain transcript shared by several runAgent() calls. An in-process
 * teammate calls runAgent() once per prompt and passes its whole history as
 * context each time; with this, the history is written once instead of being
 * copied into a new file on every call.
 */
export type SharedSidechainTranscript = {
  /** Messages already in the transcript file. runAgent adds what it writes. */
  recordedUuids: Set<UUID>
  teamName?: string
  agentName?: string
}

/**
 * The messages of `initialMessages` that are not in the transcript yet, and
 * the message they follow, so the new part chains onto what was written before.
 */
export function unrecordedMessages(
  initialMessages: Message[],
  recordedUuids: ReadonlySet<UUID>,
): { messages: Message[]; parentUuid: UUID | null } {
  const firstNew = initialMessages.findIndex(
    message => !recordedUuids.has(message.uuid),
  )
  if (firstNew === -1) return { messages: [], parentUuid: null }
  return {
    messages: initialMessages
      .slice(firstNew)
      .filter(message => !recordedUuids.has(message.uuid)),
    parentUuid: initialMessages[firstNew - 1]?.uuid ?? null,
  }
}
