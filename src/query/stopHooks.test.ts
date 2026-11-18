import { describe, expect, test } from 'bun:test'
import { getStopHookMessage } from '../utils/hooks.js'
import { PROMPT_HOOK_UNMET_PREFIX } from '../utils/hooks/execPromptHook.js'
import { stopHookBlockingContent } from './stopHooks.js'

const goalBlockingError = {
  blockingError: `${PROMPT_HOOK_UNMET_PREFIX}keep working`,
  command: '<dreamcoder-goal-hook>\n<goal-objective>\nship the feature\n</goal-objective>',
}
const userBlockingError = {
  blockingError: `${PROMPT_HOOK_UNMET_PREFIX}stop`,
  command: 'ordinary prompt hook',
}

describe('text a Stop hook result sends to the model', () => {
  test('an unmet /goal under the limit continues with the goal continuation', () => {
    expect(stopHookBlockingContent(goalBlockingError, 3)).toStartWith('Automatic /goal continuation (4 of 10).')
  })

  test('an unmet /goal at the limit sends nothing, so the turn ends', () => {
    expect(stopHookBlockingContent(goalBlockingError, 10)).toBeNull()
  })

  test("the user's own hook keeps the standard Stop hook feedback", () => {
    expect(stopHookBlockingContent(userBlockingError, 0)).toBe(getStopHookMessage(userBlockingError))
  })
})
