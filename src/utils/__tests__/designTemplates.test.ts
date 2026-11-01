import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createArtifactFromTemplate,
  readDesignTemplateCatalog,
  renderDesignTemplateIndex,
  resolveDesignTemplatesDir,
} from '../designTemplates.js'
import { templateRecord, writeTemplates } from './designTemplateFixtures.js'
import { parseArtifactManifest } from '../artifacts.js'
import { bundledDirCandidates } from '../bundledContent.js'
import { systemRecord, writeSystems } from './designSystemFixtures.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-templates-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('resolveDesignTemplatesDir', () => {
  it('finds the folder next to the bundled binaries of a packaged app', async () => {
    const appRoot = path.join(root, 'Resources', 'bin')
    await fs.mkdir(appRoot, { recursive: true })
    await writeTemplates(path.join(root, 'Resources', 'design-templates'), [templateRecord('a')])
    expect(await resolveDesignTemplatesDir(bundledDirCandidates('design-templates', appRoot, root))).toBe(path.join(root, 'Resources', 'design-templates'))
  })

  it('finds the source folder from the development binaries folder', async () => {
    const appRoot = path.join(root, 'desktop', 'binaries', 'aarch64-apple-darwin')
    await fs.mkdir(appRoot, { recursive: true })
    await writeTemplates(path.join(root, 'desktop', 'design-templates'), [templateRecord('a')])
    expect(await resolveDesignTemplatesDir(bundledDirCandidates('design-templates', appRoot, '/nowhere'))).toBe(path.join(root, 'desktop', 'design-templates'))
  })

  it('falls back to the working directory when there is no app root', async () => {
    await writeTemplates(path.join(root, 'desktop', 'design-templates'), [templateRecord('a')])
    expect(await resolveDesignTemplatesDir(bundledDirCandidates('design-templates', undefined, root))).toBe(path.join(root, 'desktop', 'design-templates'))
  })

  it('fails when no candidate holds a catalog', async () => {
    await expect(resolveDesignTemplatesDir(bundledDirCandidates('design-templates', path.join(root, 'bin'), root))).rejects.toThrow('catalog was not found')
  })
})

describe('readDesignTemplateCatalog', () => {
  it('rejects a catalog with the wrong shape', async () => {
    await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify({ version: 2, templates: [] }))
    await expect(readDesignTemplateCatalog(root)).rejects.toThrow('not valid')
  })
})

