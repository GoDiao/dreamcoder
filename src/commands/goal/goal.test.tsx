import { afterEach, describe, expect, test } from 'bun:test'
import { setIsInteractive, switchSession } from '../../bootstrap/state.js'
import type { SessionId } from '../../types/ids.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import { createCommandInputMessage } from '../../utils/messages.js'
import { call } from './goal.js'

afterEach(() => {
  setIsInteractive(true)
})

async function runGoal(args: string, context: Partial<LocalJSXCommandContext> = {}) {
  const calls: Array<{
    result?: string
    options?: {
      display?: string
      shouldQuery?: boolean
      metaMessages?: string[]
    }
  }> = []

  await call(
    (result, options) => {
      calls.push({ result, options })
    },
    {
      messages: [],
      setAppState: updater => updater({ sessionHooks: new Map() } as any),
      ...context,
    } as LocalJSXCommandContext,
    args,
  )

  expect(calls).toHaveLength(1)
  return calls[0]!
}

describe('/goal command', () => {
  test('sets and clears a goal in one CLI session', async () => {
    setIsInteractive(false)
    switchSession(`goal-command-${crypto.randomUUID()}` as SessionId)

    const created = await runGoal('ship the smoke test')
    expect(created.result).toBe('Goal set: ship the smoke test')
    expect(created.options).toMatchObject({
      display: 'system',
      shouldQuery: true,
    })
    expect(created.options?.metaMessages).toBeUndefined()

    const replaced = await runGoal('ship the replacement target')
    expect(replaced.result).toBe('Goal set: ship the replacement target')
    expect(replaced.options).toMatchObject({
      display: 'system',
      shouldQuery: true,
    })
    expect(replaced.options?.metaMessages).toBeUndefined()

    const cleared = await runGoal('clear')
    expect(cleared.result).toBe('Goal cleared: ship the replacement target')
    expect(cleared.options).toMatchObject({
      display: 'system',
    })

    const empty = await runGoal('')
    expect(empty.result).toBe('Usage: /goal <condition> | clear')
    expect(empty.options).toMatchObject({
      display: 'system',
    })
  })

  test('reports usage errors without querying the model', async () => {
    setIsInteractive(false)
    switchSession(`goal-command-${crypto.randomUUID()}` as SessionId)

    const result = await runGoal('')

    expect(result.result).toBe('Usage: /goal <condition> | clear')
    expect(result.options).toMatchObject({
      display: 'system',
    })
    expect(result.options?.shouldQuery).toBeUndefined()
  })

  test('does not treat removed subcommands as replacement goals', async () => {
    setIsInteractive(false)
    switchSession(`goal-command-${crypto.randomUUID()}` as SessionId)

    const created = await runGoal('ship the smoke test')
    expect(created.result).toBe('Goal set: ship the smoke test')

    const status = await runGoal('status')
    expect(status.result).toBe('Usage: /goal <condition> | clear')
    expect(status.options?.shouldQuery).toBeUndefined()

    const cleared = await runGoal('clear')
    expect(cleared.result).toBe('Goal cleared: ship the smoke test')
  })

  test('clears active goal state restored from persisted slash command history', async () => {
    setIsInteractive(false)
    switchSession(`goal-command-${crypto.randomUUID()}` as SessionId)

    const result = await runGoal('clear', {
      messages: [
        createCommandInputMessage([
          '<command-name>/goal</command-name>',
          '<command-args>ship persisted goal</command-args>',
        ].join('\n')),
        createCommandInputMessage([
          '<local-command-stdout>',
          'Goal set: ship persisted goal',
          '</local-command-stdout>',
        ].join('\n')),
      ],
    })

    expect(result.result).toBe('Goal cleared: ship persisted goal')
  })
})
