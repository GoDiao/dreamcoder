import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type CliModelRules, MODEL_RULES_ENV_KEY } from '../../utils/model/modelRules.js'
import { PROVIDER_PROXIED_ENV_KEY } from '../../utils/providerProxy.js'
import { renderPromptTemplate } from './prompt.js'

const ENV_KEYS = [PROVIDER_PROXIED_ENV_KEY, MODEL_RULES_ENV_KEY, 'ANTHROPIC_MODEL'] as const

const base: CliModelRules = {
  contextWindow: 131_072,
  thinkingWhenOn: 'omit',
  thinkingWhenOff: 'omit',
  effortLevels: [],
  pdf: false,
  image: true,
  nativeWebSearch: false,
  structuredOutput: false,
}

let saved: Record<string, string | undefined>

function useRules(model: string, rules: CliModelRules): void {
  process.env.ANTHROPIC_MODEL = model
  process.env[PROVIDER_PROXIED_ENV_KEY] = '1'
  process.env[MODEL_RULES_ENV_KEY] = JSON.stringify({ models: { [model]: rules }, fallback: base, defaultEffort: 'medium' })
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('what the Read description says about images and PDFs', () => {
  test('through the provider proxy a model that takes images is told to view screenshots', () => {
    useRules('gpt-5', { ...base, image: true, pdf: true })

    const prompt = renderPromptTemplate('', '', '')

    expect(prompt).toContain('presented visually')
    expect(prompt).toContain('ALWAYS use this tool to view the file')
    expect(prompt).toContain('This tool can read PDF files')
    expect(prompt).not.toContain('Claude Code')
  })

  test('a model without image input is told images arrive as a text note', () => {
    useRules('text-only', { ...base, image: false })

    const prompt = renderPromptTemplate('', '', '')

    expect(prompt).not.toContain('presented visually')
    expect(prompt).not.toContain('ALWAYS use this tool to view the file')
    expect(prompt).not.toContain('This tool can read PDF files')
    expect(prompt).toContain('a short text note')
  })

  test('with a direct connection it describes images without naming Claude Code', () => {
    delete process.env[PROVIDER_PROXIED_ENV_KEY]
    delete process.env[MODEL_RULES_ENV_KEY]
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'

    const prompt = renderPromptTemplate('', '', '')

    expect(prompt).not.toContain('Claude Code')
    expect(prompt).toContain('presented visually')
  })
})
