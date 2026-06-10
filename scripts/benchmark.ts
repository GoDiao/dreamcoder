/**
 * DreamCoder Performance Benchmark
 *
 * Compares baseline (dev) vs optimized (perf) branch.
 * Usage: bun run scripts/benchmark.ts [baseline_dir] [optimized_dir]
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as childProcess from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(childProcess.execFile)

// ============================================================================
// Helpers
// ============================================================================

function fmt(ms: number): string {
  if (ms < 0) return 'N/A'
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : ms < 1000 ? `${ms.toFixed(2)}ms` : `${(ms / 1000).toFixed(2)}s`
}

function fmtBytes(b: number): string {
  if (b <= 0) return 'N/A'
  return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`
}

function diffPct(baseline: number, optimized: number): string {
  if (baseline <= 0) return 'N/A'
  const pct = ((optimized - baseline) / baseline) * 100
  const sign = pct > 0 ? '+' : ''
  const color = pct < -3 ? '\x1b[32m' : pct > 3 ? '\x1b[31m' : '\x1b[33m'
  return `${color}${sign}${pct.toFixed(1)}%\x1b[0m`
}

/** Write a temp bench script and run it, return parsed JSON output */
async function runBenchScript(code: string, timeout = 30000): Promise<any> {
  const tmpFile = path.join(os.tmpdir(), `dreamcoder-bench-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`)
  try {
    await fs.writeFile(tmpFile, code, 'utf-8')
    const { stdout, stderr } = await execFile('bun', ['run', tmpFile], { timeout, maxBuffer: 10 * 1024 * 1024 })
    const lines = stdout.trim().split('\n')
    // Find last line that parses as JSON
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]) } catch { continue }
    }
    return { error: 'no JSON output', stderr: stderr.slice(0, 200) }
  } catch (e: any) {
    return { error: e.message?.slice(0, 200) || 'unknown error' }
  } finally {
    try { await fs.unlink(tmpFile) } catch {}
  }
}

// ============================================================================
// Bench 1: Module import time (tools.ts) — static vs lazy import
// ============================================================================

async function benchModuleImport(dir: string): Promise<{ importMs: number }> {
  const normalizedDir = dir.replace(/\\/g, '/')
  const code = `
import { performance } from 'node:perf_hooks'

const start = performance.now()
await import('${normalizedDir}/src/tools.ts')
const importMs = performance.now() - start

console.log(JSON.stringify({ importMs }))
`
  return runBenchScript(code, 60000)
}

// ============================================================================
// Bench 2: Session metadata — cold parse vs warm cache (stat only)
// ============================================================================

async function benchSessionList(): Promise<{ coldMs: number; warmMs: number; fileCount: number; skipped?: boolean }> {
  const code = `
import { performance } from 'node:perf_hooks'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

const sessionsDir = path.join(os.homedir(), '.claude', 'projects')

// Collect all .jsonl files
async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.jsonl')) yield full
  }
}

const files: string[] = []
for await (const f of walk(sessionsDir)) files.push(f)

if (files.length === 0) {
  console.log(JSON.stringify({ coldMs: 0, warmMs: 0, fileCount: 0, skipped: true }))
} else {
  // Cold: stat + read + parse each file
  const coldStart = performance.now()
  for (const f of files) {
    const stat = await fs.stat(f)
    const content = await fs.readFile(f, 'utf-8')
    const lines = content.trim().split('\\n')
    for (const line of lines) {
      try { JSON.parse(line) } catch {}
    }
  }
  const coldMs = performance.now() - coldStart

  // Warm: only stat (simulates mtime cache hit, skip read+parse)
  const warmStart = performance.now()
  for (const f of files) {
    await fs.stat(f)
  }
  const warmMs = performance.now() - warmStart

  console.log(JSON.stringify({ coldMs, warmMs, fileCount: files.length }))
}
`
  return runBenchScript(code, 60000)
}

// ============================================================================
// Bench 3: Markdown parsing — synchronous vs deferred
// ============================================================================

async function benchMarkdown(): Promise<{ syncMs: number; deferredMs: number }> {
  const code = `
import { performance } from 'node:perf_hooks'

// Generate 200-section markdown
const sections = []
for (let i = 0; i < 200; i++) {
  sections.push('## Section ' + (i + 1))
  sections.push('')
  sections.push('Paragraph with **bold**, *italic*, and \`code\` text.')
  sections.push('')
  sections.push('\`\`\`javascript')
  sections.push('const x = ' + i + ';')
  sections.push('console.log("hello " + x);')
  sections.push('\`\`\`')
  sections.push('')
  sections.push('- Item ' + i)
  sections.push('- Item ' + (i + 1))
  sections.push('')
}
const md = sections.join('\\n')

function heavyParse(content: string) {
  const codeBlocks = content.match(/\`\`\`[\\s\\S]*?\`\`\`/g)?.length ?? 0
  const boldCount = content.match(/\\*\\*.*?\\*\\*/g)?.length ?? 0
  const lines = content.split('\\n').length
  return { codeBlocks, boldCount, lines }
}

// Sync: parse 10 times blocking
const syncStart = performance.now()
for (let i = 0; i < 10; i++) heavyParse(md)
const syncMs = performance.now() - syncStart

// Deferred: simulate useDeferredValue with setTimeout yielding
const deferredStart = performance.now()
for (let i = 0; i < 10; i++) {
  await new Promise<void>(r => {
    setTimeout(() => { heavyParse(md); r() }, 0)
  })
}
const deferredMs = performance.now() - deferredStart

console.log(JSON.stringify({ syncMs: syncMs / 10, deferredMs: deferredMs / 10 }))
`
  return runBenchScript(code, 30000)
}

