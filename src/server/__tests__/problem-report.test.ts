import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleDiagnosticsApi } from '../api/diagnostics.js'
import { buildProblemReport, describeProvider } from '../services/problemReport.js'
import type { SavedProvider } from '../types/provider.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamcoder-problem-report-test-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// Built at runtime so secret scanners don't flag a fake key in the source.
const SECRET = ['sk', 'or', 'v1', 'x'.repeat(20)].join('-')

function provider(overrides: Partial<SavedProvider>): SavedProvider {
  return {
    id: 'p1',
    presetId: 'custom',
    name: 'My private gateway',
    apiKey: SECRET,
    baseUrl: 'https://gateway.internal.example.com/v1',
    apiFormat: 'anthropic',
    runtimeKind: 'anthropic_compatible',
    models: [{ id: 'm' }],
    ...overrides,
  } as SavedProvider
}

describe('problem report', () => {
  test('names the provider type without its URL, key or name', () => {
    expect(describeProvider(provider({ presetId: 'deepseek' }))).toBe('DeepSeek')
    expect(describeProvider(provider({ baseUrl: 'https://openrouter.ai/api' }))).toBe('OpenRouter')
    expect(describeProvider(provider({}))).toBe('Custom (Anthropic-compatible)')
    expect(describeProvider(provider({ apiFormat: 'openai_chat' }))).toBe('Custom (OpenAI-compatible)')
    expect(describeProvider(null)).toBe('Other / N/A')
  })

  test('keeps secrets, the home path and the provider URL out of the report', async () => {
    const diagnosticsDir = path.join(tmpDir, 'dreamcoder', 'diagnostics')
    await fs.mkdir(diagnosticsDir, { recursive: true })
    // Written raw, as an older build might have, so the report has to redact it itself.
    const lines = [
      { id: '1', timestamp: '2026-10-20T00:00:00.000Z', type: 'api_error', severity: 'error', summary: `Bearer ${SECRET} rejected for ${os.homedir()}/project` },
      { id: '2', timestamp: '2026-10-20T00:01:00.000Z', type: 'info', severity: 'info', summary: 'not an error' },
    ]
    await fs.writeFile(path.join(diagnosticsDir, 'diagnostics.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')

    const report = await buildProblemReport({
      listProviders: async () => ({ providers: [provider({})], activeId: 'p1' }),
    })

    const text = JSON.stringify(report)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(os.homedir())
    expect(text).not.toContain('gateway.internal.example.com')
    expect(text).not.toContain('My private gateway')
    expect(report.recentErrors).toHaveLength(1)
    expect(report.recentErrors[0]!.summary).toContain('[REDACTED]')
    expect(report.provider).toBe('Custom (Anthropic-compatible)')
    expect(report.os.platform).toBe(process.platform)
  })

  test('lists the ten newest errors, newest first', async () => {
    const diagnosticsDir = path.join(tmpDir, 'dreamcoder', 'diagnostics')
    await fs.mkdir(diagnosticsDir, { recursive: true })
    const lines = Array.from({ length: 15 }, (_, index) => JSON.stringify({
      id: String(index), timestamp: `2026-10-20T00:00:${String(index).padStart(2, '0')}.000Z`, type: 'e', severity: 'error', summary: `err-${index}`,
    }))
    await fs.writeFile(path.join(diagnosticsDir, 'diagnostics.jsonl'), lines.join('\n') + '\n')

    const report = await buildProblemReport({ listProviders: async () => ({ providers: [], activeId: null }) })
    expect(report.recentErrors.map((error) => error.summary)).toEqual(
      Array.from({ length: 10 }, (_, index) => `err-${14 - index}`),
    )
  })

  test('reveals only files inside the export folder', async () => {
    for (const fileName of ['..', '.', '../diagnostics.jsonl', '']) {
      const url = new URL('http://localhost:3456/api/diagnostics/reveal-export')
      const req = new Request(url, { method: 'POST', body: JSON.stringify({ fileName }), headers: { 'content-type': 'application/json' } })
      const res = await handleDiagnosticsApi(req, url, ['api', 'diagnostics', 'reveal-export'])
      expect(res.status).toBe(400)
    }
  })

  test('is served at GET /api/diagnostics/report', async () => {
    const url = new URL('http://localhost:3456/api/diagnostics/report')
    const res = await handleDiagnosticsApi(new Request(url, { method: 'GET' }), url, ['api', 'diagnostics', 'report'])
    expect(res.status).toBe(200)
    const body = await res.json() as { appVersion: string; recentErrors: unknown[] }
    expect(typeof body.appVersion).toBe('string')
    expect(body.recentErrors).toEqual([])
  })
})
