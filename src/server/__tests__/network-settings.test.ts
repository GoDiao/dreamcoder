import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  MAX_AI_REQUEST_TIMEOUT_MS,
  MIN_AI_REQUEST_TIMEOUT_MS,
  getManualNetworkProxyUrl,
  buildNetworkEnvironment,
  loadNetworkSettings,
  normalizeNetworkSettings,
} from '../services/networkSettings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'network-settings-test-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  resetSettingsCache()
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.DREAMCODER_CONFIG_DIR
  }
  resetSettingsCache()
  await fs.rm(tmpDir, { recursive: true, force: true })
}

describe('network settings', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('normalizes missing settings to the 120s system-proxy default', () => {
    expect(normalizeNetworkSettings({})).toEqual({
      aiRequestTimeoutMs: DEFAULT_AI_REQUEST_TIMEOUT_MS,
      proxy: {
        mode: 'system',
        url: '',
      },
    })
  })

  it('clamps AI request timeouts and trims manual proxy URLs', () => {
    expect(normalizeNetworkSettings({
      network: {
        aiRequestTimeoutMs: 999_999,
        proxy: {
          mode: 'manual',
          url: '  http://127.0.0.1:7890  ',
        },
      },
    })).toEqual({
      aiRequestTimeoutMs: MAX_AI_REQUEST_TIMEOUT_MS,
      proxy: {
        mode: 'manual',
        url: 'http://127.0.0.1:7890',
      },
    })

    expect(normalizeNetworkSettings({
      network: {
        aiRequestTimeoutMs: 100,
      },
    }).aiRequestTimeoutMs).toBe(MIN_AI_REQUEST_TIMEOUT_MS)
  })

  it('loads persisted user network settings for provider requests', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 180_000,
          proxy: {
            mode: 'manual',
            url: ' http://127.0.0.1:7890 ',
          },
        },
      }),
      'utf-8',
    )

    const settings = await loadNetworkSettings()

    expect(settings.aiRequestTimeoutMs).toBe(180_000)
    expect(getManualNetworkProxyUrl(settings)).toBe('http://127.0.0.1:7890')
    expect(buildNetworkEnvironment(settings, { NO_PROXY: 'corp.internal' })).toEqual({
      API_TIMEOUT_MS: '180000',
      CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
      CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
      CLAUDE_STREAM_IDLE_TIMEOUT_MS: '180000',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      http_proxy: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      NO_PROXY: 'corp.internal,127.0.0.1,localhost,::1',
      no_proxy: 'corp.internal,127.0.0.1,localhost,::1',
    })
  })

  it('keeps an inherited NO_PROXY wildcard as it is', () => {
    const settings = normalizeNetworkSettings({
      network: { proxy: { mode: 'manual', url: 'http://proxy.corp:8080' } },
    })

    expect(buildNetworkEnvironment(settings, { NO_PROXY: '*' })).toMatchObject({ NO_PROXY: '*', no_proxy: '*' })
  })

  it('lets a CLI with a manual proxy reach the local server directly', async () => {
    let proxyHits = 0
    const externalProxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        proxyHits += 1
        return new Response('through the external proxy', { status: 502 })
      },
    })
    const localServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('direct') })
    const settings = normalizeNetworkSettings({
      network: { proxy: { mode: 'manual', url: `http://127.0.0.1:${externalProxy.port}` } },
    })
    const { HTTP_PROXY: _a, HTTPS_PROXY: _b, http_proxy: _c, https_proxy: _d, NO_PROXY: _e, no_proxy: _f, ...baseEnv } = process.env

    try {
      const child = Bun.spawn([
        process.execPath,
        '-e',
        `const res = await fetch('http://127.0.0.1:${localServer.port}/', { proxy: process.env.HTTPS_PROXY }); console.log(await res.text())`,
      ], { env: { ...baseEnv, ...buildNetworkEnvironment(settings, baseEnv) }, stdout: 'pipe' })
      const output = (await new Response(child.stdout).text()).trim()
      await child.exited

      expect(output).toBe('direct')
      expect(proxyHits).toBe(0)
    } finally {
      externalProxy.stop(true)
      localServer.stop(true)
    }
  })
})
