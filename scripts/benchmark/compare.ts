#!/usr/bin/env bun
/**
 * Benchmark Compare — automated baseline vs after diff
 *
 * Usage:
 *   bun run scripts/benchmark/compare.ts <bench> [baseline_ref] [after_ref]
 *
 * Examples:
 *   bun run scripts/benchmark/compare.ts bundle             # HEAD~1 vs HEAD
 *   bun run scripts/benchmark/compare.ts polling main dev   # main vs dev
 *
 * Available benches: bundle, polling, store, memory
 *
 * Flow:
 *   1. git stash --include-untracked (preserve working tree)
 *   2. git checkout <baseline_ref>
 *   3. run bench → writes .benchmark-results/<bench>-baseline.json
 *   4. git checkout <after_ref>
 *   5. run bench → writes .benchmark-results/<bench>-after.json
 *   6. diff + append markdown table to docs/perf-optimization-results-v2.md
 *   7. git checkout <original_ref> + git stash pop
 *
 * Always runs cleanup in finally{}.
 */

import * as path from 'node:path'
import { appendMarkdownSection, diffPct, readResult, run } from './_common.ts'

const REPO = 'E:/AProject/TianX/Personal/dreamfield'

const KNOWN_BENCHES = ['bundle', 'polling', 'store', 'memory'] as const
type BenchName = typeof KNOWN_BENCHES[number]

function usage(): never {
  console.error('Usage: bun run scripts/benchmark/compare.ts <bench> [baseline_ref] [after_ref]')
  console.error(`Benches: ${KNOWN_BENCHES.join(', ')}`)
  process.exit(1)
}

async function getCurrentRef(): Promise<string> {
  const out = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO })
  return out.trim()
}

async function gitCheckout(ref: string): Promise<void> {
  await run('git', ['checkout', ref], { cwd: REPO })
}

async function gitStashSave(): Promise<boolean> {
  try {
    const out = await run('git', ['stash', 'push', '--include-untracked', '-m', `bench-compare-${Date.now()}`], { cwd: REPO })
    // If "No local changes to save" appears, no stash was created
    return !out.includes('No local changes')
  } catch (e: any) {
    console.warn(`[compare] git stash failed: ${e.message}`)
    return false
  }
}

async function gitStashPop(): Promise<void> {
  try {
    await run('git', ['stash', 'pop'], { cwd: REPO })
  } catch (e: any) {
    console.warn(`[compare] git stash pop failed: ${e.message} (resolve manually)`)
  }
}

async function runBench(bench: BenchName, label: 'baseline' | 'after'): Promise<void> {
  const script = path.posix.join(REPO, 'scripts/benchmark', `${bench}.ts`)
  console.log(`[compare] Running ${bench} bench (${label})...`)
  const env: Record<string, string> = { BENCH_LABEL: label }
  await run('bun', ['run', script], { cwd: REPO, timeout: 600_000, env })
}

async function diffAndReport(bench: BenchName): Promise<void> {
  const baseline = await readResult('baseline', bench)
  const after = await readResult('after', bench)
  if (!baseline || !after) {
    console.warn(`[compare] missing baseline or after result for ${bench}, skipping markdown`)
    return
  }

  const keys = Array.from(new Set([...Object.keys(baseline.metrics), ...Object.keys(after.metrics)]))
  const rows: string[] = []
  rows.push('| Metric | Baseline | After | Delta |')
  rows.push('|---|---|---|---|')
  for (const key of keys) {
    const bv = baseline.metrics[key]
    const av = after.metrics[key]
    const delta = typeof bv === 'number' && typeof av === 'number' ? diffPct(bv, av) : 'N/A'
    rows.push(`| ${key} | ${bv ?? 'N/A'} | ${av ?? 'N/A'} | ${delta} |`)
  }

  const heading = `Bench: \`${bench}\` (${baseline.git.ref} → ${after.git.ref})`
  await appendMarkdownSection(heading, rows.join('\n'))
  console.log(`[compare] Wrote markdown section: ${heading}`)
}

async function main() {
  const [benchArg, baselineRefArg, afterRefArg] = process.argv.slice(2)
  if (!benchArg) usage()
  if (!KNOWN_BENCHES.includes(benchArg as BenchName)) {
    console.error(`[compare] unknown bench: ${benchArg}`)
    usage()
  }
  const bench = benchArg as BenchName
  const baselineRef = baselineRefArg ?? 'HEAD~1'
  const afterRef = afterRefArg ?? 'HEAD'

  const originalRef = await getCurrentRef()
  let stashed = false
  try {
    stashed = await gitStashSave()
    console.log(`[compare] stash saved: ${stashed}`)

    await gitCheckout(baselineRef)
    await runBench(bench, 'baseline')

    await gitCheckout(afterRef)
    await runBench(bench, 'after')

    await diffAndReport(bench)
  } catch (e: any) {
    console.error(`[compare] FAILED: ${e.message}`)
    process.exitCode = 1
  } finally {
    try {
      await gitCheckout(originalRef)
    } catch (e: any) {
      console.error(`[compare] WARN: failed to restore branch ${originalRef}: ${e.message}`)
    }
    if (stashed) await gitStashPop()
    console.log('[compare] done')
  }
}

void main()
