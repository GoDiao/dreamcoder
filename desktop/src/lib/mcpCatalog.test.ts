import { describe, expect, it, vi } from 'vitest'
import { filterMcpCatalog, hasInstalledCatalogName, InvalidMcpCatalogError, loadMcpCatalog, parseMcpCatalog } from './mcpCatalog'

const entry = {
  id: 'sample-server', name: 'Sample Server', description: 'A fake server for offline tests.',
  transport: 'stdio', command: 'sample-mcp', args: ['{env:TEST_PATH}'],
  env: [{ name: 'TEST_PATH', source: 'user', description: 'A fake path.' }],
  homepage: 'https://example.com/mcp', tags: ['files', 'local'], runtime: 'node',
}
const raw = (servers: unknown[] = [entry], version = 1) => JSON.stringify({ version, servers })

describe('MCP catalog model', () => {
  it('loads the shipped catalog without fetch or a backend', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is forbidden'))
    try {
      const registry = await loadMcpCatalog()
      expect(registry.servers.length).toBeGreaterThan(0)
      expect(registry.servers.find((server) => server.id === 'brave-search')).toBeDefined()
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })

  it('uses the shared contract and defaults optional arrays', () => {
    const { args: _args, env: _env, ...minimal } = entry
    expect(parseMcpCatalog(raw([minimal])).servers[0]).toMatchObject({ args: [], env: [] })
  })

  it.each([
    ['malformed JSON', '{'],
    ['unsupported version', raw([entry], 2)],
    ['empty registry', raw([])],
    ['duplicate IDs', raw([entry, entry])],
    ['remote transport', raw([{ ...entry, transport: 'http' }])],
    ['secret value', raw([{ ...entry, env: [{ name: 'API_KEY', source: 'user', value: 'fake-secret' }] }])],
    ['absolute command', raw([{ ...entry, command: '/bin/fake' }])],
    ['partially invalid registry', raw([entry, { ...entry, id: 'other', runtime: 'unknown' }])],
    ...['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test'].map((homepage) => ['unsafe homepage', raw([{ ...entry, homepage }])]),
  ])('fails closed for %s', (_name, input) => {
    expect(() => parseMcpCatalog(input!)).toThrow(InvalidMcpCatalogError)
  })

  it('reports field paths without rendering invalid entries', () => {
    try {
      parseMcpCatalog(raw([{ ...entry, homepage: 'file:///tmp/test' }]))
      expect.unreachable('Expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMcpCatalogError)
      expect((error as InvalidMcpCatalogError).issues).toContainEqual({ path: 'servers.0.homepage', message: 'Homepage must use HTTP or HTTPS' })
    }
  })

  it('combines case-insensitive search terms with an exact tag filter', () => {
    const entries = parseMcpCatalog(raw()).servers
    expect(filterMcpCatalog(entries, '  SAMPLE   test_path ', 'files')).toEqual(entries)
    expect(filterMcpCatalog(entries, 'node offline', '')).toEqual(entries)
    expect(filterMcpCatalog(entries, 'sample', 'file')).toEqual([])
    expect(filterMcpCatalog(entries, 'missing', '')).toEqual([])
    expect(filterMcpCatalog(entries, '  ', '')).toEqual(entries)
  })

  it('matches installed configuration names against exact IDs or display names', () => {
    const server = parseMcpCatalog(raw()).servers[0]!
    for (const name of ['sample-server', 'Sample Server']) expect(hasInstalledCatalogName(server, new Set([name]))).toBe(true)
    for (const name of ['sample', 'SAMPLE-SERVER', 'plugin:sample-server']) expect(hasInstalledCatalogName(server, new Set([name]))).toBe(false)
  })
})
