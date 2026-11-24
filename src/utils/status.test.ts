import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { buildAPIProviderProperties } from './status.js'

const PROVIDER_ENV = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_AZURE_OPENAI',
] as const

describe('buildAPIProviderProperties', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(PROVIDER_ENV.map(name => [name, process.env[name]]))
    for (const name of PROVIDER_ENV) delete process.env[name]
  })

  afterEach(() => {
    for (const name of PROVIDER_ENV) {
      const value = saved[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test('names Azure OpenAI as the API provider', () => {
    process.env.CLAUDE_CODE_USE_AZURE_OPENAI = '1'
    expect(buildAPIProviderProperties()[0]).toEqual({
      label: 'API provider',
      value: 'Azure OpenAI',
    })
  })
})
