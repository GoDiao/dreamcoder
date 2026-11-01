import { describe, expect, test } from 'bun:test'
import { browserMcpChildEnv, webCloneChildEnv } from './childEnv.js'
import { BrowserHostChannel } from './hostChannel.js'
import { BROWSER_MCP_TOKEN_ENV, BROWSER_MCP_URL_ENV, WEB_CLONE_TOKEN_ENV, WEB_CLONE_URL_ENV } from './names.js'
import { BrowserSessionTokens } from './sessionTokens.js'
import { FakeDesktop } from './testSupport.js'

describe('browserMcpChildEnv', () => {
  test('gives a connected desktop session an endpoint and its own token', () => {
    const channel = new BrowserHostChannel()
    new FakeDesktop(channel)
    const tokens = new BrowserSessionTokens()
    const env = browserMcpChildEnv('s1', 'http://127.0.0.1:4000', { channel, tokens })
    expect(env[BROWSER_MCP_URL_ENV]).toBe('http://127.0.0.1:4000/browser-mcp')
    expect(tokens.resolve(env[BROWSER_MCP_TOKEN_ENV]!)).toBe('s1')
    expect(browserMcpChildEnv('s2', 'http://127.0.0.1:4000', { channel, tokens })[BROWSER_MCP_TOKEN_ENV]).not.toBe(
      env[BROWSER_MCP_TOKEN_ENV],
    )
  })

  test('gives nothing when no desktop browser is connected', () => {
    expect(browserMcpChildEnv('s1', 'http://127.0.0.1:4000', { channel: new BrowserHostChannel(), tokens: new BrowserSessionTokens() })).toEqual({})
  })

  test('gives nothing without a server url', () => {
    const channel = new BrowserHostChannel()
    new FakeDesktop(channel)
    expect(browserMcpChildEnv('s1', undefined, { channel, tokens: new BrowserSessionTokens() })).toEqual({})
  })
})

describe('webCloneChildEnv', () => {
  test('gives the app address and a token of its own, not the ones of the browser tools', () => {
    const channel = new BrowserHostChannel()
    new FakeDesktop(channel)
    const tokens = new BrowserSessionTokens()
    const env = webCloneChildEnv('s1', 'http://127.0.0.1:3456', { channel, tokens })
    expect(env[WEB_CLONE_URL_ENV]).toBe('http://127.0.0.1:3456/web-clone-browser')
    expect(tokens.resolve(env[WEB_CLONE_TOKEN_ENV]!)).toBe('s1')
    expect(Object.keys(env)).not.toContain(BROWSER_MCP_URL_ENV)
    expect(Object.keys(env)).not.toContain(BROWSER_MCP_TOKEN_ENV)
  })

  test('gives nothing without the desktop app or without a server address', () => {
    const channel = new BrowserHostChannel()
    new FakeDesktop(channel)
    expect(webCloneChildEnv('s1', undefined, { channel, tokens: new BrowserSessionTokens() })).toEqual({})
    expect(webCloneChildEnv('s1', 'http://127.0.0.1:3456', { channel: new BrowserHostChannel(), tokens: new BrowserSessionTokens() })).toEqual({})
  })
})
