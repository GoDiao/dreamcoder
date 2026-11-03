import { describe, expect, test } from 'bun:test'
import type { PermissionDecision } from '../utils/permissions/PermissionResult.js'
import {
  preservePermissionGuardrailReason,
  serializePermissionGuardrail,
} from './structuredIO.js'

describe('structured permission guardrail response', () => {
  test('preserves the guardrail decision after desktop approval', () => {
    const source: PermissionDecision = {
      behavior: 'ask',
      message: 'Confirm',
      decisionReason: {
        type: 'permissionGuardrail',
        providerId: 'provider',
        modelId: 'model',
        preset: 'safetyNet',
        decision: 'ask',
        score: 0.98,
      },
    }
    const response: PermissionDecision = {
      behavior: 'allow',
      updatedInput: {},
    }

    expect(preservePermissionGuardrailReason(source, response)).toEqual({
      ...response,
      decisionReason: source.decisionReason,
    })
  })

  test('keeps ordinary permission responses unchanged', () => {
    const source: PermissionDecision = {
      behavior: 'ask',
      message: 'Confirm',
      decisionReason: { type: 'mode', mode: 'default' },
    }
    const response: PermissionDecision = {
      behavior: 'allow',
      updatedInput: {},
    }

    expect(preservePermissionGuardrailReason(source, response)).toBe(response)
  })

  test('serializes guardrail details for the permission request', () => {
    expect(serializePermissionGuardrail({
      type: 'permissionGuardrail',
      providerId: 'provider-1',
      modelId: 'gpt-6-luna',
      preset: 'safetyNet',
      decision: 'ask',
      score: 0.812,
    })).toEqual({
      provider_id: 'provider-1',
      model_id: 'gpt-6-luna',
      preset: 'safetyNet',
      decision: 'ask',
      score: 0.812,
    })
  })
})
