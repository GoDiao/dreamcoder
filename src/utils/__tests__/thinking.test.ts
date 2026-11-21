import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { MODEL_RULES_ENV_KEY } from '../model/modelRules.js'
import { resolveSideQueryThinkingConfig } from '../sideQuery.js'
import {
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
} from '../thinking.js'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  MODEL_RULES_ENV_KEY,
] as const

describe('provider-aware thinking support', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  test('does not assume adaptive thinking for Anthropic-compatible third-party base URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.jiekou.ai/anthropic'

    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(false)
  })

  test('keeps first-party Anthropic Sonnet adaptive thinking enabled', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

    expect(modelSupportsThinking('claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true)
  })

  test('side queries without rules only send thinking fields the caller asks for', () => {
    expect(resolveSideQueryThinkingConfig('claude-sonnet-4-6', undefined, 1024)).toEqual({})
    expect(resolveSideQueryThinkingConfig('claude-sonnet-4-6', false, 1024)).toEqual({ thinking: { type: 'disabled' } })
    expect(resolveSideQueryThinkingConfig('claude-sonnet-4-6', 256, 1024)).toEqual({
      thinking: { type: 'enabled', budget_tokens: 256 },
    })
  })
})
