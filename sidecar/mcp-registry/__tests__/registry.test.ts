/**
 * MCP curated registry — schema and catalog validation tests.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  validateRegistry,
  validateEntry,
  registryEntrySchema,
  REGISTRY_VERSION,
} from '../schema.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = join(HERE, '..', '..', '..', 'mcp-registry.json')

/** A minimal entry that passes; tests mutate one field at a time. */
function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'example-server',
    name: 'Example',
    description: 'A server that does something useful and is described at length.',
    transport: 'stdio',
    command: 'mcp-server-example',
    args: [],
    env: [],
    homepage: 'https://github.com/modelcontextprotocol/servers',
    tags: ['utility'],
    runtime: 'uvx',
    version: '0.1.0',
    ...overrides,
  }
}

describe('validateEntry — valid entries', () => {
  it('accepts a well-formed entry', () => {
    const r = validateEntry(validEntry())
    expect(r.ok).toBe(true)
  })

  it('accepts an entry with no env and no args', () => {
    const r = validateEntry(validEntry({ env: [], args: [] }))
    expect(r.ok).toBe(true)
  })

  it('accepts an optional env var', () => {
    const r = validateEntry(
      validEntry({ env: [{ name: 'OPTIONAL_KEY', source: 'optional' }] }),
    )
    expect(r.ok).toBe(true)
  })
})

describe('validateEntry — invalid entries fail with actionable errors', () => {
  it('rejects a bad id', () => {
    const r = validateEntry(validEntry({ id: 'Bad_ID_With_Caps' }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0].message).toContain('lowercase-dash-separated')
      expect(r.errors[0].path).toContain('id')
    }
  })

  it('rejects an empty description', () => {
    const r = validateEntry(validEntry({ description: '' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].path).toContain('description')
  })

  it('rejects a non-stdio transport (v1 is stdio only)', () => {
    const r = validateEntry(validEntry({ transport: 'http' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].path).toContain('transport')
  })

  it('rejects an absolute command path', () => {
    const r = validateEntry(validEntry({ command: '/usr/local/bin/evil' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].message).toContain('absolute path')
  })

  it('rejects a Windows absolute command path', () => {
    const r = validateEntry(validEntry({ command: 'C:\\Windows\\System32\\evil.exe' }))
    expect(r.ok).toBe(false)
  })

  it('rejects shell metacharacters in the command', () => {
    const r = validateEntry(validEntry({ command: 'mcp-server; rm -rf /' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].message).toContain('shell metacharacters')
  })

  it('rejects a secret smuggled into args', () => {
    const r = validateEntry(
      validEntry({ args: ['--key=sk-abcdefghijklmnopqrstuvwxyz0123'] }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].message).toContain('secret')
  })

  it('rejects a GitHub token smuggled into args', () => {
    const r = validateEntry(
      validEntry({ args: ['--token=ghp_abcdefghijklmnopqrstuvwxyz012345'] }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects an env var carrying a value field', () => {
    const r = validateEntry(
      validEntry({
        env: [{ name: 'API_KEY', source: 'user', value: 'sk-real-secret-value' }],
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a non-lowercase env var name', () => {
    const r = validateEntry(validEntry({ env: [{ name: 'lowercase_key', source: 'user' }] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].message).toContain('SCREAMING_SNAKE_CASE')
  })

  it('rejects a malformed homepage URL', () => {
    const r = validateEntry(validEntry({ homepage: 'not-a-url' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].path).toContain('homepage')
  })

  it('rejects empty tags', () => {
    const r = validateEntry(validEntry({ tags: [] }))
    expect(r.ok).toBe(false)
  })

  it('rejects a binary runtime with no version pin', () => {
    const r = validateEntry(validEntry({ runtime: 'binary', version: undefined }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].message).toContain('version pin')
  })

  it('accepts a binary runtime WITH a version pin', () => {
    const r = validateEntry(
      validEntry({ runtime: 'binary', version: '2.31.0', command: 'my-mcp' }),
    )
    expect(r.ok).toBe(true)
  })

  it('rejects an unknown field', () => {
    const r = validateEntry(validEntry({ sneaky: 'extra' }))
    expect(r.ok).toBe(false)
  })
})

describe('validateRegistry', () => {
  it('rejects a wrong version number', () => {
    const r = validateRegistry({ version: 99, servers: [validEntry()] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].path).toContain('version')
  })

  it('rejects an empty server list', () => {
    const r = validateRegistry({ version: REGISTRY_VERSION, servers: [] })
    expect(r.ok).toBe(false)
  })

  it('rejects duplicate ids', () => {
    const r = validateRegistry({
      version: REGISTRY_VERSION,
      servers: [validEntry(), validEntry({ name: 'Copy' })],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].message).toContain('duplicate')
  })

  it('collects errors from multiple bad entries rather than stopping at the first', () => {
    const r = validateRegistry({
      version: REGISTRY_VERSION,
      servers: [
        validEntry({ id: 'Bad_Id' }),
        validEntry({ id: 'second-bad', homepage: 'nope' }),
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe('shipped catalog', () => {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'))

  it('validates against the schema', () => {
    const r = validateRegistry(catalog)
    if (!r.ok) {
      // Surface the actual failures in the assertion message.
      throw new Error(
        `catalog is invalid:\n${r.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
      )
    }
    expect(r.ok).toBe(true)
  })

  it('declares the current registry version', () => {
    expect(catalog.version).toBe(REGISTRY_VERSION)
  })

  it('seeds between 6 and 10 servers', () => {
    expect(catalog.servers.length).toBeGreaterThanOrEqual(6)
    expect(catalog.servers.length).toBeLessThanOrEqual(10)
  })

  it('has unique ids', () => {
    const ids = catalog.servers.map((s: { id: string }) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses stdio for every entry (v1 scope)', () => {
    for (const s of catalog.servers) {
      expect(s.transport).toBe('stdio')
    }
  })

  it('pins a version for every uvx entry', () => {
    for (const s of catalog.servers) {
      if (s.runtime === 'uvx') expect(s.version).toBeTruthy()
    }
  })

  it('never stores a secret value in the catalog', () => {
    const raw = readFileSync(CATALOG_PATH, 'utf-8')
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
    expect(raw).not.toMatch(/ghp_[A-Za-z0-9]{20,}/)
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/)
  })

  it('every entry passes standalone entry validation', () => {
    for (const s of catalog.servers) {
      const r = validateEntry(s)
      if (!r.ok) {
        throw new Error(
          `entry ${s.id} invalid:\n${r.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
        )
      }
    }
  })
})

describe('schema export sanity', () => {
  it('registryEntrySchema is a zod schema', () => {
    expect(typeof registryEntrySchema.safeParse).toBe('function')
  })
})