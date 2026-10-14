export const THROTTLE = {
  CARDKIT_MS: 100,
  PATCH_MS: 1500,
  LONG_GAP_THRESHOLD_MS: 2000,
  BATCH_AFTER_GAP_MS: 300,
} as const

export class FlushController {
  private flushInProgress = false
  private flushResolvers: Array<() => void> = []
  private needsReflush = false
  private pendingFlushTimer: ReturnType<typeof setTimeout> | null = null
  private lastUpdateTime = 0
  private isCompleted = false
  private _cardMessageReady = false

  constructor(private readonly doFlush: () => Promise<void>) {}

  complete(): void {
    this.isCompleted = true
  }

  cancelPendingFlush(): void {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer)
      this.pendingFlushTimer = null
    }
  }

  waitForFlush(): Promise<void> {
    if (!this.flushInProgress) return Promise.resolve()
    return new Promise<void>((resolve) => this.flushResolvers.push(resolve))
  }

  setCardMessageReady(ready: boolean): void {
    this._cardMessageReady = ready
    if (ready) this.lastUpdateTime = Date.now()
  }

  cardMessageReady(): boolean {
    return this._cardMessageReady
  }

  async flush(): Promise<void> {
    if (!this.cardMessageReady() || this.flushInProgress || this.isCompleted) {
      if (this.flushInProgress && !this.isCompleted) this.needsReflush = true
      return
    }
    this.flushInProgress = true
    this.needsReflush = false
    this.lastUpdateTime = Date.now()
    try {
      await this.doFlush()
      this.lastUpdateTime = Date.now()
    } finally {
      this.flushInProgress = false
      const resolvers = this.flushResolvers
      this.flushResolvers = []
      for (const resolve of resolvers) resolve()

      if (this.needsReflush && !this.isCompleted && !this.pendingFlushTimer) {
        this.needsReflush = false
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null
          void this.flush()
        }, 0)
      }
    }
  }

  async throttledUpdate(throttleMs: number): Promise<void> {
    if (!this.cardMessageReady()) return

    const now = Date.now()
    const elapsed = now - this.lastUpdateTime

    if (elapsed >= throttleMs) {
      this.cancelPendingFlush()
      if (elapsed > THROTTLE.LONG_GAP_THRESHOLD_MS) {
        this.lastUpdateTime = now
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null
          void this.flush()
        }, THROTTLE.BATCH_AFTER_GAP_MS)
      } else {
        await this.flush()
      }
    } else if (!this.pendingFlushTimer) {
      const delay = throttleMs - elapsed
      this.pendingFlushTimer = setTimeout(() => {
        this.pendingFlushTimer = null
        void this.flush()
      }, delay)
    }
  }
}
