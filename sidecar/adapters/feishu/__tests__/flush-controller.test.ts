import { describe, it, expect } from 'bun:test'
import { FlushController, THROTTLE } from '../flush-controller.js'

function makeControllableFlush() {
  const calls: string[] = []
  let resolveCurrent: (() => void) | null = null
  let latch: Promise<void> | null = null

  const doFlush = async () => {
    calls.push('flush-start')
    if (latch) {
      await latch
      latch = null
    }
    calls.push('flush-end')
  }

  const blockNext = () => {
    latch = new Promise<void>((resolve) => {
      resolveCurrent = resolve
    })
  }

  const unblock = () => {
    if (resolveCurrent) {
      const r = resolveCurrent
      resolveCurrent = null
      r()
    }
  }

  return { doFlush, calls, blockNext, unblock }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

describe('FlushController: cardMessageReady gate', () => {
  it('在 cardMessageReady=false 时不 flush', async () => {
    let count = 0
    const fc = new FlushController(async () => {
      count += 1
    })
    await fc.flush()
    await fc.throttledUpdate(50)
    expect(count).toBe(0)
  })

  it('setCardMessageReady(true) 后 flush 可执行', async () => {
    let count = 0
    const fc = new FlushController(async () => {
      count += 1
    })
    fc.setCardMessageReady(true)
    await fc.flush()
    expect(count).toBe(1)
  })

  it('setCardMessageReady(true) 同步初始化 lastUpdateTime —— 刚 ready 时 throttledUpdate 被节流窗口阻挡', async () => {
    let count = 0
    const fc = new FlushController(async () => {
      count += 1
    })
    fc.setCardMessageReady(true)
    await fc.throttledUpdate(500)
    expect(count).toBe(0)
    await sleep(600)
    expect(count).toBe(1)
  })
})

describe('FlushController: complete()', () => {
  it('complete() 后拒绝新 flush', async () => {
    let count = 0
    const fc = new FlushController(async () => {
      count += 1
    })
    fc.setCardMessageReady(true)
    fc.complete()
    await fc.flush()
    await fc.throttledUpdate(50)
    expect(count).toBe(0)
  })
})

describe('FlushController: 节流窗口', () => {
  it('超过窗口立即 flush', async () => {
    let count = 0
    const fc = new FlushController(async () => {
      count += 1
    })
    fc.setCardMessageReady(true)
    await sleep(150)
    await fc.throttledUpdate(100)
    expect(count).toBe(1)
  })

  it('在窗口内首次调用安排延迟 flush', async () => {
    let count = 0
    const fc = new FlushController(async () => {
      count += 1
    })
    fc.setCardMessageReady(true)

    await fc.throttledUpdate(200)
    expect(count).toBe(0)

    await sleep(300)
    expect(count).toBe(1)
  })

  it('窗口内多次调用复用同一个延迟 timer（不重复 flush）', async () => {
    let count = 0
    const fc = new FlushController(async () => {
      count += 1
    })
    fc.setCardMessageReady(true)

    await fc.throttledUpdate(200)
    await fc.throttledUpdate(200)
    await fc.throttledUpdate(200)
    await fc.throttledUpdate(200)

    await sleep(300)
    expect(count).toBe(1)
  })
})

describe('FlushController: mutex + 冲突重刷', () => {
  it('flush 进行中的重复调用不并发执行', async () => {
    const { doFlush, calls, blockNext, unblock } = makeControllableFlush()
    const fc = new FlushController(doFlush)
    fc.setCardMessageReady(true)

    blockNext()
    const p1 = fc.flush()
    await sleep(10)
    const p2 = fc.flush()

    expect(calls).toEqual(['flush-start'])

    unblock()
    await p1
    await p2
    await sleep(20)

    expect(calls).toEqual([
      'flush-start', 'flush-end',
      'flush-start', 'flush-end',
    ])
  })

  it('flush 进行中的 throttledUpdate 也会触发补刷', async () => {
    const { doFlush, calls, blockNext, unblock } = makeControllableFlush()
    const fc = new FlushController(doFlush)
    fc.setCardMessageReady(true)

    blockNext()
    const p1 = fc.flush()
    await sleep(10)

    await fc.throttledUpdate(10)

    unblock()
    await p1
    await sleep(30)

    expect(calls.filter((c) => c === 'flush-end').length).toBe(2)
  })
})

describe('FlushController: 长间隔批量', () => {
  it('elapsed > LONG_GAP_THRESHOLD_MS 时延迟 BATCH_AFTER_GAP_MS 再 flush', async () => {
    let count = 0
    let flushAtMs = 0
    const start = Date.now()
    const fc = new FlushController(async () => {
      count += 1
      flushAtMs = Date.now() - start
    })
    fc.setCardMessageReady(true)

    await sleep(THROTTLE.LONG_GAP_THRESHOLD_MS + 50)
    const callAt = Date.now() - start

    await fc.throttledUpdate(THROTTLE.CARDKIT_MS)
    expect(count).toBe(0)

    await sleep(THROTTLE.BATCH_AFTER_GAP_MS + 50)
    expect(count).toBe(1)
    expect(flushAtMs - callAt).toBeGreaterThanOrEqual(THROTTLE.BATCH_AFTER_GAP_MS - 20)
  })
})

describe('FlushController: waitForFlush', () => {
  it('没在 flush 时立即返回', async () => {
    const fc = new FlushController(async () => {})
    fc.setCardMessageReady(true)
    const start = Date.now()
    await fc.waitForFlush()
    expect(Date.now() - start).toBeLessThan(10)
  })

  it('有 flush 在跑时等它结束', async () => {
    const { doFlush, blockNext, unblock } = makeControllableFlush()
    const fc = new FlushController(doFlush)
    fc.setCardMessageReady(true)

    blockNext()
    const p1 = fc.flush()
    await sleep(10)

    let resolved = false
    const waiter = fc.waitForFlush().then(() => {
      resolved = true
    })
    await sleep(20)
    expect(resolved).toBe(false)

    unblock()
    await p1
    await waiter
    expect(resolved).toBe(true)
  })
})

describe('FlushController: THROTTLE 常量', () => {
  it('CARDKIT_MS=100, PATCH_MS=1500', () => {
    expect(THROTTLE.CARDKIT_MS).toBe(100)
    expect(THROTTLE.PATCH_MS).toBe(1500)
  })
  it('LONG_GAP_THRESHOLD_MS=2000, BATCH_AFTER_GAP_MS=300', () => {
    expect(THROTTLE.LONG_GAP_THRESHOLD_MS).toBe(2000)
    expect(THROTTLE.BATCH_AFTER_GAP_MS).toBe(300)
  })
})
