import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { resolveWebSearchProvider } from '../../tools/WebSearchTool/backend.js'
import { modelSupportsISP } from '../betas.js'
import { getContextWindowForModel, getModelMaxOutputTokens } from '../context.js'
import {
  getDefaultEffortForModel,
  getInitialEffortSetting,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolveAppliedEffort,
} from '../effort.js'
import { type CliModelRules, type CliModelRulesEnv, MODEL_RULES_ENV_KEY } from '../model/modelRules.js'
import { isPDFSupported } from '../pdfUtils.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { AppState } from '../../state/AppState.js'
import { applySettingsChange } from '../settings/applySettingsChange.js'
import * as settings from '../settings/settings.js'
import {
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
  shouldSendExplicitDisabledThinking,
} from '../thinking.js'

const ENV_KEYS = [
  MODEL_RULES_ENV_KEY,
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
] as const

const none: CliModelRules = {
  contextWindow: 131_072,
  thinkingWhenOn: 'omit',
  thinkingWhenOff: 'omit',
  effortLevels: [],
  pdf: false,
  image: true,
  nativeWebSearch: false,
  structuredOutput: false,
}

const deepseek: CliModelRules = {
  ...none,
  contextWindow: 1_000_000,
  maxOutputTokens: 393_216,
  thinkingWhenOn: 'adaptive',
  thinkingWhenOff: 'disabled',
  effortLevels: ['low', 'high', 'max'],
  nativeWebSearch: true,
}

const gpt5: CliModelRules = {
  ...none,
  contextWindow: 400_000,
  maxOutputTokens: 8_192,
  thinkingWhenOn: 'adaptive',
  thinkingWhenOff: 'omit',
  effortLevels: ['low', 'medium', 'high'],
  pdf: true,
  structuredOutput: true,
}

const budget: CliModelRules = { ...none, thinkingWhenOn: 'budget', thinkingWhenOff: 'disabled' }
const disableOnly: CliModelRules = { ...none, thinkingWhenOff: 'disabled' }
const noPdfImages: CliModelRules = { ...none, image: false }

function setRules(env: Partial<CliModelRulesEnv> = {}) {
  const value: CliModelRulesEnv = {
    models: {
      'deepseek-v4-pro': deepseek,
      'gpt-5': gpt5,
      'budget-model': budget,
      'kimi-for-coding': disableOnly,
      'text-only': noPdfImages,
    },
    fallback: none,
    defaultEffort: 'medium',
    ...env,
  }
  process.env[MODEL_RULES_ENV_KEY] = JSON.stringify(value)
}

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

