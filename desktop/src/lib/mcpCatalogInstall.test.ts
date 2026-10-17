import { describe, expect, it } from 'vitest'
import registryJson from '../../../mcp-registry.json?raw'
import type { McpCatalogEntry } from '../types/mcp'
import { prepareCatalogInstall } from './mcpCatalogInstall'

const catalog = JSON.parse(registryJson) as { servers: McpCatalogEntry[] }

function entry(overrides: Partial<McpCatalogEntry> = {}): McpCatalogEntry {
  return {
    id: 'example',
    name: 'Example',
    description: 'An example MCP server.',
    homepage: 'https://example.com',
    tags: ['test'],
    transport: 'stdio',
    runtime: 'node',
    command: '@example/server',
    args: [],
    env: [],
    ...overrides,
  }
}

function configFor(server: McpCatalogEntry, values: Record<string, string> = {}) {
  const result = prepareCatalogInstall(server, values)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Unexpected preparation error: ${result.error.code}`)
  return result.config
}

describe('prepareCatalogInstall', () => {
  const shippedCases: Array<{ id: string; command: string; args: string[]; env: Record<string, string> }> = [
    { id: 'filesystem', command: 'npx', args: ['--yes', '--', '@modelcontextprotocol/server-filesystem', '/workspace/allowed files'], env: { ALLOWED_DIR: '/workspace/allowed files' } },
    { id: 'git', command: 'uvx', args: ['--no-python-downloads', 'mcp-server-git@0.6.2', '--repository', '/workspace/repository'], env: { REPO_PATH: '/workspace/repository' } },
    { id: 'fetch', command: 'uvx', args: ['--no-python-downloads', 'mcp-server-fetch@2025.4.7'], env: {} },
    { id: 'memory', command: 'npx', args: ['--yes', '--', '@modelcontextprotocol/server-memory'], env: {} },
    { id: 'brave-search', command: 'npx', args: ['--yes', '--', '@brave/brave-search-mcp-server@2.1.4'], env: { BRAVE_API_KEY: 'synthetic-api-key' } },
    { id: 'everything', command: 'npx', args: ['--yes', '--', '@modelcontextprotocol/server-everything@1.0.0'], env: {} },
    { id: 'time', command: 'uvx', args: ['--no-python-downloads', 'mcp-server-time@0.6.2'], env: {} },
  ]

  it('covers every shipped catalog entry', () => {
    expect(catalog.servers.map((server) => server.id).sort()).toEqual(shippedCases.map((server) => server.id).sort())
  })

  it.each(shippedCases)('prepares the shipped $id entry', ({ id, command, args, env }) => {
    const server = catalog.servers.find((candidate) => candidate.id === id)
    expect(server).toBeDefined()
    expect(configFor(server!, env)).toEqual({ type: 'stdio', command, args, env })
  })

  it.each([
    { runtime: 'node', command: 'npx', prefix: ['--yes', '--'] },
    { runtime: 'bun', command: 'bun', prefix: ['x', '--bun'] },
    { runtime: 'uvx', command: 'uvx', prefix: ['--no-python-downloads'] },
  ] as const)('supports an unpinned $runtime package without inventing a version', ({ runtime, command, prefix }) => {
    expect(configFor(entry({ runtime, command: 'example-server', args: ['--verbose', 'one argument'] }))).toEqual({
      type: 'stdio', command, args: [...prefix, 'example-server', '--verbose', 'one argument'], env: {},
    })
  })

  it('forces Bun execution while keeping version and server options in separate arguments', () => {
    expect(configFor(entry({ runtime: 'bun', version: '2.1.4', args: ['--name', 'Example Server'] }))).toEqual({
      type: 'stdio', command: 'bun', args: ['x', '--bun', '@example/server@2.1.4', '--name', 'Example Server'], env: {},
    })
  })

  it.each(['python', 'binary', 'unknown'] as const)('does not invent an executable for runtime %s', (runtime) => {
    expect(prepareCatalogInstall(entry({ runtime: runtime as McpCatalogEntry['runtime'] }), {})).toEqual({
      ok: false, error: { code: 'unsupportedRuntime' },
    })
  })

  it.each(['', ' server', 'server ', '-server', '--help', './server', '../server', '/bin/server', 'C:\\server', 'scope/server', '@scope', '@scope/', '@scope/server@1.2.3', 'server@latest', 'npm:server', 'https://example.com/server', 'git+https://example.com/server', 'server;command', 'server\ncommand', 'server\0', 'mcp-服务器', 'x'.repeat(215)])('rejects ambiguous npm package %j', (command) => {
    for (const runtime of ['node', 'bun'] as const) {
      expect(prepareCatalogInstall(entry({ runtime, command }), {})).toEqual({ ok: false, error: { code: 'invalidPackage' } })
    }
  })

  it.each(['server', '@scope/server', 'mcp.server_name-2'])('accepts safe npm identifier %s', (command) => {
    expect(configFor(entry({ command })).args).toEqual(['--yes', '--', command])
  })

  it.each(['', '-server', './server', '@scope/server', 'server@1.0', 'server==1.0', 'server[extra]', 'server --help', 'https://example.com', 'server;command', 'server/command', 'server\0'])('rejects ambiguous uvx identifier %j', (command) => {
    expect(prepareCatalogInstall(entry({ runtime: 'uvx', command }), {})).toEqual({ ok: false, error: { code: 'invalidPackage' } })
  })

  it.each(['mcp-server-git', 'example_server', 'example.server', 'ExampleServer'])('accepts a safe uvx identifier %s', (command) => {
    expect(configFor(entry({ runtime: 'uvx', command })).args).toEqual(['--no-python-downloads', command])
  })

  it.each(['', 'latest', '~1.2.3', '^1.2.3', '>=1.0', '1.*', '1.2.3 || 2.0.0', '1.2.3 --help', '1.2.3\0', '1.2.3${TOKEN}', 'file:1.2.3'])('rejects unsupported version %j', (version) => {
    for (const runtime of ['node', 'bun', 'uvx'] as const) {
      expect(prepareCatalogInstall(entry({ runtime, command: 'example-server', version }), {})).toEqual({ ok: false, error: { code: 'invalidVersion' } })
    }
  })

  it.each(['0.1.0', '1.2.3', '1.2.3-0', '1.2.3-beta.1', '1.2.3-01beta', '1.2.3+build.7', '1.2.3+build.01'])('keeps exact npm version %s', (version) => {
    for (const runtime of ['node', 'bun'] as const) {
      expect(configFor(entry({ runtime, version })).args).toContain(`@example/server@${version}`)
    }
  })

  it.each(['1', '1.2', '1.2.3', '2025.4.7', '1.2.3rc1', '1.2.post1', '1.2.dev1', '1.2+local.1'])('keeps exact uvx version %s', (version) => {
    expect(configFor(entry({ runtime: 'uvx', command: 'example-server', version })).args).toEqual(['--no-python-downloads', `example-server@${version}`])
  })

  it.each(['1', '1.2', '01.2.3', '1.2.3.4', '1.2.3-01', '1.2.3-beta.01'])('rejects non-exact npm version %s', (version) => {
    for (const runtime of ['node', 'bun'] as const) {
      expect(prepareCatalogInstall(entry({ runtime, version }), {})).toEqual({ ok: false, error: { code: 'invalidVersion' } })
    }
  })

  it.each(['\n', '\r', '\u2028', '\u2029'])('rejects trailing line terminator %j in metadata', (suffix) => {
    for (const runtime of ['node', 'bun', 'uvx'] as const) {
      expect(prepareCatalogInstall(entry({ runtime, command: `example-server${suffix}` }), {})).toEqual({ ok: false, error: { code: 'invalidPackage' } })
      expect(prepareCatalogInstall(entry({ runtime, command: 'example-server', version: `1.2.3${suffix}` }), {})).toEqual({ ok: false, error: { code: 'invalidVersion' } })
    }
    expect(prepareCatalogInstall(entry({ env: [{ name: `TOKEN${suffix}`, source: 'user' }] }), {})).toEqual({ ok: false, error: { code: 'invalidEnvironment' } })
  })

  it.each(['user', 'system'] as const)('requires explicit %s inputs', (source) => {
    const server = entry({ env: [{ name: 'TOKEN', source }] })
    const missingValues: Record<string, string>[] = [{}, { TOKEN: '' }, { TOKEN: ' \n\t ' }]
    for (const values of missingValues) {
      expect(prepareCatalogInstall(server, values)).toEqual({ ok: false, error: { code: 'missingEnvironment', name: 'TOKEN' } })
    }
    expect(configFor(server, { TOKEN: ' reviewed value ' }).env).toEqual({ TOKEN: ' reviewed value ' })
  })

  it('does not use inherited object properties as reviewed environment inputs', () => {
    const values = Object.create({ TOKEN: 'not explicitly supplied' }) as Record<string, string>
    expect(prepareCatalogInstall(entry({ env: [{ name: 'TOKEN', source: 'system' }] }), values)).toEqual({
      ok: false, error: { code: 'missingEnvironment', name: 'TOKEN' },
    })
  })

  it('omits blank optional inputs and ignores undeclared inputs', () => {
    const server = entry({ env: [{ name: 'OPTIONAL', source: 'optional' }] })
    const optionalValues: Record<string, string>[] = [{ EXTRA: 'ignored' }, { OPTIONAL: '', EXTRA: 'ignored' }, { OPTIONAL: '  ', EXTRA: 'ignored' }]
    for (const values of optionalValues) {
      expect(configFor(server, values).env).toEqual({})
    }
    expect(configFor(server, { OPTIONAL: ' provided ' }).env).toEqual({ OPTIONAL: ' provided ' })
  })

  it('requires an optional input when an argument references it', () => {
    expect(prepareCatalogInstall(entry({
      env: [{ name: 'OPTIONAL', source: 'optional' }], args: ['--value={env:OPTIONAL}'],
    }), {})).toEqual({ ok: false, error: { code: 'missingEnvironment', name: 'OPTIONAL' } })
  })

  it('preserves raw values and argument boundaries without shell parsing or recursive expansion', () => {
    const value = '  /文件/project with spaces; & | "quotes" \'single\' $(literal) $& $1 {env:OTHER}  '
    const server = entry({
      args: ['  static argument  ', '{env:VALUE}', '--value={env:VALUE}/{env:VALUE}', '{env:OTHER}'],
      env: [{ name: 'VALUE', source: 'user' }, { name: 'OTHER', source: 'optional' }],
    })
    const config = configFor(server, { VALUE: value, OTHER: 'second' })
    expect(config.args).toEqual(['--yes', '--', '@example/server', '  static argument  ', value, `--value=${value}/${value}`, 'second'])
    expect(config.env).toEqual({ VALUE: value, OTHER: 'second' })
  })

  it.each(['', ' ', '{env:VALUE', 'env:VALUE}', '{env:}', '{env:value}', '{env:VALUE NAME}', '{env:VALUE:-default}', '{{env:VALUE}}', '{other:VALUE}', '{}', '${VALUE}', '${VALUE:-default}', 'literal\0argument'])('rejects malformed argument %j', (argument) => {
    expect(prepareCatalogInstall(entry({ args: [argument], env: [{ name: 'VALUE', source: 'user' }] }), { VALUE: 'input' })).toEqual({
      ok: false, error: { code: 'invalidArguments' },
    })
  })

  it('rejects a well-formed reference to an undeclared variable', () => {
    expect(prepareCatalogInstall(entry({ args: ['prefix-{env:UNKNOWN}'] }), { UNKNOWN: 'not declared' })).toEqual({
      ok: false, error: { code: 'invalidArguments', name: 'UNKNOWN' },
    })
  })

  it.each(['', 'token', 'TOKEN NAME', 'TOKEN=synthetic-secret', '__proto__'])('rejects invalid environment declaration %j without echoing it', (name) => {
    expect(prepareCatalogInstall(entry({ env: [{ name, source: 'user' }] }), {})).toEqual({ ok: false, error: { code: 'invalidEnvironment' } })
  })

  it('rejects duplicate environment declarations', () => {
    expect(prepareCatalogInstall(entry({ env: [{ name: 'TOKEN', source: 'user' }, { name: 'TOKEN', source: 'optional' }] }), { TOKEN: 'synthetic-secret' })).toEqual({
      ok: false, error: { code: 'invalidEnvironment', name: 'TOKEN' },
    })
  })

  it.each(['synthetic\0secret', '${TOKEN}', 'prefix${TOKEN:-default}suffix', '\\${TOKEN}', '${unterminated'])('rejects unsafe values without returning submitted text', (value) => {
    for (const source of ['user', 'system', 'optional'] as const) {
      expect(prepareCatalogInstall(entry({ env: [{ name: 'TOKEN', source }] }), { TOKEN: value })).toEqual({
        ok: false, error: { code: 'unsafeValue', name: 'TOKEN' },
      })
    }
  })

  it('rejects native interpolation assembled across adjacent placeholders', () => {
    expect(prepareCatalogInstall(entry({
      args: ['{env:FIRST}{env:SECOND}'],
      env: [{ name: 'FIRST', source: 'user' }, { name: 'SECOND', source: 'user' }],
    }), { FIRST: '$', SECOND: '{HOST_SECRET}' })).toEqual({ ok: false, error: { code: 'unsafeValue' } })
  })

  it('rejects a malformed environment source without returning it', () => {
    expect(prepareCatalogInstall(entry({ env: [{ name: 'TOKEN', source: 'synthetic-secret' as 'user' }] }), {})).toEqual({
      ok: false, error: { code: 'invalidEnvironment', name: 'TOKEN' },
    })
  })

  it('rejects malformed API metadata instead of coercing it', () => {
    expect(prepareCatalogInstall(entry({ command: 123 as unknown as string }), {})).toEqual({ ok: false, error: { code: 'invalidPackage' } })
    expect(prepareCatalogInstall(entry({ version: 123 as unknown as string }), {})).toEqual({ ok: false, error: { code: 'invalidVersion' } })
    expect(prepareCatalogInstall(entry({ env: null as unknown as McpCatalogEntry['env'] }), {})).toEqual({ ok: false, error: { code: 'invalidEnvironment' } })
    expect(prepareCatalogInstall(entry({ args: null as unknown as string[] }), {})).toEqual({ ok: false, error: { code: 'invalidArguments' } })
    expect(prepareCatalogInstall(entry({ args: [123 as unknown as string] }), {})).toEqual({ ok: false, error: { code: 'invalidArguments' } })
    expect(prepareCatalogInstall(entry({ transport: 'http' as 'stdio' }), {})).toEqual({ ok: false, error: { code: 'invalidArguments' } })
    expect(prepareCatalogInstall(entry({ env: [{ name: 'TOKEN', source: 'user' }] }), { TOKEN: 123 as unknown as string })).toEqual({
      ok: false, error: { code: 'invalidEnvironment', name: 'TOKEN' },
    })
  })

  it('does not mutate the selected entry or reviewed inputs', () => {
    const server = entry({ args: ['{env:VALUE}'], env: [{ name: 'VALUE', source: 'user' }] })
    Object.freeze(server.env[0])
    Object.freeze(server.env)
    Object.freeze(server.args)
    Object.freeze(server)
    const values = Object.freeze({ VALUE: 'original' })
    const config = configFor(server, values)
    config.env.VALUE = 'changed result'
    config.args.push('new argument')
    expect(server.args).toEqual(['{env:VALUE}'])
    expect(values.VALUE).toBe('original')
  })
})
