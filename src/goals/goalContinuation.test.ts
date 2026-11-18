import { describe, expect, test } from 'bun:test'
import { PROMPT_HOOK_UNMET_PREFIX } from '../utils/hooks/execPromptHook.js'
import { clearThreadGoalHook, getThreadGoal, goalContinuationText, MAX_GOAL_CONTINUATIONS, setThreadGoalHook } from './goalState.js'

const blockingError = {
  blockingError: `${PROMPT_HOOK_UNMET_PREFIX}2 tests still failing`,
  command: '<dreamcoder-goal-hook>\nYou are a Stop hook evaluator for a long-running /goal.\n\n<goal-objective>\nall unit tests pass\n</goal-objective>\n',
}

describe('/goal continuation message', () => {
  test('says it is an automatic /goal continuation and carries the goal and what is missing', () => {
    const text = goalContinuationText(blockingError, 0)!

    expect(text).toStartWith(`Automatic /goal continuation (1 of ${MAX_GOAL_CONTINUATIONS}).`)
    expect(text).toContain('<goal>all unit tests pass</goal>')
    expect(text).toContain('What the evaluator says is still missing: 2 tests still failing')
    expect(text).toContain('/goal clear')
    expect(text).not.toContain(PROMPT_HOOK_UNMET_PREFIX)
  })

  test('numbers the continuation after the ones already made for this message', () => {
    expect(goalContinuationText(blockingError, 2)).toStartWith('Automatic /goal continuation (3 of 10).')
  })

  test('the last continuation asks for a report of what is done and what is missing', () => {
    const text = goalContinuationText(blockingError, MAX_GOAL_CONTINUATIONS - 1)!

    expect(text).toStartWith('Automatic /goal continuation (10 of 10).')
    expect(text).toContain('This is the last automatic continuation for this message')
  })

  test('after the limit the turn is allowed to end', () => {
    expect(MAX_GOAL_CONTINUATIONS).toBe(10)
    expect(goalContinuationText(blockingError, MAX_GOAL_CONTINUATIONS)).toBeNull()
  })

  test('the evaluator is told to answer blocked when the agent needs the user', () => {
    const appState = { sessionHooks: new Map() }
    const context = { setAppState: (update: (prev: never) => unknown) => update(appState as never) }
    const goal = setThreadGoalHook(context as never, 'goal-blocked-prompt', 'deploy to staging')

    try {
      expect(goal.hook.prompt).toContain('"blocked": true')
    } finally {
      clearThreadGoalHook(context as never, 'goal-blocked-prompt')
    }
    expect(getThreadGoal('goal-blocked-prompt')).toBeNull()
  })
})