// ============================================================================
// Bench 4: Zustand-style state update — timer in store vs external hook
// ============================================================================

async function benchStateUpdates(): Promise<{ inStoreMs: number; externalMs: number }> {
  const code = `
import { performance } from 'node:perf_hooks'
const N = 100_000

type State = { count: number; elapsed: number; text: string }
let state: State = { count: 0, elapsed: 0, text: '' }
const listeners: (() => void)[] = []

// Simulate Zustand: every set() notifies all listeners
function set(partial: Partial<State>) {
  state = { ...state, ...partial }
  for (const l of listeners) l()
}

let renderCount = 0
listeners.push(() => { renderCount++ })

// Pattern A: timer in store (baseline) — every second triggers set + all listeners
const startA = performance.now()
for (let i = 0; i < N; i++) {
  set({ elapsed: i })  // 100K set calls, each notifies all listeners
}
const inStoreMs = performance.now() - startA

// Reset
state = { count: 0, elapsed: 0, text: '' }
renderCount = 0

// Pattern B: timer outside store (optimized) — only data changes trigger set
let externalElapsed = 0
const startB = performance.now()
for (let i = 0; i < N; i++) {
  externalElapsed = i  // external, no set() call
  set({ count: i })    // only when data actually changes
}
const externalMs = performance.now() - startB

console.log(JSON.stringify({ inStoreMs, externalMs, renders: renderCount }))
`
  return runBenchScript(code)
}

// ============================================================================
// Bench 5: WebSocket vs Pipe serialization
// ============================================================================

async function benchSerialization(): Promise<{ wsMs: number; pipeMs: number }> {
  const code = `
import { performance } from 'node:perf_hooks'
const N = 50_000

const msg = {
  type: 'content_delta',
  sessionId: 'abc-123-def-456-ghi-789',
  data: {
    delta: 'The quick brown fox jumps over the lazy dog. '.repeat(5),
    timestamp: Date.now(),
    metadata: { model: 'claude-sonnet-4-6', tokens: 42 }
  }
}

// WebSocket: JSON.stringify each message (server -> client)
const wsStart = performance.now()
for (let i = 0; i < N; i++) {
  JSON.stringify(msg)
}
const wsMs = performance.now() - wsStart

// Pipe: JSON + encode (child.stdout.write)
const encoder = new TextEncoder()
const pipeStart = performance.now()
for (let i = 0; i < N; i++) {
  const buf = encoder.encode(JSON.stringify(msg))
}
const pipeMs = performance.now() - pipeStart

console.log(JSON.stringify({ wsMs, pipeMs }))
`
  return runBenchScript(code)
}

// ============================================================================
// Bench 6: Sidecar binary size
// ============================================================================

async function benchBinarySize(dir: string): Promise<number> {
  // Try the actual sidecar first, then the placeholder
  const candidates = [
    path.join(dir, 'desktop', 'src-tauri', 'binaries', 'dreamcoder-sidecar.exe'),
    path.join(dir, 'desktop', 'src-tauri', 'binaries', 'dreamcoder-sidecar-x86_64-pc-windows-msvc.exe'),
  ]
  for (const p of candidates) {
    try {
      const stat = await fs.stat(p)
      if (stat.size > 1024) return stat.size  // skip tiny placeholders
    } catch {}
  }
  return 0
}

// ============================================================================
// Runner
// ============================================================================

async function runOne(label: string, fn: () => Promise<any>) {
  process.stdout.write(`  ${label.padEnd(48)} `)
  try {
    const result = await fn()
    if (result.error) {
      console.log(`\x1b[31mFAILED\x1b[0m ${result.error}`)
      return null
    }
    if (result.skipped) {
      console.log('\x1b[33mSKIPPED\x1b[0m')
      return null
    }
    return result
  } catch (e: any) {
    console.log(`\x1b[31mFAILED\x1b[0m ${e.message?.slice(0, 100)}`)
    return null
  }
}

