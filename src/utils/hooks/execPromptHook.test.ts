import { describe, expect, test } from 'bun:test'
import { PROMPT_HOOK_UNMET_PREFIX, promptHookResponseSchema, unmetPromptHookResult } from './execPromptHook.js'

const goalHook = {
  type: 'prompt' as const,
  prompt: '<dreamcoder-goal-hook>\nYou are a Stop hook evaluator for a long-running /goal.\n\n<goal-objective>\nall unit tests pass\n</goal-objective>',
}
const userHook = { type: 'prompt' as const, prompt: 'Is the build green?' }

describe('a prompt hook whose condition is not met', () => {
  test('a /goal hook asks to keep working and does not stop the turn', () => {
    const result = unmetPromptHookResult(goalHook, { reason: '2 tests still failing' })

    expect(result.blockingError).toEqual({
      blockingError: `${PROMPT_HOOK_UNMET_PREFIX}2 tests still failing`,
      command: goalHook.prompt,
    })
    expect(result.preventContinuation).toBeUndefined()
  })

  test('a /goal hook blocked on the user ends the turn without continuing and keeps the goal', () => {
    const result = unmetPromptHookResult(goalHook, { reason: 'needs staging credentials', blocked: true })

    expect(result.blockingError).toBeUndefined()
    expect(result.preventContinuation).toBeUndefined()
    expect(result.message).toBeUndefined()
  })

  test("the user's own prompt hook still stops the turn", () => {
    for (const blocked of [false, true]) {
      const result = unmetPromptHookResult(userHook, { reason: 'build is red', blocked })

      expect(result.blockingError?.blockingError).toBe(`${PROMPT_HOOK_UNMET_PREFIX}build is red`)
      expect(result.preventContinuation).toBe(true)
      expect(result.stopReason).toBe('build is red')
    }
  })

  test('the evaluator can answer that it is blocked on the user', () => {
    expect(promptHookResponseSchema().parse({ ok: false, reason: 'needs credentials', blocked: true })).toEqual({
      ok: false,
      reason: 'needs credentials',
      blocked: true,
    })
  })
})
