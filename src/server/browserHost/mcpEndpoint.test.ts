import { describe, expect, test } from 'bun:test'
import { BrowserHostChannel } from './hostChannel.js'
import { handleBrowserMcpRequest } from './mcpEndpoint.js'
import { BrowserService } from './service.js'
import { BrowserSessionTokens } from './sessionTokens.js'
import { BROWSER_TOOL_NAMES } from './names.js'
import { allowAllGrants, FakeDesktop, FakeSnapshotter, makeInspect, makeView } from './testSupport.js'

function setup() {
  const channel = new BrowserHostChannel()
  const desktop = new FakeDesktop(channel)
  desktop.setViews([makeView(), makeView({ sessionId: 's2', tabId: 'other' })])
  desktop.on('inspect', () => makeInspect({ local: true, origin: 'http://localhost:3000' }))
  desktop.on('cdp', () => ({ result: { data: 'QUJD' } }))
  const snapshotter = new FakeSnapshotter()
  const service = new BrowserService({
    channel,
    grants: allowAllGrants(),
    getProjectRoot: () => null,
    createSnapshotter: () => snapshotter,
    settleMs: 0,
  })
  const tokens = new BrowserSessionTokens()
  const deps = { service, tokens, version: '0.0.0-test' }
  return { desktop, tokens, deps, snapshotter }
}

function rpc(token: string | null, body: unknown) {
  return new Request('http://127.0.0.1/browser-mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function call(deps: ReturnType<typeof setup>['deps'], token: string, name: string, args: Record<string, unknown>) {
  const response = await handleBrowserMcpRequest(
    rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    deps,
  )
  return { response, json: (await response.json()) as { result?: { content: Array<Record<string, unknown>>; isError?: boolean }; error?: unknown } }
}

describe('browser MCP endpoint', () => {
  test('rejects requests without a valid session token', async () => {
    const { deps } = setup()
    const none = await handleBrowserMcpRequest(rpc(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), deps)
    expect(none.status).toBe(401)
    const wrong = await handleBrowserMcpRequest(rpc('nope', { jsonrpc: '2.0', id: 1, method: 'tools/list' }), deps)
    expect(wrong.status).toBe(401)
  })

  test('lists the fourteen tools with read-only hints', async () => {
    const { deps, tokens } = setup()
    const token = tokens.issue('s1')
    const response = await handleBrowserMcpRequest(rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), deps)
    expect(response.status).toBe(200)
    const json = (await response.json()) as { result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> } }
    expect(json.result.tools.map((tool) => tool.name).sort()).toEqual([...BROWSER_TOOL_NAMES].sort())
    const byName = Object.fromEntries(json.result.tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]))
    expect(json.result.tools).toHaveLength(14)
    expect(byName.snapshot).toBe(true)
    expect(byName.scroll).toBe(true)
    expect(byName.wait_for).toBe(true)
    expect(byName.styles).toBe(true)
    expect(byName.emulate).toBe(false)
    expect(byName.click).toBe(false)
    expect(byName.evaluate).toBe(false)
  })

  test('runs a tool for the session the token belongs to, never another', async () => {
    const { deps, tokens, desktop } = setup()
    const token = tokens.issue('s1')
    const { json } = await call(deps, token, 'snapshot', {})
    expect(json.result?.isError).toBeUndefined()
    expect(String(json.result?.content[0]?.text)).toContain('[1] button "Go"')
    expect(desktop.of('inspect').every((entry) => entry.tabId === 't1')).toBe(true)
    const refused = await call(deps, token, 'snapshot', { tabId: 'other' })
    expect(refused.json.result?.isError).toBe(true)
    expect(String(refused.json.result?.content[0]?.text)).toContain('tab_unavailable')
  })

  test('returns image content for a screenshot', async () => {
    const { deps, tokens } = setup()
    const { json } = await call(deps, tokens.issue('s1'), 'screenshot', {})
    expect(json.result?.content[1]).toMatchObject({ type: 'image', data: 'QUJD', mimeType: 'image/jpeg' })
  })

  test('validates tool arguments before running anything', async () => {
    const { deps, tokens, desktop } = setup()
    const { json } = await call(deps, tokens.issue('s1'), 'click', { id: 'one' })
    expect(JSON.stringify(json)).toContain('error')
    expect(desktop.commands.filter((entry) => entry.command.kind === 'cdp')).toEqual([])
  })

  test('runs wait_for, styles and evaluate for the session and rejects bad arguments before the page', async () => {
    const { deps, tokens, desktop, snapshotter } = setup()
    const token = tokens.issue('s1')
    const waited = await call(deps, token, 'wait_for', { text: 'Hello', timeoutMs: 100 })
    expect(waited.json.result?.isError).toBeUndefined()
    expect(String(waited.json.result?.content[0]?.text)).toContain('Text appeared after')
    expect(snapshotter.hasTextCalls).toEqual(['Hello'])
    await call(deps, token, 'snapshot', {})
    const styled = await call(deps, token, 'styles', { id: 1, properties: ['display'] })
    expect(String(styled.json.result?.content[0]?.text)).toContain('display: inline-block')
    expect(snapshotter.stylesCalls).toEqual([{ id: 1, properties: ['display'] }])
    const cdpBefore = desktop.of('cdp').length
    const bad = [
      await call(deps, token, 'wait_for', { text: 'x', timeoutMs: 50 }),
      await call(deps, token, 'wait_for', { text: '' }),
      await call(deps, token, 'styles', { id: 1, properties: ['margin top'] }),
      await call(deps, token, 'styles', { id: 1, properties: [] }),
      await call(deps, token, 'evaluate', { expression: '' }),
      await call(deps, token, 'evaluate', { expression: 'x'.repeat(10_001) }),
    ]
    for (const entry of bad) expect(JSON.stringify(entry.json)).toContain('error')
    expect(desktop.of('cdp')).toHaveLength(cdpBefore)
    expect(snapshotter.hasTextCalls).toEqual(['Hello'])
  })

  test('runs emulate for the session and rejects out-of-range arguments before the page', async () => {
    const { deps, tokens, desktop } = setup()
    const token = tokens.issue('s1')
    const emulated = await call(deps, token, 'emulate', { width: 375, height: 667, colorScheme: 'dark' })
    expect(emulated.json.result?.isError).toBeUndefined()
    expect(String(emulated.json.result?.content[0]?.text)).toContain('Emulation active: 375x667 (desktop), color scheme dark.')
    expect(desktop.cdpMethods()).toEqual(['Emulation.setDeviceMetricsOverride', 'Emulation.setEmulatedMedia'])
    const cdpBefore = desktop.of('cdp').length
    const bad = [
      await call(deps, token, 'emulate', { width: 199, height: 667 }),
      await call(deps, token, 'emulate', { width: 375, height: 4001 }),
      await call(deps, token, 'emulate', { width: 375, height: 667, deviceScaleFactor: 5 }),
      await call(deps, token, 'emulate', { colorScheme: 'sepia' }),
      await call(deps, token, 'emulate', { reducedMotion: 'always' }),
    ]
    for (const entry of bad) expect(JSON.stringify(entry.json)).toContain('error')
    expect(desktop.of('cdp')).toHaveLength(cdpBefore)
  })

  test('a revoked token stops working', async () => {
    const { deps, tokens } = setup()
    const token = tokens.issue('s1')
    tokens.revoke('s1')
    const response = await handleBrowserMcpRequest(rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), deps)
    expect(response.status).toBe(401)
  })
})
