#!/usr/bin/env bun
/**
 * Bundle Benchmark — measures Vite build chunk sizes & vendor isolation
 *
 * Outputs:
 *   - Total dist/assets/*.js size (sum + gzip-equivalent estimate)
 *   - Largest single chunk size
 *   - Main entry chunk size (the index.*.js)
 *   - Whether heavy deps (mermaid, katex, shiki, xterm) were split into separate chunks
 *
 * Run directly: bun run scripts/benchmark/bundle.ts
 * Via compare:  bun run scripts/benchmark/compare.ts bundle
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import { promisify } from 'node:util'
import { gitInfo, run, writeResult, type BenchResult } from './_common.ts'

const gzip = promisify(zlib.gzip)

const REPO = 'E:/AProject/TianX/Personal/dreamfield'
const DESKTOP = path.posix.join(REPO, 'desktop')
const DIST_ASSETS = path.posix.join(DESKTOP, 'dist/assets')

const HEAVY_DEPS = ['mermaid', 'katex', 'shiki', 'xterm']

async function listJsFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const e of entries) {
    const full = path.posix.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listJsFiles(full)))
    else if (e.name.endsWith('.js')) out.push(full)
  }
  return out
}

async function gzipSize(file: string): Promise<number> {
  const buf = await fs.readFile(file)
  const compressed = await gzip(buf)
  return compressed.length
}

/**
 * Heuristic: detect if a chunk *contains* a heavy dependency's signature code
 * by searching for distinctive strings. Returns the set of detected deps.
 */
async function detectDepsInChunk(file: string): Promise<Set<string>> {
  const content = await fs.readFile(file, 'utf-8')
  const found = new Set<string>()
  // Use strings unique enough to indicate the lib is in this chunk
  if (/mermaid|sequenceDiagram|flowchart/i.test(content)) found.add('mermaid')
  if (/katex|\\KaTeX|renderToString/i.test(content)) found.add('katex')
  if (/shiki|getHighlighter|shikijs/i.test(content)) found.add('shiki')
  if (/xterm|XtermJS|"@xterm/i.test(content)) found.add('xterm')
  return found
}

async function main() {
  console.log('[bundle] building desktop...')
  const buildStart = Date.now()
  await run('bun', ['run', 'build'], { cwd: DESKTOP, timeout: 300_000 })
  const buildMs = Date.now() - buildStart

  const files = await listJsFiles(DIST_ASSETS)
  if (files.length === 0) {
    console.error('[bundle] no JS files found in dist/assets')
    process.exit(1)
  }

  let totalBytes = 0
  let totalGzip = 0
  let largestBytes = 0
  let largestFile = ''
  let mainBytes = 0
  let mainFile = ''
  const depsToChunks: Record<string, string[]> = {}
  for (const dep of HEAVY_DEPS) depsToChunks[dep] = []

  for (const f of files) {
    const stat = await fs.stat(f)
    const gz = await gzipSize(f)
    totalBytes += stat.size
    totalGzip += gz
    if (stat.size > largestBytes) {
      largestBytes = stat.size
      largestFile = path.posix.basename(f)
    }
    // Vite names the entry chunk "index-<hash>.js"
    if (/^index-/.test(path.posix.basename(f)) && stat.size > mainBytes) {
      mainBytes = stat.size
      mainFile = path.posix.basename(f)
    }
    const deps = await detectDepsInChunk(f)
    for (const d of deps) depsToChunks[d]!.push(path.posix.basename(f))
  }

  // For each heavy dep: is it in its OWN chunk (good) or merged into main (bad)?
  const depIsolation: Record<string, string> = {}
  for (const dep of HEAVY_DEPS) {
    const chunks = depsToChunks[dep]!
    if (chunks.length === 0) depIsolation[dep] = 'not-found'
    else if (chunks.length === 1 && /^index-/.test(chunks[0]!)) depIsolation[dep] = 'in-main'
    else if (chunks.length === 1) depIsolation[dep] = `isolated:${chunks[0]}`
    else depIsolation[dep] = `multi:${chunks.length}`
  }

  console.log('\n[bundle] Results:')
  console.log(`  Total chunks:    ${files.length}`)
  console.log(`  Total size:      ${(totalBytes / 1024).toFixed(0)} KB`)
  console.log(`  Total gzip:      ${(totalGzip / 1024).toFixed(0)} KB`)
  console.log(`  Largest chunk:   ${(largestBytes / 1024).toFixed(0)} KB (${largestFile})`)
  console.log(`  Main entry:      ${(mainBytes / 1024).toFixed(0)} KB (${mainFile})`)
  console.log(`  Build time:      ${buildMs}ms`)
  console.log('  Heavy dep isolation:')
  for (const [dep, status] of Object.entries(depIsolation)) {
    console.log(`    ${dep.padEnd(8)} ${status}`)
  }

  const label = (process.env.BENCH_LABEL ?? 'after') as 'baseline' | 'after'
  const git = await gitInfo()
  const result: BenchResult = {
    name: 'bundle',
    timestamp: new Date().toISOString(),
    git,
    metrics: {
      'chunks': files.length,
      'total_kb': Math.round(totalBytes / 1024),
      'total_gzip_kb': Math.round(totalGzip / 1024),
      'largest_kb': Math.round(largestBytes / 1024),
      'main_entry_kb': Math.round(mainBytes / 1024),
      'build_ms': buildMs,
      ...Object.fromEntries(Object.entries(depIsolation).map(([k, v]) => [`dep_${k}`, v])),
    },
    notes: `largest=${largestFile}, main=${mainFile}`,
  }
  const file = await writeResult(label, result)
  console.log(`\n[bundle] wrote ${file}`)
}

void main().catch(e => { console.error(e); process.exit(1) })
