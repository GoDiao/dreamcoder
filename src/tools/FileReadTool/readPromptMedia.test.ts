import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PROVIDER_PROXIED_ENV_KEY } from '../../utils/providerProxy.js'
import { renderPromptTemplate } from './prompt.js'

const originalEnv = {
  [PROVIDER_PROXIED_ENV_KEY]: process.env[PROVIDER_PROXIED_ENV_KEY],
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
}

beforeEach(() => {
  process.env.ANTHROPIC_MODEL = 'glm-5.1'
})

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('what the Read description says about images and PDFs', () => {
  test('through the provider proxy it says their contents do not reach the model', () => {
    process.env[PROVIDER_PROXIED_ENV_KEY] = '1'

    const prompt = renderPromptTemplate('', '', '')

    expect(prompt).not.toContain('Claude Code')
    expect(prompt).not.toContain('presented visually')
    expect(prompt).not.toContain('ALWAYS use this tool to view the file')
    expect(prompt).toContain('placeholder')
  })

  test('with a direct connection it describes images without naming Claude Code', () => {
    delete process.env[PROVIDER_PROXIED_ENV_KEY]

    const prompt = renderPromptTemplate('', '', '')

    expect(prompt).not.toContain('Claude Code')
    expect(prompt).toContain('presented visually')
  })
})
