import { describe, expect, test } from 'bun:test'
import type { SavedDecisionProvider } from '../../server/types/provider.js'
import {
  getDecisionPolicy,
  parseFastModelDecision,
  parsePermissionGuardrailAskProbability,
} from './permissionGuardrail.js'

function provider(
  apiFormat: SavedDecisionProvider['apiFormat'],
  modelId = 'model',
): SavedDecisionProvider {
  return {
    id: 'provider',
    presetId: 'custom',
    name: 'Provider',
    deployment: 'hosted',
    apiFormat,
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret',
    models: [{ id: modelId }],
  }
}

describe('Auto permission evaluator', () => {
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

  test('does not treat malformed chat output as safe', () => {
    expect(parsePermissionGuardrailAskProbability(
      provider('openai_chat'),
      { choices: [{ message: { content: '{"risk":64}' } }] },
    )).toBe(0.64)
    expect(parsePermissionGuardrailAskProbability(
      provider('openai_chat'),
      { choices: [{ message: { content: 'allow' } }] },
    )).toBeNull()
  })

  test('registers a fixed policy only for the validated OpenAI Decisions model', () => {
    expect(getDecisionPolicy(provider('openai_decisions', 'gpt-6-luna'), 'gpt-6-luna')).toEqual({
      threshold: 0.5,
      policyVersion: 1,
    })
    expect(getDecisionPolicy(provider('openrouter_decisions', 'gpt-6-luna'), 'gpt-6-luna')).toBeNull()
    expect(getDecisionPolicy(provider('openai_decisions', 'other'), 'other')).toBeNull()
  })

  test('parses forced fast-model output conservatively', () => {
    expect(parseFastModelDecision({ behavior: 'allow', reason: 'Requested read' })).toEqual({
      behavior: 'allow',
      reason: 'Requested read',
    })
    expect(parseFastModelDecision({ behavior: 'allowish' })).toBeNull()
    expect(parseFastModelDecision(null)).toBeNull()
  })
})
