import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionMode } from './PermissionMode.js'
import { transitionPermissionMode } from './permissionSetup.js'

/**
 * Determines the next permission mode when cycling through modes with Shift+Tab.
 */
export function getNextPermissionMode(
  toolPermissionContext: ToolPermissionContext,
  _teamContext?: { leadAgentId: string },
): PermissionMode {
  switch (toolPermissionContext.mode) {
    case 'default':
      return 'acceptEdits'

    case 'acceptEdits':
      return 'plan'

    case 'plan':
      return 'auto'

    case 'auto':
      if (toolPermissionContext.isBypassPermissionsModeAvailable) {
        return 'bypassPermissions'
      }
      return 'default'

    case 'bypassPermissions':
      return 'default'

    case 'dontAsk':
      // Not exposed in UI cycle yet, but return default if somehow reached
      return 'default'
    default:
      return 'default'
  }
}

export function cyclePermissionMode(
  toolPermissionContext: ToolPermissionContext,
  teamContext?: { leadAgentId: string },
): { nextMode: PermissionMode; context: ToolPermissionContext } {
  const nextMode = getNextPermissionMode(toolPermissionContext, teamContext)
  return {
    nextMode,
    context: transitionPermissionMode(
      toolPermissionContext.mode,
      nextMode,
      toolPermissionContext,
    ),
  }
}
