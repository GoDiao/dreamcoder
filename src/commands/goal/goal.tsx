import * as React from 'react'
import { getSessionId } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  getThreadGoal,
  clearThreadGoalHook,
  ensureThreadGoalHookFromTranscript,
  getGoalHookUnavailableReason,
  parseGoalCommand,
  setThreadGoalHook,
} from '../../goals/goalState.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const threadId = getSessionId()

  try {
    const parsed = parseGoalCommand(args)
    if (parsed.type === 'clear') {
      const existing =
        getThreadGoal(threadId) ??
        ensureThreadGoalHookFromTranscript(_context, threadId, _context.messages)
      const cleared = clearThreadGoalHook(_context, threadId)
      onDone(
        cleared || existing ? `Goal cleared: ${(cleared ?? existing)!.objective}` : 'No active goal.',
        { display: 'system' },
      )
      return null
    }

    const unavailableReason = getGoalHookUnavailableReason()
    if (unavailableReason) {
      onDone(unavailableReason, { display: 'system' })
      return null
    }

    const goal = setThreadGoalHook(_context, threadId, parsed.objective)
    onDone(`Goal set: ${goal.objective}`, {
      display: 'system',
      shouldQuery: true,
    })
    return null
  } catch (error) {
    onDone(error instanceof Error ? error.message : String(error), {
      display: 'system',
    })
    return null
  }
}
