import { describe, expect, it } from 'bun:test'
import { BROWSER_TOOLS_PATTERN } from '../../../utils/browserControl/common.js'
import { VERIFICATION_AGENT } from './verificationAgent.js'

describe('verification agent browser guidance', () => {
  const prompt = VERIFICATION_AGENT.getSystemPrompt({} as never)

  it('points at the side browser tools', () => {
    expect(BROWSER_TOOLS_PATTERN).toBe('mcp__dreamcoder-browser__*')
    expect(prompt).toContain('mcp__dreamcoder-browser__*')
  })

  it('no longer points at the playwright MCP server', () => {
    expect(prompt).not.toContain('mcp__playwright')
  })
})