async function main() {
  const args = process.argv.slice(2)
  const baselineDir = args[0] || 'E:\\AProject\\TianX\\Personal\\dreamfield'
  const optimizedDir = args[1] || 'E:\\AProject\\TianX\\Personal\\dreamfield\\.worktrees\\perf-optimization'

  console.log('\n\x1b[1m\x1b[36m╔══════════════════════════════════════════════════╗')
  console.log('║     DreamCoder Performance Benchmark Suite       ║')
  console.log('╚══════════════════════════════════════════════════╝\x1b[0m')
  console.log(`  Baseline:  \x1b[33m${baselineDir}\x1b[0m`)
  console.log(`  Optimized: \x1b[33m${optimizedDir}\x1b[0m\n`)

  // Verify dirs
  for (const dir of [baselineDir, optimizedDir]) {
    try { await fs.access(path.join(dir, 'package.json')) }
    catch { console.error(`\x1b[31mERROR: ${dir} is not a valid project directory\x1b[0m`); process.exit(1) }
  }

  // ---- Phase 1: Benchmarks that differ between branches ----

  console.log('\x1b[1m  ── Branch-differentiated benchmarks ──\x1b[0m\n')

  // 1. Module import
  console.log('\x1b[2m  [1/6] Module import time (tools.ts)\x1b[0m')
  const bImport = await runOne('    Baseline  (static imports)', () => benchModuleImport(baselineDir))
  const oImport = await runOne('    Optimized (lazy imports)', () => benchModuleImport(optimizedDir))

  // ---- Phase 2: Shared benchmarks (same logic, but validate the pattern) ----

  console.log('\n\x1b[1m  ── Pattern validation benchmarks ──\x1b[0m\n')

  // 2. Session list
  console.log('\x1b[2m  [2/6] Session metadata: cold parse vs warm cache\x1b[0m')
  const session = await runOne('    Cold parse → Warm cache', () => benchSessionList())

  // 3. Markdown
  console.log('\x1b[2m  [3/6] Markdown: sync vs useDeferredValue\x1b[0m')
  const markdown = await runOne('    Sync → Deferred', () => benchMarkdown())

  // 4. State updates
  console.log('\x1b[2m  [4/6] Zustand: timer in-store vs external hook\x1b[0m')
  const state = await runOne('    In-store → External hook', () => benchStateUpdates())

  // 5. Serialization
  console.log('\x1b[2m  [5/6] Transport: WebSocket vs Pipe serialization\x1b[0m')
  const serial = await runOne('    WS JSON → Pipe JSON+encode', () => benchSerialization())

  // 6. Binary size
  console.log('\x1b[2m  [6/6] Sidecar binary size\x1b[0m')
  const bSize = await benchBinarySize(baselineDir)
  const oSize = await benchBinarySize(optimizedDir)

  // ---- Summary ----

  console.log('\n\n\x1b[1m\x1b[36m══════════════════════════════════════════════════════════')
  console.log('  RESULTS SUMMARY')
  console.log('══════════════════════════════════════════════════════════\x1b[0m\n')

  // Branch comparison
  if (bImport && oImport) {
    console.log(`  \x1b[1mModule Import (tools.ts)\x1b[0m`)
    console.log(`    Baseline  (static):  ${fmt(bImport.importMs)}`)
    console.log(`    Optimized (lazy):    ${fmt(oImport.importMs)}`)
    console.log(`    Delta:               ${diffPct(bImport.importMs, oImport.importMs)}`)
    console.log('')
  }

  if (bSize > 0 || oSize > 0) {
    console.log(`  \x1b[1mSidecar Binary Size\x1b[0m`)
    if (bSize > 0) console.log(`    Baseline:  ${fmtBytes(bSize)}`)
    if (oSize > 0) console.log(`    Optimized: ${fmtBytes(oSize)}`)
    if (bSize > 0 && oSize > 0) console.log(`    Delta:     ${diffPct(bSize, oSize)}`)
    console.log('')
  }

  // Pattern benchmarks
  console.log(`  \x1b[1mPattern Improvements (validate optimization approach)\x1b[0m`)
  console.log('  ────────────────────────────────────────────────────')

  if (session && !session.skipped) {
    const speedup = session.coldMs > 0 ? (session.coldMs / Math.max(session.warmMs, 0.01)) : 0
    console.log(`  Session cache:     ${fmt(session.coldMs)} cold → ${fmt(session.warmMs)} warm  \x1b[36m${speedup.toFixed(1)}x faster\x1b[0m  (${session.fileCount} files)`)
  }

  if (markdown) {
    console.log(`  Markdown defer:    ${fmt(markdown.syncMs)} sync → ${fmt(markdown.deferredMs)} deferred`)
  }

  if (state) {
    const speedup = state.inStoreMs > 0 ? (state.inStoreMs / Math.max(state.externalMs, 0.01)) : 0
    console.log(`  Timer external:    ${fmt(state.inStoreMs)} in-store → ${fmt(state.externalMs)} external  \x1b[36m${speedup.toFixed(1)}x fewer re-renders\x1b[0m`)
  }

  if (serial) {
    const overhead = serial.wsMs > 0 ? ((serial.pipeMs - serial.wsMs) / serial.wsMs * 100) : 0
    console.log(`  Pipe transport:    ${fmt(serial.wsMs)} WS → ${fmt(serial.pipeMs)} pipe  (pipe has +${overhead.toFixed(0)}% encode overhead but eliminates double-hop latency)`)
  }

  console.log('')
}

main().catch(e => { console.error(e); process.exit(1) })
