import { describe, expect, test } from 'bun:test'
import type { SavedDecisionProvider } from '../../server/types/provider.js'
import {
  isPermissionGuardrailAutoAllowCalibrated,
  parsePermissionGuardrailAskProbability,
  resolvePermissionGuardrailBehavior,
  resolvePermissionGuardrailProviderBehavior,
} from './permissionGuardrail.js'

function provider(
  apiFormat: SavedDecisionProvider['apiFormat'],
): SavedDecisionProvider {
  return {
    id: 'provider',
    presetId: 'custom',
    name: 'Provider',
    deployment: 'hosted',
    apiFormat,
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret',
    models: [{ id: 'model' }],
  }
}

describe('permission guardrail', () => {
  test('parses OpenAI predicate answers from the answers array', () => {
    expect(parsePermissionGuardrailAskProbability(
      provider('openai_decisions'),
      { answers: [{ type: 'predicate', name: 'ask', probability: 0.82 }] },
    )).toBe(0.82)
  })

  test('parses OpenRouter noul answers', () => {
    expect(parsePermissionGuardrailAskProbability(
      provider('openrouter_decisions'),
      { answers: { ask: { noul: 0.73 } } },
    )).toBe(0.73)
  })

  test('parses chat risk without treating malformed output as safe', () => {
    expect(parsePermissionGuardrailAskProbability(
      provider('openai_chat'),
      { choices: [{ message: { content: '{"risk":64}' } }] },
    )).toBe(0.64)
    expect(parsePermissionGuardrailAskProbability(
      provider('openai_chat'),
      { choices: [{ message: { content: 'allow' } }] },
    )).toBeNull()
  })

  test('uses opposite threshold directions for the two presets', () => {
    expect(resolvePermissionGuardrailBehavior('fewerPrompts', 0.01, 0.95)).toBe('allow')
    expect(resolvePermissionGuardrailBehavior('fewerPrompts', 0.1, 0.95)).toBe('ask')
    expect(resolvePermissionGuardrailBehavior('safetyNet', 0.98, 0.95)).toBe('ask')
    expect(resolvePermissionGuardrailBehavior('safetyNet', 0.2, 0.95)).toBe('allow')
  })

  test('does not auto-allow an uncalibrated model', () => {
    expect(isPermissionGuardrailAutoAllowCalibrated(
      provider('openai_decisions'),
      'gpt-6-luna',
    )).toBe(false)
    expect(resolvePermissionGuardrailProviderBehavior(
      provider('openai_decisions'),
      'gpt-6-luna',
      'fewerPrompts',
      0.01,
      0.95,
    )).toBe('ask')
  })
})
