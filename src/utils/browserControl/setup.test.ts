import { describe, expect, it } from 'bun:test'
import {
  BROWSER_MCP_SERVER_NAME,
  BROWSER_MCP_TOKEN_ENV,
  BROWSER_MCP_URL_ENV,
  BROWSER_TOOL_NAMES,
} from '../../server/browserHost/names.js'
import { isBrowserControlMCPServer } from './common.js'
import { setupBrowserControlMCP } from './setup.js'

describe('setupBrowserControlMCP', () => {
  it('registers the sidecar endpoint as an http server with the session token', () => {
    const setup = setupBrowserControlMCP({
      [BROWSER_MCP_URL_ENV]: 'http://127.0.0.1:4321/browser-mcp',
      [BROWSER_MCP_TOKEN_ENV]: 'tok',
    })
    expect(setup?.mcpConfig).toEqual({
      'dreamcoder-browser': {
        type: 'http',
        url: 'http://127.0.0.1:4321/browser-mcp',
        headers: { Authorization: 'Bearer tok' },
        scope: 'dynamic',
      },
    })
  })

  it('allows exactly the fourteen browser tools without a CLI prompt', () => {
    const setup = setupBrowserControlMCP({
      [BROWSER_MCP_URL_ENV]: 'http://127.0.0.1:1/browser-mcp',
      [BROWSER_MCP_TOKEN_ENV]: 'tok',
    })
    expect(setup?.allowedTools).toEqual(BROWSER_TOOL_NAMES.map(tool => `mcp__dreamcoder-browser__${tool}`))
    expect(setup?.allowedTools).toHaveLength(14)
    expect(setup?.allowedTools).toContain('mcp__dreamcoder-browser__scroll')
    expect(setup?.allowedTools).toContain('mcp__dreamcoder-browser__wait_for')
    expect(setup?.allowedTools).toContain('mcp__dreamcoder-browser__styles')
    expect(setup?.allowedTools).toContain('mcp__dreamcoder-browser__evaluate')
    expect(setup?.allowedTools).toContain('mcp__dreamcoder-browser__emulate')
  })

  it('does nothing without both variables', () => {
    expect(setupBrowserControlMCP({})).toBeNull()
    expect(setupBrowserControlMCP({ [BROWSER_MCP_URL_ENV]: 'http://x' })).toBeNull()
    expect(setupBrowserControlMCP({ [BROWSER_MCP_TOKEN_ENV]: 'tok' })).toBeNull()
  })

  it('removes the endpoint and token from the environment it read them from', () => {
    const env: Record<string, string | undefined> = {
      [BROWSER_MCP_URL_ENV]: 'http://127.0.0.1:4321/browser-mcp',
      [BROWSER_MCP_TOKEN_ENV]: 'tok',
      OTHER: 'kept',
    }
    const setup = setupBrowserControlMCP(env)
    expect(setup?.mcpConfig['dreamcoder-browser']).toMatchObject({ url: 'http://127.0.0.1:4321/browser-mcp' })
    expect(env).toEqual({ OTHER: 'kept' })
  })

  it('leaves the environment alone when a variable is missing', () => {
    const env: Record<string, string | undefined> = { [BROWSER_MCP_URL_ENV]: 'http://x', OTHER: 'kept' }
    expect(setupBrowserControlMCP(env)).toBeNull()
    expect(env).toEqual({ [BROWSER_MCP_URL_ENV]: 'http://x', OTHER: 'kept' })
  })
})

describe('browser control reserved MCP name', () => {
  it('is dreamcoder-browser and does not match other browser servers', () => {
    expect(BROWSER_MCP_SERVER_NAME).toBe('dreamcoder-browser')
    expect(isBrowserControlMCPServer('dreamcoder-browser')).toBe(true)
    expect(isBrowserControlMCPServer('dreamcoder_browser')).toBe(false)
    expect(isBrowserControlMCPServer('browser')).toBe(false)
    expect(isBrowserControlMCPServer('playwright')).toBe(false)
  })
})