describe('createArtifactFromTemplate', () => {
  const templates = () => path.join(root, 'templates')
  const artifacts = () => path.join(root, 'work', 'dc_artifacts')

  it('copies the template folder and writes a manifest that scans as valid', async () => {
    await writeTemplates(templates(), [templateRecord('saas')], { saas: { 'index.html': '<h1>x</h1>', 'LICENSE': 'MIT' } })
    const created = await createArtifactFromTemplate({ templateId: 'saas', artifactsDir: artifacts(), templatesDir: templates() })
    expect(created.name).toBe('saas')
    expect(await fs.readFile(path.join(created.dir, 'index.html'), 'utf-8')).toBe('<h1>x</h1>')
    expect(await fs.readFile(path.join(created.dir, 'LICENSE'), 'utf-8')).toBe('MIT')
    const parsed = parseArtifactManifest(await fs.readFile(path.join(created.dir, 'artifact.json'), 'utf-8'))
    expect(parsed.error).toBeNull()
    expect(parsed.manifest).toMatchObject({
      version: 1,
      kind: 'page',
      title: 'Title of saas',
      entry: 'index.html',
      template: { id: 'saas', commit: 'abc123' },
    })
    expect(parsed.manifest?.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('uses the given name and title, and adds a suffix when the name is taken', async () => {
    await writeTemplates(templates(), [templateRecord('saas')])
    const first = await createArtifactFromTemplate({ templateId: 'saas', artifactsDir: artifacts(), templatesDir: templates(), name: 'report', title: '  My report ' })
    const second = await createArtifactFromTemplate({ templateId: 'saas', artifactsDir: artifacts(), templatesDir: templates(), name: 'report' })
    expect(first.name).toBe('report')
    expect(first.manifest.title).toBe('My report')
    expect(second.name).toBe('report-2')
    expect(second.manifest.id).not.toBe(first.manifest.id)
  })

  it('refuses an unknown template, a reserved name and a path as the name without creating anything', async () => {
    await writeTemplates(templates(), [templateRecord('saas')])
    await expect(createArtifactFromTemplate({ templateId: 'nope', artifactsDir: artifacts(), templatesDir: templates() })).rejects.toThrow('Unknown design template')
    await expect(createArtifactFromTemplate({ templateId: 'saas', artifactsDir: artifacts(), templatesDir: templates(), name: 'systems' })).rejects.toThrow('not an artifact name')
    await expect(createArtifactFromTemplate({ templateId: 'saas', artifactsDir: artifacts(), templatesDir: templates(), name: '../x' })).rejects.toThrow('not an artifact name')
    expect(await fs.readdir(artifacts()).catch(() => [])).toEqual([])
  })

  it('leaves no half-made folder when the entry file is missing', async () => {
    await writeTemplates(templates(), [templateRecord('broken')], { broken: { 'other.html': 'x' } })
    await expect(createArtifactFromTemplate({ templateId: 'broken', artifactsDir: artifacts(), templatesDir: templates() })).rejects.toThrow('entry file')
    expect(await fs.readdir(artifacts())).toEqual([])
  })

  it('fails without a folder when the template files are missing', async () => {
    await writeTemplates(templates(), [templateRecord('gone')])
    await fs.rm(path.join(templates(), 'gone'), { recursive: true })
    await expect(createArtifactFromTemplate({ templateId: 'gone', artifactsDir: artifacts(), templatesDir: templates() })).rejects.toThrow('were not found')
    expect(await fs.readdir(artifacts()).catch(() => [])).toEqual([])
  })
})

describe('createArtifactFromTemplate with a design system', () => {
  const templates = () => path.join(root, 'templates')
  const systems = () => path.join(root, 'systems')
  const artifacts = () => path.join(root, 'work', 'dc_artifacts')
  const create = (templateId: string, designSystemId?: string) =>
    createArtifactFromTemplate({ templateId, artifactsDir: artifacts(), templatesDir: templates(), designSystemId, systemsDir: systems() })

  it('installs the system next to the artifact and points the manifest at it', async () => {
    await writeTemplates(templates(), [templateRecord('saas')])
    await writeSystems(systems(), [systemRecord('alpha')])
    const created = await create('saas', 'alpha')
    expect(created.manifest.designSystem).toBe('systems/alpha')
    expect(created.designSystem?.dir).toBe(path.join(artifacts(), 'systems', 'alpha'))
    expect(await fs.readFile(path.join(artifacts(), 'systems', 'alpha', 'tokens.css'), 'utf-8')).toContain('--bg')
    const parsed = parseArtifactManifest(await fs.readFile(path.join(created.dir, 'artifact.json'), 'utf-8'))
    expect(parsed.manifest?.designSystem).toBe('systems/alpha')
  })

  it('writes no designSystem when none is chosen', async () => {
    await writeTemplates(templates(), [templateRecord('saas')])
    const created = await create('saas')
    expect(created.manifest.designSystem).toBeUndefined()
    expect(created.designSystem).toBeNull()
  })

  it('refuses a template that does not take a design system and creates nothing', async () => {
    await writeTemplates(templates(), [templateRecord('fixed', { acceptsDesignSystem: false })])
    await writeSystems(systems(), [systemRecord('alpha')])
    await expect(create('fixed', 'alpha')).rejects.toThrow('does not take a design system')
    expect(await fs.readdir(artifacts()).catch(() => [])).toEqual([])
  })

  it('refuses an unknown system and creates no artifact', async () => {
    await writeTemplates(templates(), [templateRecord('saas')])
    await writeSystems(systems(), [systemRecord('alpha')])
    await expect(create('saas', 'nope')).rejects.toThrow('Unknown design system')
    expect(await fs.readdir(artifacts())).toEqual([])
  })

  it('removes the system it just installed when the artifact fails', async () => {
    await writeTemplates(templates(), [templateRecord('broken')], { broken: { 'other.html': 'x' } })
    await writeSystems(systems(), [systemRecord('alpha')])
    await expect(create('broken', 'alpha')).rejects.toThrow('entry file')
    expect(await fs.readdir(artifacts())).toEqual(['systems'])
    expect(await fs.readdir(path.join(artifacts(), 'systems'))).toEqual([])
  })

  it('keeps a system that was already in the project when the artifact fails', async () => {
    await writeTemplates(templates(), [templateRecord('saas'), templateRecord('broken')], { broken: { 'other.html': 'x' } })
    await writeSystems(systems(), [systemRecord('alpha')])
    await create('saas', 'alpha')
    await expect(create('broken', 'alpha')).rejects.toThrow('entry file')
    expect(await fs.readdir(path.join(artifacts(), 'systems'))).toEqual(['alpha'])
  })
})

describe('the bundled catalog', () => {
  const desktop = path.resolve(import.meta.dir, '..', '..', '..', 'desktop')

  it('gives every template a style and keeps the index handed to /design within its budget', async () => {
    const catalog = await readDesignTemplateCatalog(path.join(desktop, 'design-templates'))
    expect(catalog.templates.every(template => template.style.en !== '' && template.style.zh !== '')).toBe(true)
    expect(renderDesignTemplateIndex(catalog.templates).length).toBeLessThan(50000)
  })

  it('has files, an entry, a thumbnail and the declared license for every template', async () => {
    const dir = path.join(desktop, 'design-templates')
    const catalog = await readDesignTemplateCatalog(dir)
    expect(catalog.templates.length).toBeGreaterThanOrEqual(8)
    const categories = new Set(catalog.templates.map(template => template.category))
    expect([...categories].sort()).toEqual(['prototype', 'web'])
    expect(catalog.templates.some(template => 'kind' in template)).toBe(false)
    for (const template of catalog.templates) {
      await fs.stat(path.join(dir, template.id, template.entry))
      await fs.stat(path.join(desktop, 'public', 'design-templates', `${template.id}.jpg`))
      if (template.license.file) await fs.stat(path.join(dir, template.id, template.license.file))
      expect(template.title.en && template.title.zh && template.description.zh && template.prompt.en && template.prompt.zh).toBeTruthy()
    }
    await fs.stat(path.join(dir, 'LICENSE-open-design.txt'))
  })

  it('resolves from the development app root the sidecar is started with', async () => {
    const appRoot = path.join(desktop, 'binaries', 'aarch64-apple-darwin')
    expect(await resolveDesignTemplatesDir(bundledDirCandidates('design-templates', appRoot, '/nowhere'))).toBe(path.join(desktop, 'design-templates'))
  })
})
