import { describe, expect, it } from 'vitest'

import {
  API_KEY_JSON_PLACEHOLDER,
  maskSettingsJsonSecrets,
  restoreSettingsJsonSecrets,
  stripProviderSettingsJsonEnv,
} from '../providerSettingsJson'

describe('provider settings JSON helpers', () => {
  it('masks both Anthropic API key env vars even when the values differ', () => {
    const raw = JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'stale-api-key',
        ANTHROPIC_AUTH_TOKEN: 'current-auth-token',
        OTHER_VALUE: 'visible',
      },
    })

    const masked = JSON.parse(maskSettingsJsonSecrets(raw)) as { env: Record<string, string> }

    expect(masked.env.ANTHROPIC_API_KEY).toBe(API_KEY_JSON_PLACEHOLDER)
    expect(masked.env.ANTHROPIC_AUTH_TOKEN).toBe(API_KEY_JSON_PLACEHOLDER)
    expect(masked.env.OTHER_VALUE).toBe('visible')
  })

  it('restores masked Anthropic API key env vars from their previous field values', () => {
    const previousRaw = JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: 'previous-api-key',
        ANTHROPIC_AUTH_TOKEN: 'previous-auth-token',
      },
    })
    const edited = {
      env: {
        ANTHROPIC_API_KEY: API_KEY_JSON_PLACEHOLDER,
        ANTHROPIC_AUTH_TOKEN: API_KEY_JSON_PLACEHOLDER,
      },
    }

    const restored = restoreSettingsJsonSecrets(edited, previousRaw, 'fallback-key')

    expect(restored.env.ANTHROPIC_API_KEY).toBe('previous-api-key')
    expect(restored.env.ANTHROPIC_AUTH_TOKEN).toBe('previous-auth-token')
  })

  it('strips provider-managed env vars from existing settings before preview merge', () => {
    const cleaned = stripProviderSettingsJsonEnv(
      {
        ANTHROPIC_API_KEY: 'old-api-key',
        ANTHROPIC_AUTH_TOKEN: 'old-auth-token',
        ANTHROPIC_BASE_URL: 'https://old.example.com',
        ANTHROPIC_MODEL: 'old-model',
        CLAUDE_CODE_MODEL_CONTEXT_WINDOWS: '{"old":100000}',
        DREAMCODER_OPENAI_OAUTH_PROVIDER: '1',
        OPENAI_CODEX_OAUTH_FILE: '/tmp/openai-oauth.json',
        DREAMCODER_SEND_DISABLED_THINKING: '1',
        USER_DEFINED: 'keep-me',
      },
      ['DREAMCODER_SEND_DISABLED_THINKING'],
    )

    expect(cleaned).toEqual({ USER_DEFINED: 'keep-me' })
  })
})
