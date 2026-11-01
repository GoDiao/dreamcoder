import { CHOOSE_DESIGN_TEMPLATE_TOOL } from './inlineQuestionTools'
import { useChatStore } from '../stores/chatStore'

export const SCRATCH_CHOICE = 'scratch'

export type DesignCandidate = { id: string; reason: string }

export function parseDesignCandidates(input: unknown): DesignCandidate[] {
  const candidates = (input as { candidates?: unknown } | null)?.candidates
  if (!Array.isArray(candidates)) return []
  return candidates.flatMap((candidate): DesignCandidate[] => {
    const record = candidate as Record<string, unknown> | null
    return typeof record?.id === 'string' && typeof record.reason === 'string' ? [{ id: record.id, reason: record.reason }] : []
  })
}

export function useDesignChoiceRequest(sessionId: string | null | undefined) {
  return useChatStore((state) => {
    const pending = sessionId ? state.sessions[sessionId]?.pendingPermission : undefined
    return pending?.toolName === CHOOSE_DESIGN_TEMPLATE_TOOL ? pending : null
  })
}

export function respondWithDesignChoice(sessionId: string, request: { requestId: string; input: unknown }, choice: string) {
  const input = (request.input && typeof request.input === 'object' ? request.input : {}) as Record<string, unknown>
  useChatStore.getState().respondToPermission(sessionId, request.requestId, true, { updatedInput: { ...input, choice } })
}

export function parseChosen(result: unknown): string | null {
  const choice = (result as { choice?: unknown } | null)?.choice
  return typeof choice === 'string' ? choice : null
}
