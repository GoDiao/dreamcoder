import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DesignSystemRecord } from '../designSystems.js'

export function systemRecord(id: string, overrides: Partial<DesignSystemRecord> = {}): DesignSystemRecord {
  return {
    id,
    name: { en: `Name of ${id}`, zh: `${id} 名称` },
    category: 'Modern & Minimal',
    description: { en: `Description of ${id}.`, zh: `${id} 描述` },
    origin: 'converted',
    swatches: ['#ffffff', '#f5f5f5', '#111111', '#ff5701'],
    license: { id: 'Apache-2.0', file: null, copyright: 'Copyright 2026 Open Design contributors' },
    author: 'Open Design contributors',
    upstream: { repo: 'https://example.com/repo', commit: 'abc123', path: `design-systems/${id}` },
    ...overrides,
  }
}

export async function writeSystems(dir: string, records: DesignSystemRecord[], files: Record<string, Record<string, string>> = {}) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'catalog.json'), JSON.stringify({ version: 1, systems: records }))
  for (const record of records) {
    const folder = path.join(dir, record.id)
    await fs.mkdir(folder, { recursive: true })
    for (const [file, content] of Object.entries(files[record.id] ?? { 'DESIGN.md': `# ${record.id}`, 'tokens.css': ':root { --bg: #fff; }' })) {
      await fs.writeFile(path.join(folder, file), content)
    }
  }
}
