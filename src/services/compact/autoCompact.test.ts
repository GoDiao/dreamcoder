import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getAutoCompactThreshold, getEffectiveContextWindowSize, shouldAutoCompact } from './autoCompact.js'
import { createAssistantMessage, createUserMessage } from '../../utils/messages.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { MODEL_RULES_ENV_KEY } from '../../utils/model/modelRules.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let originalAutoCompactWindow: string | undefined
let originalModelRules: string | undefined

beforeEach(() => {
  originalAutoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  originalModelRules = process.env[MODEL_RULES_ENV_KEY]
  delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  delete process.env[MODEL_RULES_ENV_KEY]
})

afterEach(() => {
  if (originalAutoCompactWindow === undefined) {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  } else {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = originalAutoCompactWindow
  }
  if (originalModelRules === undefined) {
    delete process.env[MODEL_RULES_ENV_KEY]
  } else {
    process.env[MODEL_RULES_ENV_KEY] = originalModelRules
  }
})

describe('model context window resolution', () => {
  test('uses built-in windows for Claude models', () => {
    expect(getContextWindowForModel('claude-opus-4-7')).toBe(1_000_000)
    expect(getContextWindowForModel('claude-haiku-4-5')).toBe(200_000)
  })

  test('uses Codex OAuth effective context windows for OpenAI GPT models', () => {
    expect(getContextWindowForModel('gpt-5.5')).toBe(258_400)
    expect(getContextWindowForModel('gpt-5.4')).toBe(950_000)
    expect(getContextWindowForModel('gpt-5.4-mini')).toBe(258_400)
    expect(getContextWindowForModel('gpt-5.3-codex-spark')).toBe(121_600)
  })

  test('uses the model rules window before built-in defaults', () => {
    const rules = {
      thinkingWhenOn: 'omit',
      thinkingWhenOff: 'omit',
      effortLevels: [],
      pdf: false,
      image: true,
      nativeWebSearch: false,
      structuredOutput: false,
    }
    process.env[MODEL_RULES_ENV_KEY] = JSON.stringify({
      models: { 'deepseek-v4-pro': { ...rules, contextWindow: 500_000 } },
      fallback: { ...rules, contextWindow: 300_000 },
      defaultEffort: 'medium',
    })

    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(500_000)
    expect(getContextWindowForModel('claude-opus-4-7')).toBe(300_000)
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
    expect(getAutoCompactThreshold('claude-sonnet-4-6')).toBe(162_000)
    expect(getAutoCompactThreshold('claude-opus-4-7')).toBe(882_000)
  })

  test('uses the percentage from user settings', async () => {
    await writeFile(join(configDir, 'settings.json'), JSON.stringify({ autoCompactPercent: 50 }))
    resetSettingsCache()
    expect(getAutoCompactThreshold('claude-sonnet-4-6')).toBe(90_000)
    expect(getAutoCompactThreshold('claude-opus-4-7')).toBe(490_000)
  })
})

describe('auto compact without usage from the provider', () => {
  const zeroUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }

  function reply(content: string, usage: typeof zeroUsage) {
    const message = createAssistantMessage({ content, usage: usage as never })
    message.message.model = 'kimi-k2.6'
    return message
  }

  test('falls back to the local estimate when the last reply reports zero usage', async () => {
    const messages = [
      createUserMessage({ content: 'x'.repeat(1_200_000) }),
      reply('done', zeroUsage),
      createUserMessage({ content: 'next' }),
    ]

    expect(await shouldAutoCompact(messages, 'kimi-k2.6')).toBe(true)
  })

  test('uses the last reply that does report usage', async () => {
    const messages = [
      createUserMessage({ content: 'hello' }),
      reply('first', { ...zeroUsage, input_tokens: 250_000 }),
      createUserMessage({ content: 'more' }),
      reply('second', zeroUsage),
      createUserMessage({ content: 'next' }),
    ]

    expect(await shouldAutoCompact(messages, 'kimi-k2.6')).toBe(true)
  })
})
