import { describe, expect, it } from 'bun:test'
import { CUA_MCP_SERVER_NAME, isCuaMCPServer } from './common.js'

describe('cua reserved MCP name', () => {
  it('is cua', () => {
    expect(CUA_MCP_SERVER_NAME).toBe('cua')
  })

  it('matches the name after MCP normalization only', () => {
    expect(isCuaMCPServer('cua')).toBe(true)
    expect(isCuaMCPServer('computer-use')).toBe(false)
    expect(isCuaMCPServer('cua-computer-use')).toBe(false)
  })
})
