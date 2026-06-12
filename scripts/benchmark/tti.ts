#!/usr/bin/env bun
/**
 * TTI Benchmark — measures real first-load metrics for the built dist/
 *
 * Uses puppeteer-core driving the system Chrome (no chromium download).
 * Boots an embedded static server pointing at desktop/dist, then for each
 * navigation captures:
 *   - DOMContentLoaded (DCL)
 *   - load event
 *   - First Contentful Paint
 *   - Total JS transferred (initial — before user interaction)
 *   - Number of JS requests (initial)
 *   - Size of the main entry chunk transferred
 *
 * Two "scenarios":
 *   1. cold:  brand-new browser context, no cache
 *   2. warm:  same browser, second load (disk cache)
 *
 * Note: This benchmarks **only the current dist/** (HEAD). To compare to
 * baseline, run with BENCH_LABEL=baseline after checking out the baseline
 * ref and rebuilding (`bun run build` in desktop/).
 *
 * Run:
 *   cd desktop && bun run build              # produce dist/
 *   bun run scripts/benchmark/tti.ts
 */

import * as http from 'node:http'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import puppeteer from 'puppeteer-core'
import { gitInfo, writeResult, type BenchResult, fmtMs, fmtBytes } from './_common.ts'

const REPO = 'E:/AProject/TianX/Personal/dreamfield'
const DIST = path.posix.join(REPO, 'desktop/dist')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 5917

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.ico':  'image/x-icon',
}

async function startServer(): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = (req.url ?? '/').split('?')[0]!
      const filePath = path.posix.join(DIST, url === '/' ? '/index.html' : url)
      const data = await fs.readFile(filePath)
      const ext = path.posix.extname(filePath)
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Length': data.length })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise<void>(resolve => server.listen(PORT, resolve))
  console.log(`[tti] static server on http://localhost:${PORT}`)
  return server
}

interface NavMetrics {
  dclMs: number
  loadMs: number
  fcpMs: number
  jsBytes: number
  jsRequests: number
  mainEntryBytes: number
  mainEntryName: string
}

async function measureNav(browser: import('puppeteer-core').Browser, scenario: 'cold' | 'warm'): Promise<NavMetrics> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()

  let jsBytes = 0
  let jsRequests = 0
  let mainEntryBytes = 0
  let mainEntryName = ''

  page.on('response', async (resp) => {
    const url = resp.url()
    if (!url.endsWith('.js')) return
    try {
      const buf = await resp.buffer()
      jsBytes += buf.length
      jsRequests++
      const name = path.posix.basename(new URL(url).pathname)
      if (/^index-/.test(name) && buf.length > mainEntryBytes) {
        mainEntryBytes = buf.length
        mainEntryName = name
      }
    } catch { /* response stream may be gone */ }
  })

  if (scenario === 'cold') {
    await page.setCacheEnabled(false)
  }

  const t0 = Date.now()
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30_000 })
  void t0

  // Pull web-vitals via Performance API
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0]
    return {
      dclMs: nav ? nav.domContentLoadedEventEnd - nav.startTime : -1,
      loadMs: nav ? nav.loadEventEnd - nav.startTime : -1,
      fcpMs: fcpEntry ? fcpEntry.startTime : -1,
    }
  })

  // Give the page a beat to finish any in-flight chunk requests
  await new Promise(r => setTimeout(r, 800))

  await ctx.close()

  return {
    dclMs: timing.dclMs,
    loadMs: timing.loadMs,
    fcpMs: timing.fcpMs,
    jsBytes,
    jsRequests,
    mainEntryBytes,
    mainEntryName,
  }
}

async function main() {
  console.log('[tti] launching Chrome via puppeteer-core...')
  const server = await startServer()

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    console.log('[tti] cold load (cache disabled)...')
    const cold = await measureNav(browser, 'cold')
    console.log(`  DCL: ${fmtMs(cold.dclMs)}   load: ${fmtMs(cold.loadMs)}   FCP: ${fmtMs(cold.fcpMs)}`)
    console.log(`  JS:  ${cold.jsRequests} requests, ${fmtBytes(cold.jsBytes)} transferred`)
    console.log(`  main entry: ${fmtBytes(cold.mainEntryBytes)} (${cold.mainEntryName || 'n/a'})`)

    console.log('\n[tti] warm load (cache enabled)...')
    const warm = await measureNav(browser, 'warm')
    console.log(`  DCL: ${fmtMs(warm.dclMs)}   load: ${fmtMs(warm.loadMs)}   FCP: ${fmtMs(warm.fcpMs)}`)
    console.log(`  JS:  ${warm.jsRequests} requests, ${fmtBytes(warm.jsBytes)} transferred`)

    const label = (process.env.BENCH_LABEL ?? 'after') as 'baseline' | 'after'
    const git = await gitInfo()
    const result: BenchResult = {
      name: 'tti',
      timestamp: new Date().toISOString(),
      git,
      metrics: {
        cold_dcl_ms: Math.round(cold.dclMs),
        cold_load_ms: Math.round(cold.loadMs),
        cold_fcp_ms: Math.round(cold.fcpMs),
        cold_js_bytes: cold.jsBytes,
        cold_js_kb: Math.round(cold.jsBytes / 1024),
        cold_js_requests: cold.jsRequests,
        cold_main_entry_kb: Math.round(cold.mainEntryBytes / 1024),
        warm_dcl_ms: Math.round(warm.dclMs),
        warm_load_ms: Math.round(warm.loadMs),
        warm_fcp_ms: Math.round(warm.fcpMs),
        warm_js_kb: Math.round(warm.jsBytes / 1024),
      },
      notes: `served from desktop/dist via local static server; main entry = ${cold.mainEntryName}`,
    }
    const file = await writeResult(label, result)
    console.log(`\n[tti] wrote ${file}`)
  } finally {
    await browser.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

void main().catch(e => { console.error(e); process.exit(1) })
