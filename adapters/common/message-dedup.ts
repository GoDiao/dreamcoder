const DEFAULT_TTL_MS = 10 * 60_000
const DEFAULT_MAX_ENTRIES = 5000
const SWEEP_INTERVAL_MS = 60_000

export class MessageDedup {
  private store = new Map<string, number>()
  private sweepTimer: ReturnType<typeof setInterval>

  constructor(
    private ttlMs = DEFAULT_TTL_MS,
    private maxEntries = DEFAULT_MAX_ENTRIES,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
  }

  tryRecord(id: string): boolean {
    const now = Date.now()
    const existing = this.store.get(id)

    if (existing !== undefined && now - existing < this.ttlMs) {
      return false
    }

    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }

    this.store.set(id, now)
    return true
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, ts] of this.store) {
      if (now - ts >= this.ttlMs) {
        this.store.delete(key)
      } else {
        break
      }
    }
  }

  destroy(): void {
    clearInterval(this.sweepTimer)
    this.store.clear()
  }
}
