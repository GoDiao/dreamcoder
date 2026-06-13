#!/usr/bin/env bun
/**
 * Store Benchmark — micro-benchmark for Zustand session update patterns
 *
 * Compares Record<string, T> spread vs Map<string, T> set for updateSessionIn.
 * Simulates the content_delta hot path: 50 sessions, 10000 rapid updates.
 *
 * Run directly: bun run scripts/benchmark/store.ts
 * Via compare:  bun run scripts/benchmark/compare.ts store
 */

import { gitInfo, median, percentile, fmtMs, writeResult, type BenchResult } from './_common.ts'

// ─── Mock per-session state ───────────────────────────────────────────

interface PerSessionState {
  messages: Array<{ id: string; type: string; content: string; timestamp: number }>
  chatState: string
  connectionState: string
  streamingText: string
  streamingToolInput: string
  activeToolUseId: string | null
  activeToolName: string | null
  activeThinkingId: string | null
  pendingPermission: unknown
  pendingComputerUsePermission: unknown
  tokenUsage: { input_tokens: number; output_tokens: number }
  elapsedSeconds: number
  statusVerb: string
  slashCommands: unknown[]
  agentTaskNotifications: Record<string, unknown>
}

function makeSession(id: string): PerSessionState {
  return {
    messages: [{ id: `msg-${id}-1`, type: 'assistant_text', content: 'hello '.repeat(50), timestamp: Date.now() }],
    chatState: 'idle',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingComputerUsePermission: null,
    tokenUsage: { input_tokens: 100, output_tokens: 200 },
    elapsedSeconds: 0,
    statusVerb: '',
    slashCommands: [],
    agentTaskNotifications: {},
  }
}

const SESSION_COUNT = 50
const UPDATE_COUNT = 10_000

// ─── Record-based store (before) ──────────────────────────────────────

function benchmarkRecord(): { totalMs: number; perUpdate: number[] } {
  const sessions: Record<string, PerSessionState> = {}
  const ids: string[] = []
  for (let i = 0; i < SESSION_COUNT; i++) {
    const id = `session-${i}`
    ids.push(id)
    sessions[id] = makeSession(id)
  }

  const perUpdate: number[] = []
  const start = performance.now()

  for (let i = 0; i < UPDATE_COUNT; i++) {
    const targetId = ids[i % SESSION_COUNT]!
    const t0 = performance.now()
    // This is the hot path: Object spread clones ALL entries
    const next = { ...sessions, [targetId]: { ...sessions[targetId]!, streamingText: `chunk-${i}` } }
    // Simulate zustand subscriber check (reference comparison)
    void next !== sessions
    perUpdate.push(performance.now() - t0)
  }

  const totalMs = performance.now() - start
  return { totalMs, perUpdate }
}

// ─── Map-based store (after) ──────────────────────────────────────────

function benchmarkMap(): { totalMs: number; perUpdate: number[] } {
  const sessions = new Map<string, PerSessionState>()
  const ids: string[] = []
  for (let i = 0; i < SESSION_COUNT; i++) {
    const id = `session-${i}`
    ids.push(id)
    sessions.set(id, makeSession(id))
  }

  const perUpdate: number[] = []
  const start = performance.now()

  for (let i = 0; i < UPDATE_COUNT; i++) {
    const targetId = ids[i % SESSION_COUNT]!
    const t0 = performance.now()
    // Map.set: O(1) pointer copy + single entry update
    const existing = sessions.get(targetId)!
    const next = new Map(sessions)
    next.set(targetId, { ...existing, streamingText: `chunk-${i}` })
    void next !== sessions
    perUpdate.push(performance.now() - t0)
  }

  const totalMs = performance.now() - start
  return { totalMs, perUpdate }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`[store] Benchmarking ${SESSION_COUNT} sessions × ${UPDATE_COUNT} updates`)

  // Warmup
  for (let i = 0; i < 3; i++) {
    benchmarkRecord()
    benchmarkMap()
  }

  // Run 5 rounds, take median
  const recordTotals: number[] = []
  const mapTotals: number[] = []
  const recordP50s: number[] = []
  const recordP99s: number[] = []
  const mapP50s: number[] = []
  const mapP99s: number[] = []

  const ROUNDS = 5
  for (let round = 0; round < ROUNDS; round++) {
    const r = benchmarkRecord()
    const m = benchmarkMap()
    recordTotals.push(r.totalMs)
    mapTotals.push(m.totalMs)
    recordP50s.push(median(r.perUpdate))
    recordP99s.push(percentile(r.perUpdate, 99))
    mapP50s.push(median(m.perUpdate))
    mapP99s.push(percentile(m.perUpdate, 99))
    console.log(`  round ${round + 1}: Record=${r.totalMs.toFixed(1)}ms  Map=${m.totalMs.toFixed(1)}ms`)
  }

  const recordTotal = median(recordTotals)
  const mapTotal = median(mapTotals)
  const recordP50 = median(recordP50s)
  const recordP99 = median(recordP99s)
  const mapP50 = median(mapP50s)
  const mapP99 = median(mapP99s)
  const speedup = recordTotal / mapTotal

  console.log('\n[store] Results (median of 5 rounds):')
  console.log(`  Record total:  ${fmtMs(recordTotal)}`)
  console.log(`  Map total:     ${fmtMs(mapTotal)}`)
  console.log(`  Speedup:       ${speedup.toFixed(2)}x`)
  console.log(`  Record p50:    ${fmtMs(recordP50)}/update`)
  console.log(`  Record p99:    ${fmtMs(recordP99)}/update`)
  console.log(`  Map p50:       ${fmtMs(mapP50)}/update`)
  console.log(`  Map p99:       ${fmtMs(mapP99)}/update`)

  const label = (process.env.BENCH_LABEL ?? 'after') as 'baseline' | 'after'
  const git = await gitInfo()
  const result: BenchResult = {
    name: 'store',
    timestamp: new Date().toISOString(),
    git,
    metrics: {
      'record_total_ms': Math.round(recordTotal * 100) / 100,
      'map_total_ms': Math.round(mapTotal * 100) / 100,
      'speedup': Math.round(speedup * 100) / 100,
      'record_p50_us': Math.round(recordP50 * 1000),
      'record_p99_us': Math.round(recordP99 * 1000),
      'map_p50_us': Math.round(mapP50 * 1000),
      'map_p99_us': Math.round(mapP99 * 1000),
      'session_count': SESSION_COUNT,
      'update_count': UPDATE_COUNT,
    },
    notes: `speedup=${speedup.toFixed(2)}x, record_total=${fmtMs(recordTotal)}, map_total=${fmtMs(mapTotal)}`,
  }
  const file = await writeResult(label, result)
  console.log(`\n[store] wrote ${file}`)
}

void main().catch(e => { console.error(e); process.exit(1) })
