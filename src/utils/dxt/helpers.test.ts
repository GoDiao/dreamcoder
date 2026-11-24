import { describe, expect, test } from 'bun:test'
import { validateManifest } from './helpers.js'

const manifest = {
  manifest_version: '0.2',
  name: 'example-server',
  version: '1.0.0',
  description: 'An example MCP bundle',
  author: { name: 'Example Author' },
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: { command: 'node', args: ['server/index.js'] },
  },
}

describe('validateManifest', () => {
  test('returns the manifest of a valid bundle', async () => {
    const result = await validateManifest(manifest)
    expect(result.name).toBe('example-server')
    expect(result.author.name).toBe('Example Author')
  })

  test('reports the invalid fields of a bundle manifest', async () => {
    const { name: _name, ...withoutName } = manifest
    await expect(validateManifest(withoutName)).rejects.toThrow(
      /^Invalid manifest: .*name: Required/,
    )
  })
})
