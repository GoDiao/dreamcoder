import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearCommandQueue,
  dequeue,
  dequeueAllMatching,
  enqueue,
  getCommandsByMaxPriority,
} from './messageQueueManager.js'

const LATER = '00000000-0000-4000-8000-000000000001'
const NEXT = '00000000-0000-4000-8000-000000000002'

afterEach(() => {
  clearCommandQueue()
})

function queuePrompts() {
  enqueue({ mode: 'prompt', value: 'typed during the turn', uuid: LATER, priority: 'later' })
  enqueue({ mode: 'prompt', value: 'from another session', uuid: NEXT })
}

describe('a user message queued with later priority', () => {
  test('is left out of the mid-turn drain that ends at next priority', () => {
    queuePrompts()

    expect(getCommandsByMaxPriority('next').map(command => command.uuid)).toEqual([NEXT])
  })

  test('is part of the drain after a Sleep call', () => {
    queuePrompts()

    expect(getCommandsByMaxPriority('later').map(command => command.uuid)).toEqual([LATER, NEXT])
  })

  test('is processed once the turn has ended and nothing more urgent is waiting', () => {
    queuePrompts()
    dequeueAllMatching(command => command.uuid === NEXT)

    expect(dequeue()?.uuid).toBe(LATER)
  })

  test('can be withdrawn by uuid before it starts', () => {
    queuePrompts()

    expect(dequeueAllMatching(command => command.uuid === LATER)).toHaveLength(1)
    expect(dequeueAllMatching(command => command.uuid === LATER)).toHaveLength(0)
  })
})
