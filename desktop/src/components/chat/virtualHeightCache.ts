// Module-level caches keyed by sessionId so switching tabs back to a previously
// rendered long transcript can skip estimate→measure thrash. Bounded by an LRU
// across sessions to avoid unbounded growth across long-running sessions.

export type VirtualRenderItemMetric = {
  signature: string
  contentWeight: number
  estimatedHeight: number
}

const MAX_TRACKED_SESSIONS = 16

const sessionHeightCache = new Map<string, Map<string, number>>()
const sessionMetricCache = new Map<string, Map<string, VirtualRenderItemMetric>>()

function touchSession(sessionId: string, map: Map<string, Map<string, unknown>>) {
  // Reinsert to move to LRU tail.
  const existing = map.get(sessionId)
  if (existing) {
    map.delete(sessionId)
    map.set(sessionId, existing)
  }
}

function evictSessionsBeyondLimit(): void {
  while (sessionHeightCache.size > MAX_TRACKED_SESSIONS) {
    const oldest = sessionHeightCache.keys().next().value
    if (typeof oldest !== 'string') break
    sessionHeightCache.delete(oldest)
    sessionMetricCache.delete(oldest)
  }
}

export function getHeightsForSession(sessionId: string): Map<string, number> {
  let heights = sessionHeightCache.get(sessionId)
  if (!heights) {
    heights = new Map<string, number>()
    sessionHeightCache.set(sessionId, heights)
    evictSessionsBeyondLimit()
  } else {
    touchSession(sessionId, sessionHeightCache as Map<string, Map<string, unknown>>)
  }
  return heights
}

export function getMetricsForSession(sessionId: string): Map<string, VirtualRenderItemMetric> {
  let metrics = sessionMetricCache.get(sessionId)
  if (!metrics) {
    metrics = new Map<string, VirtualRenderItemMetric>()
    sessionMetricCache.set(sessionId, metrics)
  } else {
    touchSession(sessionId, sessionMetricCache as Map<string, Map<string, unknown>>)
  }
  return metrics
}

export function dropSession(sessionId: string): void {
  sessionHeightCache.delete(sessionId)
  sessionMetricCache.delete(sessionId)
}

export const __virtualHeightCacheInternals = {
  size: () => sessionHeightCache.size,
  reset: () => {
    sessionHeightCache.clear()
    sessionMetricCache.clear()
  },
}
