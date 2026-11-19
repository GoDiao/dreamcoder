import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  auxiliaryThinking,
  type CliModelRules,
  getCliModelRules,
  getCliModelRulesEnv,
  MODEL_RULES_ENV_KEY,
  normalizeModelId,
  resolveEffortForLevels,
} from '../model/modelRules.js'
import { isFirstPartyAnthropicHost } from '../model/providers.js'
import { normalizeEffortLevel } from '../effort.js'

const base: CliModelRules = {
  contextWindow: 131_072,
  thinkingWhenOn: 'omit',
  thinkingWhenOff: 'omit',
  effortLevels: [],
  pdf: false,
  image: true,
  nativeWebSearch: false,
  structuredOutput: false,
}

describe('normalizeModelId', () => {
  test('strips context suffixes, lowercases and turns dots into dashes', () => {
    expect(normalizeModelId('Claude-Opus-4.7[1m]')).toBe('claude-opus-4-7')
    expect(normalizeModelId('deepseek-v4-pro:1m')).toBe('deepseek-v4-pro')
    expect(normalizeModelId(' anthropic/claude-opus-4.7 ')).toBe('anthropic/claude-opus-4-7')
    expect(normalizeModelId('model[2m]')).toBe('model')
  })
})

describe('resolveEffortForLevels', () => {
  test('keeps a supported level', () => {
    expect(resolveEffortForLevels('low', ['low', 'high', 'max'])).toBe('low')
  })

  test('rounds up to the lowest higher level', () => {
    expect(resolveEffortForLevels('medium', ['low', 'high', 'max'])).toBe('high')
  })

  test('falls back to the highest level when nothing is higher', () => {
    expect(resolveEffortForLevels('max', ['low', 'medium', 'high'])).toBe('high')
  })

  test('returns undefined without levels', () => {
    expect(resolveEffortForLevels('high', [])).toBeUndefined()
  })
})

describe('auxiliaryThinking', () => {
  test('explicit thinking turns it on with the weakest level', () => {
    expect(auxiliaryThinking({ ...base, thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: ['high', 'low'] }, true))
      .toEqual({ thinking: 'on', effort: 'low' })
  })

  test('explicit thinking on a model without levels turns it on without a level', () => {
    expect(auxiliaryThinking({ ...base, thinkingWhenOn: 'budget', thinkingWhenOff: 'disabled' }, true))
      .toEqual({ thinking: 'on' })
  })

  test('a model that can switch thinking off gets disabled', () => {
    expect(auxiliaryThinking({ ...base, thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: ['low', 'high'] }, false))
      .toEqual({ thinking: 'off' })
  })

  test('a none model on a disable-only endpoint gets disabled', () => {
    expect(auxiliaryThinking({ ...base, thinkingWhenOff: 'disabled' }, false)).toEqual({ thinking: 'off' })
  })

  test('a model that always thinks gets the weakest level', () => {
    expect(auxiliaryThinking({ ...base, thinkingWhenOn: 'adaptive', effortLevels: ['medium', 'low', 'high'] }, false))
      .toEqual({ thinking: 'omit', effort: 'low' })
  })

  test('a none model gets nothing', () => {
    expect(auxiliaryThinking(base, false)).toEqual({ thinking: 'omit' })
  })
})

describe('DREAMCODER_MODEL_RULES', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env[MODEL_RULES_ENV_KEY]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[MODEL_RULES_ENV_KEY]
    else process.env[MODEL_RULES_ENV_KEY] = original
  })

  test('is absent when the variable is not set', () => {
    delete process.env[MODEL_RULES_ENV_KEY]
    expect(getCliModelRulesEnv()).toBeUndefined()
    expect(getCliModelRules('deepseek-v4-pro')).toBeUndefined()
  })

  test('looks up models by normalized id and falls back for unknown ids', () => {
    const deepseek: CliModelRules = { ...base, contextWindow: 1_048_576, thinkingWhenOn: 'adaptive', thinkingWhenOff: 'disabled', effortLevels: ['low', 'high', 'max'] }
    process.env[MODEL_RULES_ENV_KEY] = JSON.stringify({
      models: { 'deepseek-v4-pro': deepseek },
      fallback: { ...base, contextWindow: 200_000 },
      defaultEffort: 'medium',
    })
    expect(getCliModelRules('DeepSeek-V4-Pro[1m]')).toEqual(deepseek)
    expect(getCliModelRules('other-model')?.contextWindow).toBe(200_000)
    expect(getCliModelRulesEnv()?.defaultEffort).toBe('medium')
  })

  test('uses the fallback for every model when the models are malformed', () => {
    process.env[MODEL_RULES_ENV_KEY] = JSON.stringify({
      models: { 'deepseek-v4-pro': { contextWindow: 'big' } },
      fallback: { ...base, contextWindow: 200_000 },
      defaultEffort: 'medium',
    })
    expect(getCliModelRules('deepseek-v4-pro')?.contextWindow).toBe(200_000)
  })

  test('uses the fixed fallback when the variable is not JSON', () => {
    process.env[MODEL_RULES_ENV_KEY] = 'not json'
    expect(getCliModelRules('deepseek-v4-pro')).toEqual(base)
    expect(getCliModelRulesEnv()?.defaultEffort).toBe('medium')
  })
})

describe('isFirstPartyAnthropicHost', () => {
  test('matches the official API host only', () => {
    expect(isFirstPartyAnthropicHost('https://api.anthropic.com')).toBe(true)
    expect(isFirstPartyAnthropicHost('https://api.anthropic.com/v1/')).toBe(true)
    expect(isFirstPartyAnthropicHost('https://api.deepseek.com/anthropic')).toBe(false)
    expect(isFirstPartyAnthropicHost('not a url')).toBe(false)
  })
})

describe('normalizeEffortLevel', () => {
  test('keeps a known level and defaults to medium', () => {
    expect(normalizeEffortLevel('max')).toBe('max')
    expect(normalizeEffortLevel('extreme')).toBe('medium')
    expect(normalizeEffortLevel(undefined)).toBe('medium')
  })
})
