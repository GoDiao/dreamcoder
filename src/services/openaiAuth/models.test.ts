import { describe, expect, test } from 'bun:test'
import {
  OPENAI_CODEX_LARGE_EFFECTIVE_CONTEXT_WINDOW,
  OPENAI_CODEX_SPARK_EFFECTIVE_CONTEXT_WINDOW,
  OPENAI_CODEX_STANDARD_EFFECTIVE_CONTEXT_WINDOW,
  OPENAI_DEFAULT_MAIN_MODEL,
  getOpenAICodexContextWindowForModel,
  isOpenAIResponsesModel,
  resolveOpenAICodexModel,
} from './models.js'

describe('openai auth model resolution', () => {
  test('does not treat opus as an OpenAI Responses model', () => {
    expect(isOpenAIResponsesModel('opus')).toBe(false)
  })

  test('accepts gpt and o-series models', () => {
    expect(isOpenAIResponsesModel('gpt-5.4')).toBe(true)
    expect(isOpenAIResponsesModel('o3-mini')).toBe(true)
  })

  test('maps opus aliases to the OpenAI default model', () => {
    expect(resolveOpenAICodexModel('opus')).toBe(OPENAI_DEFAULT_MAIN_MODEL)
  })

  test('maps Codex OAuth GPT models to effective Codex context windows', () => {
    expect(getOpenAICodexContextWindowForModel('gpt-5.5')).toBe(
      OPENAI_CODEX_STANDARD_EFFECTIVE_CONTEXT_WINDOW,
    )
    expect(getOpenAICodexContextWindowForModel('gpt-5.4')).toBe(
      OPENAI_CODEX_LARGE_EFFECTIVE_CONTEXT_WINDOW,
    )
    expect(getOpenAICodexContextWindowForModel('gpt-5.3-codex')).toBe(
      OPENAI_CODEX_STANDARD_EFFECTIVE_CONTEXT_WINDOW,
    )
    expect(getOpenAICodexContextWindowForModel('gpt-5.4-mini')).toBe(
      OPENAI_CODEX_STANDARD_EFFECTIVE_CONTEXT_WINDOW,
    )
    expect(getOpenAICodexContextWindowForModel('gpt-5.3-codex-spark')).toBe(
      OPENAI_CODEX_SPARK_EFFECTIVE_CONTEXT_WINDOW,
    )
  })
})
