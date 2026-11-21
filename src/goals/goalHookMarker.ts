export const GOAL_HOOK_MARKER = '<dreamcoder-goal-hook>'

export function isGoalPromptHookCommand(command: string | undefined): boolean {
  return typeof command === 'string' && command.includes(GOAL_HOOK_MARKER)
}
