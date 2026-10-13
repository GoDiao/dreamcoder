import { afterEach, describe, expect, it, vi } from 'vitest'

import { isProcessAlive, parseParentPid, startParentWatchdog } from './parentWatchdog'

describe('parseParentPid', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['abc', null],
    ['12a', null],
    ['-5', null],
    ['0', null],
    ['1', null],
    ['4242', 4242],
  ])('parses %j as %j', (value, expected) => {
    expect(parseParentPid(value)).toBe(expected)
  })
})

describe('isProcessAlive', () => {
  it('reports the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('treats ESRCH as gone and EPERM as alive', () => {
    const kill = vi.spyOn(process, 'kill')
    kill.mockImplementationOnce(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) })
    expect(isProcessAlive(1234)).toBe(false)
    kill.mockImplementationOnce(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    expect(isProcessAlive(1234)).toBe(true)
    kill.mockRestore()
  })
})

describe('startParentWatchdog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing without a parent pid', () => {
    expect(startParentWatchdog({ parentPid: null })).toBeNull()
  })

  it('exits once the parent process disappears, and only once', () => {
    vi.useFakeTimers()
    let alive = true
    const onParentExit = vi.fn()

    startParentWatchdog({ parentPid: 4242, isAlive: () => alive, onParentExit, intervalMs: 1000 })

    vi.advanceTimersByTime(3000)
    expect(onParentExit).not.toHaveBeenCalled()

    alive = false
    vi.advanceTimersByTime(1000)
    expect(onParentExit).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(onParentExit).toHaveBeenCalledTimes(1)
  })

  it('stops checking after being cancelled', () => {
    vi.useFakeTimers()
    const isAlive = vi.fn(() => false)
    const onParentExit = vi.fn()

    const stop = startParentWatchdog({ parentPid: 4242, isAlive, onParentExit, intervalMs: 1000 })
    stop?.()
    vi.advanceTimersByTime(5000)

    expect(isAlive).not.toHaveBeenCalled()
    expect(onParentExit).not.toHaveBeenCalled()
  })
})
