import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getAutoCompactThreshold, getEffectiveContextWindowSize } from './autoCompact.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { MODEL_CONTEXT_WINDOWS_ENV_KEY } from '../../utils/model/modelContextWindows.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let originalAutoCompactWindow: string | undefined
let originalContextWindows: string | undefined

beforeEach(() => {
  originalAutoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  originalContextWindows = process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
  delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  delete process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
})

afterEach(() => {
  if (originalAutoCompactWindow === undefined) {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  } else {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = originalAutoCompactWindow
  }
  if (originalContextWindows === undefined) {
    delete process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
  } else {
    process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY] = originalContextWindows
  }
})

describe('model context window resolution', () => {
  test('uses built-in windows for current third-party coding models', () => {
    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_000_000)
    expect(getContextWindowForModel('MiniMax-M2.7')).toBe(204_800)
    expect(getContextWindowForModel('kimi-k2.6')).toBe(262_144)
    expect(getContextWindowForModel('glm-5.1')).toBe(200_000)
    expect(getContextWindowForModel('glm-4.5-air')).toBe(128_000)
  })

  test('uses Codex OAuth effective context windows for OpenAI GPT models', () => {
    expect(getContextWindowForModel('gpt-5.5')).toBe(258_400)
    expect(getContextWindowForModel('gpt-5.4')).toBe(950_000)
    expect(getContextWindowForModel('gpt-5.4-mini')).toBe(258_400)
    expect(getContextWindowForModel('gpt-5.3-codex-spark')).toBe(121_600)
  })

  test('uses per-model provider overrides before built-in defaults', () => {
    process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY] = JSON.stringify({
      'deepseek-v4-pro': 500_000,
      'custom-model': 300_000,
    })

    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(500_000)
    expect(getContextWindowForModel('provider/custom-model')).toBe(300_000)
  })

  test('global auto compact window can raise unknown models above the default', () => {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '1000000'

    expect(getEffectiveContextWindowSize('unknown-future-model')).toBe(980_000)
  })
})

describe('auto-compact threshold', () => {
  let configDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'auto-compact-'))
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    process.env.DREAMCODER_CONFIG_DIR = configDir
    resetSettingsCache()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
    else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
    resetSettingsCache()
    await rm(configDir, { recursive: true, force: true })
  })

  test('compacts at 90% of the window left after the summary reserve by default', () => {
    expect(getAutoCompactThreshold('glm-5.1')).toBe(162_000)
    expect(getAutoCompactThreshold('deepseek-v4-pro')).toBe(882_000)
  })

  test('uses the percentage from user settings', async () => {
    await writeFile(join(configDir, 'settings.json'), JSON.stringify({ autoCompactPercent: 50 }))
    resetSettingsCache()
    expect(getAutoCompactThreshold('glm-5.1')).toBe(90_000)
    expect(getAutoCompactThreshold('deepseek-v4-pro')).toBe(490_000)
  })
})
