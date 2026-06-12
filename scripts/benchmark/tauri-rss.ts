#!/usr/bin/env bun
/**
 * Tauri RSS + Startup Benchmark — measures real desktop process metrics
 *
 * What this automates:
 *   1. Sidecar cold startup time (time to first TCP response)
 *   2. Desktop exe size on disk
 *   3. If the Tauri app is running, captures RSS via tasklist
 *
 * What requires manual steps (script will print instructions):
 *   - Launching the Tauri app (needs WebView2 runtime + sidecar)
 *   - Opening multiple terminals (needs UI interaction)
 *
 * Run directly: bun run scripts/benchmark/tauri-rss.ts
 * Via compare:  bun run scripts/benchmark/compare.ts tauri-rss
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as net from 'node:net'
import { gitInfo, fmtBytes, fmtMs, writeResult, type BenchResult } from './_common.ts'

const REPO = 'E:/AProject/TianX/Personal/dreamfield'
const DESKTOP = path.posix.join(REPO, 'desktop')
const SIDECAR = path.posix.join(DESKTOP, 'src-tauri/binaries/dreamcoder-sidecar.exe')
const DESKTOP_EXE = path.posix.join(DESKTOP, 'src-tauri/target/release/dreamcoder-desktop.exe')

// ─── Sidecar startup time ──────────────────────────────────────────

async function measureSidecarStartup(): Promise<{ coldMs: number; port: number }> {
  // Find a free port
  const server = net.createServer()
  await new Promise<void>((resolve) => { server.listen(0, () => resolve()) })
  const port = (server.address() as net.AddressInfo).port
  server.close()

  const { spawn } = await import('node:child_process')
  const start = performance.now()
  const child = spawn(SIDECAR, ['--port', String(port)], {
    cwd: DESKTOP,
    stdio: 'pipe',
    env: { ...process.env, DREAMCODER_SERVER_PORT: String(port) },
  })

  // Wait until TCP port is listening (sidecar ready)
  let connected = false
  let attempts = 0
  const maxAttempts = 200 // 10s at 50ms intervals

  while (!connected && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 50))
    attempts++
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.createConnection(port, '127.0.0.1', () => {
          connected = true
          resolve()
        })
        sock.on('error', reject)
        sock.setTimeout(100, () => { sock.destroy(); reject(new Error('timeout')) })
      })
    } catch { /* not ready yet */ }
  }

  const coldMs = performance.now() - start

  // Kill sidecar
  try { child.kill() } catch { /* already dead */ }
  // Give it a moment to release the port
  await new Promise(r => setTimeout(r, 200))

  return { coldMs: connected ? coldMs : -1, port }
}

// ─── Desktop exe size ──────────────────────────────────────────────

async function measureExeSize(): Promise<{ sidecarBytes: number; desktopBytes: number }> {
  let sidecarBytes = 0
  let desktopBytes = 0
  try { sidecarBytes = (await fs.stat(SIDECAR)).size } catch { /* not found */ }
  try { desktopBytes = (await fs.stat(DESKTOP_EXE)).size } catch { /* not found */ }
  return { sidecarBytes, desktopBytes }
}

// ─── Running Tauri app RSS ─────────────────────────────────────────

async function captureRunningRSS(): Promise<{ pid: number; rssKb: number; processName: string }[]> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileP = promisify(execFile)

  try {
    const { stdout } = await execFileP('tasklist', ['/FI', 'IMAGENAME eq dreamcoder-desktop.exe', '/FO', 'CSV', '/NH'])
    const lines = stdout.trim().split('\n').filter(l => l.includes('dreamcoder'))
    return lines.map(line => {
      const parts = line.replace(/"/g, '').split(',')
      return {
        pid: Number(parts[1]) || 0,
        rssKb: Number(parts[4]?.replace(/[^\d]/g, '')) || 0,
        processName: parts[0] || 'unknown',
      }
    })
  } catch {
    return []
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('[tauri-rss] measuring sidecar startup time...')
  const startup = await measureSidecarStartup()
  console.log(`  Sidecar cold startup: ${startup.coldMs > 0 ? fmtMs(startup.coldMs) : 'TIMEOUT (>10s)'}`)

  console.log('\n[tauri-rss] measuring exe sizes...')
  const sizes = await measureExeSize()
  console.log(`  Sidecar: ${fmtBytes(sizes.sidecarBytes)}`)
  console.log(`  Desktop: ${fmtBytes(sizes.desktopBytes)}`)

  console.log('\n[tauri-rss] checking for running Tauri process...')
  const running = await captureRunningRSS()
  if (running.length > 0) {
    for (const proc of running) {
      console.log(`  PID ${proc.pid}: ${fmtBytes(proc.rssKb * 1024)} RSS`)
    }
  } else {
    console.log('  No running Tauri desktop process found')
    console.log('\n  To measure real multi-terminal RSS:')
    console.log('  1. Run: cd desktop && npx tauri dev')
    console.log('  2. Open N terminals in the app')
    console.log('  3. Re-run this script to capture RSS')
  }

  const label = (process.env.BENCH_LABEL ?? 'after') as 'baseline' | 'after'
  const git = await gitInfo()
  const result: BenchResult = {
    name: 'tauri-rss',
    timestamp: new Date().toISOString(),
    git,
    metrics: {
      'sidecar_cold_start_ms': Math.round(startup.coldMs),
      'sidecar_size_kb': Math.round(sizes.sidecarBytes / 1024),
      'desktop_exe_kb': Math.round(sizes.desktopBytes / 1024),
      'running_rss_kb': running.length > 0 ? running[0]!.rssKb : -1,
      'running_pids': running.length,
    },
    notes: running.length > 0
      ? `live RSS=${fmtBytes(running[0]!.rssKb * 1024)}`
      : 'no running Tauri process; sidecar cold start measured standalone',
  }
  const file = await writeResult(label, result)
  console.log(`\n[tauri-rss] wrote ${file}`)
}

void main().catch(e => { console.error(e); process.exit(1) })
