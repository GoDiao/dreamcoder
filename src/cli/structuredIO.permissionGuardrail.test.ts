import { describe, expect, test } from 'bun:test'
import type { PermissionDecision } from '../utils/permissions/PermissionResult.js'
import {
  preservePermissionGuardrailReason,
  serializePermissionGuardrail,
} from './structuredIO.js'

describe('structured Auto permission response', () => {
  test('preserves the model decision after desktop approval', () => {
    const source: PermissionDecision = {
      behavior: 'ask',
      message: 'Confirm',
      decisionReason: {
        type: 'autoPermission',
        providerId: 'provider',
        modelId: 'model',
        source: 'decisionProvider',
        decision: 'ask',
        score: 0.98,
        policyVersion: 1,
        reason: 'Risky write',
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

  test('serializes Auto details for the permission request', () => {
    expect(serializePermissionGuardrail({
      type: 'autoPermission',
      providerId: 'provider-1',
      modelId: 'gpt-6-luna',
      source: 'decisionProvider',
      decision: 'ask',
      score: 0.812,
      policyVersion: 1,
      reason: 'Sensitive command',
    })).toEqual({
      provider_id: 'provider-1',
      model_id: 'gpt-6-luna',
      source: 'decisionProvider',
      decision: 'ask',
      score: 0.812,
      policy_version: 1,
      reason: 'Sensitive command',
    })
  })
})