describe('without DREAMCODER_MODEL_RULES the CLI keeps its Claude logic', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
  })

  test('thinking support follows the Claude model name', () => {
    expect(modelSupportsThinking('claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true)
    expect(shouldSendExplicitDisabledThinking('claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsThinking('claude-3-5-haiku')).toBe(false)
    expect(shouldSendExplicitDisabledThinking('claude-3-5-haiku')).toBe(false)
  })

  test('effort support and the max clamp follow the Claude model name', () => {
    expect(modelSupportsEffort('claude-opus-4-6')).toBe(true)
    expect(modelSupportsEffort('claude-haiku-4-5')).toBe(false)
    expect(modelSupportsMaxEffort('claude-opus-4-6')).toBe(true)
    expect(resolveAppliedEffort('claude-sonnet-4-6', 'max')).toBe('high')
    expect(resolveAppliedEffort('claude-sonnet-4-6', 'low')).toBe('low')
  })

  test('settings effortLevel still seeds the session effort', () => {
    const spy = spyOn(settings, 'getInitialSettings').mockReturnValue({ effortLevel: 'low' } as never)
    try {
      expect(getInitialEffortSetting()).toBe('low')
    } finally {
      spy.mockRestore()
    }
  })

  test('a settings effortLevel change still updates the session effort', () => {
    const prev: AppState = { ...getDefaultAppState(), effortValue: 'high' }
    const spy = spyOn(settings, 'getInitialSettings').mockReturnValue({ ...prev.settings, effortLevel: 'low' })
    let next: AppState = prev
    try {
      applySettingsChange('userSettings', update => {
        next = update(prev)
      })
    } finally {
      spy.mockRestore()
    }
    expect(next.effortValue).toBe('low')
  })

  test('windows and output limits come from the Claude tables', () => {
    expect(getContextWindowForModel('claude-opus-4-7')).toBe(1_000_000)
    expect(getContextWindowForModel('claude-sonnet-4-6')).toBe(200_000)
    expect(getContextWindowForModel('some-unknown-model')).toBe(200_000)
    expect(getModelMaxOutputTokens('claude-sonnet-4-6')).toEqual({ default: 32_000, upperLimit: 128_000 })
    expect(getModelMaxOutputTokens('some-unknown-model')).toEqual({ default: 32_000, upperLimit: 64_000 })
  })

  test('PDF, interleaved thinking and native search follow the Claude model name', () => {
    expect(isPDFSupported('claude-sonnet-4-6')).toBe(true)
    expect(isPDFSupported('claude-3-haiku-20240307')).toBe(false)
    expect(modelSupportsISP('claude-sonnet-4-6')).toBe(true)
    expect(resolveWebSearchProvider('claude-sonnet-4-6', { mode: 'auto' }).provider).toBe('anthropic')
    expect(resolveWebSearchProvider('deepseek-v4-pro', { mode: 'auto' }).provider).toBe('disabled')
  })
})

describe('with DREAMCODER_MODEL_RULES the CLI reads the rules', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'
    setRules()
  })

  test('thinking support comes from thinkingWhenOn', () => {
    expect(modelSupportsThinking('deepseek-v4-pro')).toBe(true)
    expect(modelSupportsAdaptiveThinking('deepseek-v4-pro')).toBe(true)
    expect(modelSupportsThinking('budget-model')).toBe(true)
    expect(modelSupportsAdaptiveThinking('budget-model')).toBe(false)
    expect(modelSupportsThinking('kimi-for-coding')).toBe(false)
    expect(modelSupportsThinking('claude-sonnet-4-6')).toBe(false)
    expect(modelSupportsThinking('MiniMax-M2.7')).toBe(false)
  })

  test('explicit disabled thinking comes from thinkingWhenOff', () => {
    expect(shouldSendExplicitDisabledThinking('deepseek-v4-pro')).toBe(true)
    expect(shouldSendExplicitDisabledThinking('kimi-for-coding')).toBe(true)
    expect(shouldSendExplicitDisabledThinking('gpt-5')).toBe(false)
    expect(shouldSendExplicitDisabledThinking('unknown-model')).toBe(false)
  })

  test('effort support comes from effortLevels', () => {
    expect(modelSupportsEffort('deepseek-v4-pro')).toBe(true)
    expect(modelSupportsMaxEffort('deepseek-v4-pro')).toBe(true)
    expect(modelSupportsEffort('gpt-5')).toBe(true)
    expect(modelSupportsMaxEffort('gpt-5')).toBe(false)
    expect(modelSupportsEffort('kimi-for-coding')).toBe(false)
    expect(modelSupportsEffort('unknown-model')).toBe(false)
  })

  test('the applied effort is mapped onto the model levels', () => {
    expect(resolveAppliedEffort('deepseek-v4-pro', undefined)).toBe('high')
    expect(resolveAppliedEffort('gpt-5', undefined)).toBe('medium')
    expect(resolveAppliedEffort('deepseek-v4-pro', 'low')).toBe('low')
    expect(resolveAppliedEffort('deepseek-v4-pro', 'medium')).toBe('high')
    expect(resolveAppliedEffort('gpt-5', 'max')).toBe('high')
    expect(resolveAppliedEffort('kimi-for-coding', 'high')).toBeUndefined()
  })

  test('CLAUDE_CODE_EFFORT_LEVEL still wins over the session effort', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'low'
    expect(resolveAppliedEffort('gpt-5', 'high')).toBe('low')
  })

  test('the default effort is the global effort from the rules', () => {
    setRules({ defaultEffort: 'high' })
    expect(getDefaultEffortForModel('gpt-5')).toBe('high')
    expect(resolveAppliedEffort('gpt-5', undefined)).toBe('high')
    expect(getDefaultEffortForModel('kimi-for-coding')).toBe('high')
  })

  test('settings effortLevel does not seed the session effort', () => {
    const spy = spyOn(settings, 'getInitialSettings').mockReturnValue({ effortLevel: 'low' } as never)
    try {
      expect(getInitialEffortSetting()).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })

  test('a settings effortLevel change does not replace the session effort', () => {
    const prev: AppState = { ...getDefaultAppState(), effortValue: 'high' }
    const spy = spyOn(settings, 'getInitialSettings').mockReturnValue({ ...prev.settings, effortLevel: 'low' })
    let next: AppState = prev
    try {
      applySettingsChange('userSettings', update => {
        next = update(prev)
      })
    } finally {
      spy.mockRestore()
    }
    expect(next.effortValue).toBe('high')
  })

  test('interleaved thinking is never requested', () => {
    expect(modelSupportsISP('deepseek-v4-pro')).toBe(false)
    expect(modelSupportsISP('claude-sonnet-4-6')).toBe(false)
  })

  test('the context window comes from the rules', () => {
    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_000_000)
    expect(getContextWindowForModel('DeepSeek-V4-Pro')).toBe(1_000_000)
    expect(getContextWindowForModel('claude-opus-4-7')).toBe(131_072)
    expect(getContextWindowForModel('unknown-model')).toBe(131_072)
  })

  test('output limits come from the rules before the Claude name table', () => {
    expect(getModelMaxOutputTokens('deepseek-v4-pro')).toEqual({ default: 32_000, upperLimit: 393_216 })
    expect(getModelMaxOutputTokens('gpt-5')).toEqual({ default: 8_192, upperLimit: 8_192 })
    expect(getModelMaxOutputTokens('claude-sonnet-4-6')).toEqual({ default: 32_000, upperLimit: 64_000 })
  })

  test('PDF support comes from the rules of the model passed in', () => {
    expect(isPDFSupported('gpt-5')).toBe(true)
    expect(isPDFSupported('deepseek-v4-pro')).toBe(false)
    expect(isPDFSupported('claude-sonnet-4-6')).toBe(false)
  })

  test('native web search comes from nativeWebSearch', () => {
    expect(resolveWebSearchProvider('deepseek-v4-pro', { mode: 'auto' }).provider).toBe('anthropic')
    expect(resolveWebSearchProvider('claude-sonnet-4-6', { mode: 'auto' }).provider).toBe('disabled')
  })

  test('an unparsable variable falls back for every model', () => {
    process.env[MODEL_RULES_ENV_KEY] = 'not json'
    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(131_072)
    expect(modelSupportsThinking('deepseek-v4-pro')).toBe(false)
    expect(modelSupportsEffort('deepseek-v4-pro')).toBe(false)
  })
})
