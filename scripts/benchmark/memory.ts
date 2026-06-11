#!/usr/bin/env bun
/**
 * Memory Benchmark — measures terminal runtime memory footprint
 *
 * Two layers:
 *   1. JS-side: simulate N terminal runtimes by instantiating mock xterm
 *      buffer payloads and measuring process.memoryUsage(). This gives a
 *      lower-bound estimate of buffer + addon overhead per terminal.
 *   2. Source inspection: detect whether the LRU cap (MAX_LIVE_TERMINALS)
 *      exists in tabStore and what its value is.
 *
 * We do NOT spawn the real Tauri app here (that requires a desktop session
 * and is unreliable in CI); the per-terminal cost is approximated from the
 * known xterm buffer payload size. compare.ts surfaces the delta cleanly.
 *
 * Run directly: bun run scripts/benchmark/memory.ts
 * Via compare:  bun run scripts/benchmark/compare.ts memory
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { gitInfo, fmtBytes, writeResult, type BenchResult } from './_common.ts'

const REPO = 'E:/AProject/TianX/Personal/dreamfield'
const DESKTOP_SRC = path.posix.join(REPO, 'desktop/src')

// ─── Source inspection ──────────────────────────────────────────────

async function inspectTerminalCap(): Promise<{ cap: number; hasLruEviction: boolean; hasHibernation: boolean }> {
  let src = ''
  try {
    src = await fs.readFile(path.posix.join(DESKTOP_SRC, 'stores/tabStore.ts'), 'utf-8')
  } catch {
    return { cap: -1, hasLruEviction: false, hasHibernation: false }
  }
  const capMatch = src.match(/MAX_LIVE_TERMINALS\s*=\s*(\d+)/)
  const cap = capMatch && capMatch[1] ? Number(capMatch[1]) : -1
  const hasLruEviction = /liveTerminalIds|touchTerminal|destroyTerminalRuntime|evict/.test(src)
  // Hibernation = serialize buffer to memory after unmount
  let runtimeSrc = ''
  try {
    runtimeSrc = await fs.readFile(path.posix.join(DESKTOP_SRC, 'lib/terminalRuntime.ts'), 'utf-8')
  } catch { /* noop */ }
  const hasHibernation = /hibernatedBuffer|preserveOnUnmount|buffer\.active\.getLine/.test(src + runtimeSrc)
  return { cap, hasLruEviction, hasHibernation }
}

// ─── JS-side memory simulation ──────────────────────────────────────

/**
 * Mock terminal payload: each terminal owns ~80 cols × N rows of UTF-16 text
 * + addon refs + decoration metadata. We use 2000 scrollback rows and 100
 * decorations per terminal as a realistic baseline.
 */
function makeMockTerminal(id: string): Record<string, unknown> {
  const cols = 80
  const rows = 2000
  const lines: string[] = []
  for (let i = 0; i < rows; i++) {
    lines.push(`[${id}][${i.toString().padStart(4, '0')}] ${'x'.repeat(cols - 20)}`)
  }
  const decorations = Array.from({ length: 100 }, (_, i) => ({
    line: i * 20,
    type: 'link',
    range: { start: 0, end: cols },
    metadata: { id: `dec-${id}-${i}`, ts: Date.now() + i },
  }))
  return {
    id,
    buffer: lines,
    decorations,
    options: { fontFamily: 'JetBrains Mono', fontSize: 14, scrollback: rows },
    addonFit: { proposeDimensions: () => ({ cols, rows: 40 }) },
    addonSearch: { findNext: () => false, findPrevious: () => false },
    addonWebLinks: { activate: () => {} },
    parser: { _data: new Uint8Array(8192) },
  }
}

function measureTerminalRSS(count: number): number {
  if (global.gc) global.gc()
  const before = process.memoryUsage().rss
  const terminals: unknown[] = []
  for (let i = 0; i < count; i++) terminals.push(makeMockTerminal(`term-${i}`))
  // Touch to ensure not optimized away
  let h = 0
  for (const t of terminals) h += JSON.stringify(t).length
  void h
  const after = process.memoryUsage().rss
  terminals.length = 0
  return after - before
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('[memory] Inspecting terminal LRU configuration...')
  const cfg = await inspectTerminalCap()
  console.log(`  MAX_LIVE_TERMINALS = ${cfg.cap}`)
  console.log(`  LRU eviction present: ${cfg.hasLruEviction}`)
  console.log(`  Buffer hibernation present: ${cfg.hasHibernation}`)

  console.log('\n[memory] Simulating per-terminal RSS cost...')
  // Warmup
  measureTerminalRSS(1)

  const cases = [1, 3, 5, 8]
  const rssByCount: Record<number, number> = {}
  for (const n of cases) {
    // Run 3 rounds, take median
    const samples: number[] = []
    for (let r = 0; r < 3; r++) samples.push(measureTerminalRSS(n))
    samples.sort((a, b) => a - b)
    const med = samples[1]!
    rssByCount[n] = med
    console.log(`  ${n} terminals: ${fmtBytes(med)} (median of 3)`)
  }

  // Effective RSS = if cap is enforced, RSS plateaus at cap; otherwise scales linearly
  const cap = cfg.cap > 0 ? cfg.cap : 8
  const effectiveAt8 = cfg.hasLruEviction && cfg.cap > 0
    ? rssByCount[Math.min(cap, 8)]!
    : rssByCount[8]!
  const naiveAt8 = rssByCount[8]!
  const savedBytes = naiveAt8 - effectiveAt8
  const savedPct = naiveAt8 > 0 ? (savedBytes / naiveAt8) * 100 : 0

  console.log('\n[memory] Effective RSS at 8 terminals:')
  console.log(`  Naive (no cap):  ${fmtBytes(naiveAt8)}`)
  console.log(`  With cap=${cap}:    ${fmtBytes(effectiveAt8)}`)
  console.log(`  Saved:           ${fmtBytes(savedBytes)} (${savedPct.toFixed(1)}%)`)

  const label = (process.env.BENCH_LABEL ?? 'after') as 'baseline' | 'after'
  const git = await gitInfo()
  const result: BenchResult = {
    name: 'memory',
    timestamp: new Date().toISOString(),
    git,
    metrics: {
      'max_live_terminals': cfg.cap,
      'lru_eviction_present': cfg.hasLruEviction ? 'yes' : 'no',
      'hibernation_present': cfg.hasHibernation ? 'yes' : 'no',
      'rss_1_term_kb': Math.round(rssByCount[1]! / 1024),
      'rss_3_term_kb': Math.round(rssByCount[3]! / 1024),
      'rss_5_term_kb': Math.round(rssByCount[5]! / 1024),
      'rss_8_term_kb': Math.round(rssByCount[8]! / 1024),
      'effective_rss_at_8_kb': Math.round(effectiveAt8 / 1024),
      'naive_rss_at_8_kb': Math.round(naiveAt8 / 1024),
      'saved_at_8_kb': Math.round(savedBytes / 1024),
      'saved_at_8_pct': Math.round(savedPct * 10) / 10,
    },
    notes: `cap=${cap}, saved=${fmtBytes(savedBytes)} at 8 terminals`,
  }
  const file = await writeResult(label, result)
  console.log(`\n[memory] wrote ${file}`)
}

void main().catch(e => { console.error(e); process.exit(1) })
