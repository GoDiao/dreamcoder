#!/usr/bin/env bun
/**
 * Polling Benchmark — measures polling cadence & localStorage write rate
 *
 * This is a code-level (not network-level) benchmark. It computes the
 * theoretical request and persistence rates by inspecting the current
 * source code for known polling intervals & throttle/debounce constants.
 *
 * The values are derived from these files (kept in sync with the plan):
 *   - desktop/src/hooks/useScheduledTaskDesktopNotifications.ts (task poll)
 *   - desktop/src/pages/ActiveSession.tsx                       (task poll)
 *   - desktop/src/stores/teamStore.ts                           (team retry)
 *   - desktop/src/stores/uiStore.ts                             (sidebar persist)
 *
 * If the constants are not detectable, we emit -1 and rely on compare.ts
 * to surface that as N/A in the markdown diff.
 *
 * Run directly: bun run scripts/benchmark/polling.ts
 * Via compare:  bun run scripts/benchmark/compare.ts polling
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { gitInfo, writeResult, type BenchResult } from './_common.ts'

const REPO = 'E:/AProject/TianX/Personal/dreamfield'
const DESKTOP_SRC = path.posix.join(REPO, 'desktop/src')

// ─── Helpers ─────────────────────────────────────────────────────────

async function read(rel: string): Promise<string> {
  try {
    return await fs.readFile(path.posix.join(DESKTOP_SRC, rel), 'utf-8')
  } catch {
    return ''
  }
}

/** Find a numeric constant defined as `const NAME = <number>` or assigned in setInterval. */
function matchInterval(src: string, patterns: RegExp[]): number {
  for (const re of patterns) {
    const m = src.match(re)
    if (m && m[1]) {
      const raw = m[1].replace(/[_,]/g, '')
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return -1
}

/** Detect whether a file persists every call vs uses a debounce/throttle. */
function hasDebounceWrapper(src: string, storageKey: string): boolean {
  // Look for setTimeout/clearTimeout near setItem(storageKey)
  const escKey = storageKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const window = new RegExp(`setItem\\([^)]*${escKey}[\\s\\S]{0,400}`, 'g')
  const before = new RegExp(`(setTimeout|requestIdleCallback|debounce|throttle)[\\s\\S]{0,400}setItem\\([^)]*${escKey}`, 'm')
  return before.test(src) || /(setTimeout|debounce|throttle)/.test(src.match(window)?.[0] ?? '')
}

// ─── Measurements ────────────────────────────────────────────────────

async function measureTaskNotificationPoll(): Promise<{ intervalMs: number; slowMs: number; hasShortCircuit: boolean }> {
  const src = await read('hooks/useScheduledTaskDesktopNotifications.ts')
  // The hook uses two-speed polling: POLL_FAST_MS (active tasks) and POLL_SLOW_MS (idle)
  const fastMs = matchInterval(src, [
    /POLL_FAST_MS\s*=\s*([\d_]+)/,
    /POLL_FAST\s*=\s*([\d_]+)/,
  ])
  const slowMs = matchInterval(src, [
    /POLL_SLOW_MS\s*=\s*([\d_]+)/,
    /POLL_SLOW\s*=\s*([\d_]+)/,
  ])
  // Report the fast interval as the primary metric (worst case for request count)
  const intervalMs = fastMs > 0 ? fastMs : matchInterval(src, [
    /POLL_INTERVAL_MS\s*=\s*([\d_]+)/,
    /setInterval\([^,]+,\s*([\d_]+)/,
  ])
  const hasShortCircuit = /tasks\.length\s*===\s*0|if\s*\(\s*!?tasks\.length|nextDelay\s*=\s*POLL_SLOW/.test(src)
  return { intervalMs, slowMs, hasShortCircuit }
}

async function measureActiveSessionPoll(): Promise<{ intervalMs: number }> {
  const src = await read('pages/ActiveSession.tsx')
  const intervalMs = matchInterval(src, [
    /TASK_POLL_INTERVAL_MS\s*=\s*([\d_]+)/,
    /TASK_POLL_MS\s*=\s*([\d_]+)/,
    /setInterval\([^,]+,\s*([\d_]+)/,
  ])
  return { intervalMs }
}

async function measureTeamRetry(): Promise<{ totalAttempts: number; usesBackoff: boolean }> {
  const src = await read('stores/teamStore.ts')
  // Count distinct setTimeout calls inside handleTeamCreated body
  const handlerMatch = src.match(/handleTeamCreated[\s\S]{0,2000}/)
  const handlerBody = handlerMatch?.[0] ?? ''
  const setTimeouts = (handlerBody.match(/setTimeout\s*\(/g) ?? []).length
  const usesBackoff = /retryWithBackoff|exponential|Math\.pow\(2/.test(handlerBody)
  return { totalAttempts: setTimeouts > 0 ? setTimeouts : (usesBackoff ? 3 : -1), usesBackoff }
}

async function measureSidebarPersist(): Promise<{ debounced: boolean; debounceMs: number }> {
  const src = await read('stores/uiStore.ts')
  const debounced = hasDebounceWrapper(src, 'SIDEBAR_WIDTH_STORAGE_KEY')
                 || hasDebounceWrapper(src, "'dreamcoder-sidebar-width'")
                 || hasDebounceWrapper(src, '"dreamcoder-sidebar-width"')
  const debounceMs = matchInterval(src, [
    /SIDEBAR_PERSIST_DEBOUNCE_MS\s*=\s*([\d_]+)/,
    /sidebarPersistDebounce[^=]*=\s*([\d_]+)/,
  ])
  return { debounced, debounceMs }
}

// ─── Projected counts over a 5-minute window ─────────────────────────

const WINDOW_MS = 5 * 60_000
const SIDEBAR_DRAG_WINDOW_MS = 60_000
const SIDEBAR_DRAG_EVENTS_PER_SEC = 60 // typical mousemove rate

function projectRequests(intervalMs: number): number {
  if (intervalMs <= 0) return -1
  return Math.floor(WINDOW_MS / intervalMs)
}

function projectSidebarWrites(debounced: boolean, debounceMs: number): number {
  const dragEvents = (SIDEBAR_DRAG_WINDOW_MS / 1000) * SIDEBAR_DRAG_EVENTS_PER_SEC
  if (!debounced) return dragEvents
  const debounceWindow = debounceMs > 0 ? debounceMs : 300
  // Debounced writes: one per (dragWindow / debounce) at worst, plus tail flush
  return Math.ceil(SIDEBAR_DRAG_WINDOW_MS / debounceWindow) + 1
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('[polling] Measuring polling cadence from source...')

  const taskNotif = await measureTaskNotificationPoll()
  const activeSession = await measureActiveSessionPoll()
  const teamRetry = await measureTeamRetry()
  const sidebar = await measureSidebarPersist()

  const taskNotifReqs5m = projectRequests(taskNotif.intervalMs)
                          * (taskNotif.hasShortCircuit ? 1 : 2)
  const activeSessionReqs5m = projectRequests(activeSession.intervalMs)
  const sidebarWrites60s = projectSidebarWrites(sidebar.debounced, sidebar.debounceMs)

  console.log('\n[polling] Measurements:')
  console.log(`  Task notification poll interval:  ${taskNotif.intervalMs}ms (short-circuit: ${taskNotif.hasShortCircuit})`)
  console.log(`    → projected 5min requests:      ${taskNotifReqs5m}`)
  console.log(`  ActiveSession task poll interval: ${activeSession.intervalMs}ms`)
  console.log(`    → projected 5min requests:      ${activeSessionReqs5m}`)
  console.log(`  Team retry attempts:              ${teamRetry.totalAttempts} (backoff: ${teamRetry.usesBackoff})`)
  console.log(`  Sidebar persist debounced:        ${sidebar.debounced} (${sidebar.debounceMs > 0 ? sidebar.debounceMs + 'ms' : 'default'})`)
  console.log(`    → projected 60s drag writes:    ${sidebarWrites60s}`)

  const label = (process.env.BENCH_LABEL ?? 'after') as 'baseline' | 'after'
  const git = await gitInfo()
  const result: BenchResult = {
    name: 'polling',
    timestamp: new Date().toISOString(),
    git,
    metrics: {
      'task_notif_interval_ms': taskNotif.intervalMs,
      'task_notif_slow_ms': taskNotif.slowMs,
      'task_notif_short_circuit': taskNotif.hasShortCircuit ? 'yes' : 'no',
      'task_notif_reqs_5min': taskNotifReqs5m,
      'active_session_interval_ms': activeSession.intervalMs,
      'active_session_reqs_5min': activeSessionReqs5m,
      'team_retry_attempts': teamRetry.totalAttempts,
      'team_retry_uses_backoff': teamRetry.usesBackoff ? 'yes' : 'no',
      'sidebar_debounced': sidebar.debounced ? 'yes' : 'no',
      'sidebar_debounce_ms': sidebar.debounceMs,
      'sidebar_writes_60s_drag': sidebarWrites60s,
    },
    notes: `5min window: task=${taskNotifReqs5m}, session=${activeSessionReqs5m}; 60s drag: sidebar=${sidebarWrites60s}`,
  }
  const file = await writeResult(label, result)
  console.log(`\n[polling] wrote ${file}`)
}

void main().catch(e => { console.error(e); process.exit(1) })
