import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearCommandQueue,
  dequeue,
  dequeueAllMatching,
  enqueue,
  getCommandsByMaxPriority,
} from './messageQueueManager.js'

afterEach(() => {
  clearCommandQueue()
})

function queuePrompts() {
  enqueue({ mode: 'prompt', value: 'typed during the turn', uuid: 'later-1', priority: 'later' })
  enqueue({ mode: 'prompt', value: 'from another session', uuid: 'next-1' })
}

describe('a user message queued with later priority', () => {
  test('is left out of the mid-turn drain that ends at next priority', () => {
    queuePrompts()

    expect(getCommandsByMaxPriority('next').map(command => command.uuid)).toEqual(['next-1'])
  })

  test('is part of the drain after a Sleep call', () => {
    queuePrompts()

    expect(getCommandsByMaxPriority('later').map(command => command.uuid)).toEqual(['later-1', 'next-1'])
  })

  test('is processed once the turn has ended and nothing more urgent is waiting', () => {
    queuePrompts()
    dequeueAllMatching(command => command.uuid === 'next-1')

    expect(dequeue()?.uuid).toBe('later-1')
  })

  test('can be withdrawn by uuid before it starts', () => {
    queuePrompts()

    expect(dequeueAllMatching(command => command.uuid === 'later-1')).toHaveLength(1)
    expect(dequeueAllMatching(command => command.uuid === 'later-1')).toHaveLength(0)
  })
})
