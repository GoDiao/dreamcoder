import { describe, expect, it } from 'bun:test'
import { createMcpEnvironmentRedactor } from './redactEnvironment.js'

describe('MCP connection environment redaction', () => {
  it('redacts repeated values while preserving useful failure context', () => {
    const redact = createMcpEnvironmentRedactor({ API_TOKEN: 'synthetic-secret' })
    expect(redact('Server stderr: invalid API_TOKEN=synthetic-secret; retry synthetic-secret'))
      .toBe('Server stderr: invalid API_TOKEN=[redacted]; retry [redacted]')
  })

  it('treats punctuation, Unicode, whitespace and newlines literally', () => {
    const secret = ' $token.*[a](b)?\\雪\nvalue '
    const redact = createMcpEnvironmentRedactor({ API_TOKEN: secret })
    expect(redact(`prefix${secret}suffix`)).toBe('prefix[redacted]suffix')
    expect(redact('unrelated token text')).toBe('unrelated token text')
  })

  it('redacts JSON-escaped values in serialized error messages', () => {
    const secret = 'synthetic-"quote"\nline\\tail'
    const redact = createMcpEnvironmentRedactor({ API_TOKEN: secret })
    expect(redact(JSON.stringify({ error: secret }))).toBe('{"error":"[redacted]"}')
  })

  it('redacts values split across accumulated stderr chunks', () => {
    const redact = createMcpEnvironmentRedactor({ TOKEN: 'synthetic-split-secret' })
    const chunks = ['Server stderr: synthetic-sp', 'lit-se', 'cret failed']
    expect(redact(chunks.join(''))).toBe('Server stderr: [redacted] failed')
  })

  it('matches overlapping values longest first and does not rewrite its replacement', () => {
    const redact = createMcpEnvironmentRedactor({ SHORT_TOKEN: 'synthetic', LONG_TOKEN: 'synthetic-long', BRACKET_KEY: '[' })
    expect(redact('synthetic-long synthetic [')).toBe('[redacted] [redacted] [redacted]')
  })

  it('leaves DEBUG=1 and other ordinary environment values unchanged in errors', () => {
    const env = { DEBUG: '1', NODE_ENV: 'production', READ_ONLY: 'true', DIRECTORY: '/workspace/long-directory' }
    const message = 'pkg@1.2.1 failed with exit 1 in production: READ_ONLY=true at /workspace/long-directory'
    expect(createMcpEnvironmentRedactor(env)(message)).toBe(message)
  })

  it('selects secret names case-insensitively, including short values', () => {
    const redact = createMcpEnvironmentRedactor({ api_token: 'abc-long-secret', Password: 'act', DEBUG: '1' })
    expect(redact('exit 1: abc-long-secret act')).toBe('exit 1: [redacted] [redacted]')
  })

  it('ignores empty values and leaves non-configured text unchanged', () => {
    expect(createMcpEnvironmentRedactor({ EMPTY: '' })('startup failed')).toBe('startup failed')
    expect(createMcpEnvironmentRedactor()('startup failed')).toBe('startup failed')
  })

  it('keeps redaction values local to each connection and does not mutate config', () => {
    const env = { TOKEN: 'synthetic-first' }
    const first = createMcpEnvironmentRedactor(env)
    const second = createMcpEnvironmentRedactor({ TOKEN: 'synthetic-second' })
    expect(first('synthetic-first synthetic-second')).toBe('[redacted] synthetic-second')
    expect(second('synthetic-first synthetic-second')).toBe('synthetic-first [redacted]')
    expect(env).toEqual({ TOKEN: 'synthetic-first' })
  })
})
