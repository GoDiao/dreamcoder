import { describe, expect, test } from 'bun:test'
import { BrowserSessionTokens } from './sessionTokens.js'
import { KeyedQueue } from './keyedQueue.js'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('KeyedQueue', () => {
  test('runs tasks of one key one at a time in order', async () => {
    const queue = new KeyedQueue()
    const order: string[] = []
    const gate = deferred()
    const first = queue.run('a', async () => {
      order.push('first start')
      await gate.promise
      order.push('first end')
    })
    const second = queue.run('a', async () => {
      order.push('second')
    })
    await Promise.resolve()
    expect(order).toEqual(['first start'])
    gate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first start', 'first end', 'second'])
  })

  test('runs different keys concurrently', async () => {
    const queue = new KeyedQueue()
    const gate = deferred()
    const started: string[] = []
    const a = queue.run('a', async () => {
      started.push('a')
      await gate.promise
    })
    const b = queue.run('b', async () => {
      started.push('b')
    })
    await b
    expect(started).toEqual(['a', 'b'])
    gate.resolve()
    await a
  })

  test('keeps running after a task fails and reports the failure to its caller', async () => {
    const queue = new KeyedQueue()
    const failing = queue.run('a', async () => {
      throw new Error('boom')
    })
    const next = queue.run('a', async () => 'ok')
    await expect(failing).rejects.toThrow('boom')
    expect(await next).toBe('ok')
  })

  test('forgets a key once its queue is empty', async () => {
    const queue = new KeyedQueue()
    await queue.run('a', async () => undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(queue.size()).toBe(0)
  })
})

describe('BrowserSessionTokens', () => {
  test('issues one stable token per session and resolves it back', () => {
    const tokens = new BrowserSessionTokens()
    const token = tokens.issue('s1')
    expect(token).toHaveLength(64)
    expect(tokens.issue('s1')).toBe(token)
    expect(tokens.issue('s2')).not.toBe(token)
    expect(tokens.resolve(token)).toBe('s1')
    expect(tokens.resolve('unknown')).toBeNull()
  })

  test('stops resolving a revoked token', () => {
    const tokens = new BrowserSessionTokens()
    const token = tokens.issue('s1')
    tokens.revoke('s1')
    expect(tokens.resolve(token)).toBeNull()
    expect(tokens.issue('s1')).not.toBe(token)
  })
})
