import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DesignTemplateRecord } from '../designTemplates.js'

export function templateRecord(id: string, overrides: Partial<DesignTemplateRecord> = {}): DesignTemplateRecord {
  return {
    id,
    category: 'web',
    platform: 'desktop',
    scenario: 'marketing',
    entry: 'index.html',
    acceptsDesignSystem: true,
    params: [],
    prompt: { en: 'keep', zh: '保留' },
    title: { en: `Title of ${id}`, zh: `${id} 标题` },
    description: { en: 'd', zh: '描述' },
    tags: [],
    style: { en: '', zh: '' },
    license: { id: 'Apache-2.0', file: null, copyright: 'Copyright 2026 Open Design contributors' },
    author: 'Open Design contributors',
    source: { repo: 'https://example.com/repo', commit: 'abc123', path: `design-templates/${id}` },
    ...overrides,
  }
}

export async function writeTemplates(dir: string, records: DesignTemplateRecord[], files: Record<string, Record<string, string>> = {}) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'catalog.json'), JSON.stringify({ version: 1, templates: records }))
  for (const record of records) {
    const folder = path.join(dir, record.id)
    await fs.mkdir(folder, { recursive: true })
    for (const [file, content] of Object.entries(files[record.id] ?? { [record.entry]: `<h1>${record.id}</h1>` })) {
      await fs.writeFile(path.join(folder, file), content)
    }
  }
}
