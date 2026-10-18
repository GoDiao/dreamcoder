import { describe, expect, it } from 'vitest'
import { getMcpSecretValues, redactMcpDiagnostic } from './mcpRedaction'

describe('MCP diagnostic redaction', () => {
  it('keeps ordinary settings unchanged while selecting secret names case-insensitively', () => {
    const env = { DEBUG: '1', NODE_ENV: 'production', READ_ONLY: 'true', DIRECTORY: '/workspace/project', api_token: 'secret-value', Password: 'act' }
    expect(redactMcpDiagnostic('exit 1 in production: true /workspace/project secret-value act', getMcpSecretValues(env)))
      .toBe('exit 1 in production: true /workspace/project [redacted] [redacted]')
  })

  it('redacts literal and JSON-escaped secrets recursively without changing the input', () => {
    const secret = ' $token.*[a](b)?\\雪\nvalue '
    const value = { message: JSON.stringify({ value: secret }), nested: [secret, { [secret]: secret }], status: 400 }
    expect(redactMcpDiagnostic(value, [secret])).toEqual({
      message: '{"value":"[redacted]"}', nested: ['[redacted]', { '[redacted]': '[redacted]' }], status: 400,
    })
    expect(value.nested[0]).toBe(secret)
  })

  it('matches overlaps longest first and never scans generated replacement markers', () => {
    expect(redactMcpDiagnostic('abc-long abc act [', ['abc', 'abc-long', 'act', '[', '']))
      .toBe('[redacted] [redacted] [redacted] [redacted]')
  })

  it('ignores empty or non-string environment values and retains no request state', () => {
    expect(getMcpSecretValues({ TOKEN: '', KEY: 1, SECRET: null })).toEqual([])
    expect(redactMcpDiagnostic('first-secret', getMcpSecretValues({ TOKEN: 'first-secret' }))).toBe('[redacted]')
    expect(redactMcpDiagnostic('first-secret', getMcpSecretValues())).toBe('first-secret')
  })
})
