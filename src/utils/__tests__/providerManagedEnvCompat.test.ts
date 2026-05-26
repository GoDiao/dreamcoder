import { describe, expect, test } from 'bun:test'
import { isProviderManagedEnvVar } from '../managedEnvConstants.js'
import { normalizeLegacyDeepSeekManagedEnv } from '../providerManagedEnvCompat.js'

describe('provider managed env compatibility', () => {
  test('normalizes legacy DeepSeek disabled-thinking env without dropping custom env vars', () => {
    const { env, changed } = normalizeLegacyDeepSeekManagedEnv({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_MODEL: 'deepseek-v4-pro',
      DREAMCODER_SEND_DISABLED_THINKING: '1',
      USER_CUSTOM_ENV: 'keep-me',
    })

    expect(changed).toBe(true)
    expect(env.DREAMCODER_SEND_DISABLED_THINKING).toBeUndefined()
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,max_effort',
    )
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,max_effort',
    )
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,max_effort',
    )
    expect(env.USER_CUSTOM_ENV).toBe('keep-me')
  })

  test('does not change non-DeepSeek providers that still opt into disabled thinking', () => {
    const input = {
      ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
      ANTHROPIC_MODEL: 'glm-5.1',
      DREAMCODER_SEND_DISABLED_THINKING: '1',
    }

    const { env, changed } = normalizeLegacyDeepSeekManagedEnv(input)

    expect(changed).toBe(false)
    expect(env).toBe(input)
  })

  test('treats attribution header routing as provider-managed env', () => {
    expect(isProviderManagedEnvVar('CLAUDE_CODE_ATTRIBUTION_HEADER')).toBe(true)
  })
})
