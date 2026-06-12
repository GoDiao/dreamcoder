#!/usr/bin/env bun
/**
 * Store E2E Benchmark — Batch B production hot-path simulation
 *
 * Simulates the *real* bottleneck Batch B addresses:
 *   - `sessionStore.getSessionById(id)` called by MessageList / Sidebar /
 *     StatusBar etc. ~once per render frame, multiplied across components.
 *   - Baseline = sessions stored as `SessionListItem[]` + `.find(s => s.id===id)`
 *   - After    = sessions stored in `Map<string, SessionListItem>`, O(1) get
 *
 * We measure: N sessions × M lookups, total ms + p99 per lookup.
 *
 * Run:  bun run scripts/benchmark/store-e2e.ts
 */

import { gitInfo, median, percentile, fmtMs, writeResult, type BenchResult } from './_common.ts'

interface SessionListItem {
  id: string
  title: string
  workDir: string
  messageCount: number
  lastModified: number
}

function makeSessions(n: number): SessionListItem[] {
  const out: SessionListItem[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `sess-${i.toString().padStart(4, '0')}`,
      title: `Session ${i}`,
      workDir: `E:/projects/repo-${i % 10}`,
      messageCount: 10 + (i % 50),
      lastModified: Date.now() - i * 60_000,
    })
  }
  return out
}

const SCENARIOS = [
  { name: '5 sessions',  count: 5,   lookups: 100_000 },
  { name: '20 sessions', count: 20,  lookups: 100_000 },
  { name: '50 sessions', count: 50,  lookups: 100_000 },
  { name: '100 sessions', count: 100, lookups: 100_000 },
] as const

function benchArrayFind(sessions: SessionListItem[], lookups: number, queryIds: string[]) {
  const start = performance.now()
  let hit = 0
  for (let i = 0; i < lookups; i++) {
    const id = queryIds[i % queryIds.length]!
    const found = sessions.find(s => s.id === id)
    if (found) hit++
  }
  return { ms: performance.now() - start, hit }
}

function benchMapGet(sessions: Map<string, SessionListItem>, lookups: number, queryIds: string[]) {
  const start = performance.now()
  let hit = 0
  for (let i = 0; i < lookups; i++) {
    const id = queryIds[i % queryIds.length]!
    const found = sessions.get(id)
    if (found) hit++
  }
  return { ms: performance.now() - start, hit }
}

function benchPerLookupSamples(sessions: SessionListItem[] | Map<string, SessionListItem>, lookups: number, queryIds: string[], mode: 'array' | 'map') {
  const samples: number[] = []
  const sampleEvery = Math.max(1, Math.floor(lookups / 1000)) // ~1000 samples for p99
  for (let i = 0; i < lookups; i++) {
    const id = queryIds[i % queryIds.length]!
    if (i % sampleEvery === 0) {
      const t0 = performance.now()
      if (mode === 'array') (sessions as SessionListItem[]).find(s => s.id === id)
      else (sessions as Map<string, SessionListItem>).get(id)
      samples.push(performance.now() - t0)
    } else {
      if (mode === 'array') (sessions as SessionListItem[]).find(s => s.id === id)
      else (sessions as Map<string, SessionListItem>).get(id)
    }
  }
  return samples
}

async function main() {
  console.log('[store-e2e] simulating production getSessionById hot path')
  console.log('[store-e2e] (MessageList / Sidebar / TabBar each call ~1/frame)')

  const metrics: Record<string, number | string> = {}
  const ROUNDS = 5

  for (const sc of SCENARIOS) {
    const sessions = makeSessions(sc.count)
    const sessionsMap = new Map(sessions.map(s => [s.id, s]))
    // realistic: ~80% lookups hit recently-active sessions (Zipf-ish)
    const queryIds = Array.from({ length: 100 }, (_, i) => sessions[i % Math.min(sc.count, 10)]!.id)

    // warmup
    for (let r = 0; r < 3; r++) {
      benchArrayFind(sessions, 10_000, queryIds)
      benchMapGet(sessionsMap, 10_000, queryIds)
    }

    const arrTotals: number[] = []
    const mapTotals: number[] = []
    for (let r = 0; r < ROUNDS; r++) {
      arrTotals.push(benchArrayFind(sessions, sc.lookups, queryIds).ms)
      mapTotals.push(benchMapGet(sessionsMap, sc.lookups, queryIds).ms)
    }

    const arrSamples = benchPerLookupSamples(sessions, sc.lookups, queryIds, 'array')
    const mapSamples = benchPerLookupSamples(sessionsMap, sc.lookups, queryIds, 'map')

    const arrTotal = median(arrTotals)
    const mapTotal = median(mapTotals)
    const arrP99 = percentile(arrSamples, 99)
    const mapP99 = percentile(mapSamples, 99)
    const speedup = arrTotal / mapTotal

    console.log(`\n  [${sc.name}] ${sc.lookups.toLocaleString()} lookups`)
    console.log(`    Array.find total:  ${fmtMs(arrTotal)}   p99/lookup: ${fmtMs(arrP99)}`)
    console.log(`    Map.get   total:   ${fmtMs(mapTotal)}   p99/lookup: ${fmtMs(mapP99)}`)
    console.log(`    Speedup:           ${speedup.toFixed(2)}x`)

    const k = `s${sc.count}`
    metrics[`${k}_arr_total_ms`] = Math.round(arrTotal * 100) / 100
    metrics[`${k}_map_total_ms`] = Math.round(mapTotal * 100) / 100
    metrics[`${k}_speedup`]      = Math.round(speedup * 100) / 100
    metrics[`${k}_arr_p99_us`]   = Math.round(arrP99 * 1000)
    metrics[`${k}_map_p99_us`]   = Math.round(mapP99 * 1000)
  }

  const label = (process.env.BENCH_LABEL ?? 'after') as 'baseline' | 'after'
  const git = await gitInfo()
  const result: BenchResult = {
    name: 'store-e2e',
    timestamp: new Date().toISOString(),
    git,
    metrics,
    notes: 'simulates getSessionById hot path: array.find (baseline) vs Map.get (after)',
  }
  const file = await writeResult(label, result)
  console.log(`\n[store-e2e] wrote ${file}`)
}

void main().catch(e => { console.error(e); process.exit(1) })
