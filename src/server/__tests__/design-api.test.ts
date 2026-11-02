import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { systemRecord, writeSystems } from '../../utils/__tests__/designSystemFixtures.js'
import { templateRecord, writeTemplates } from '../../utils/__tests__/designTemplateFixtures.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { handleDesignApi } from '../api/design.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
const appRootAtLoad = process.env.CLAUDE_APP_ROOT

let root: string
let project: string

async function call(method: string, pathname: string, body?: unknown) {
  const url = new URL(`http://x${pathname}`)
  const request = new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const response = await handleDesignApi(request, url, url.pathname.split('/').filter(Boolean))
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-api-'))
  const configDir = path.join(root, 'config')
  await fs.mkdir(path.join(configDir, 'projects'), { recursive: true })
  process.env.DREAMCODER_CONFIG_DIR = configDir

  const resources = path.join(root, 'Resources')
  await fs.mkdir(path.join(resources, 'bin'), { recursive: true })
  process.env.CLAUDE_APP_ROOT = path.join(resources, 'bin')
  await writeTemplates(path.join(resources, 'design-templates'), [templateRecord('saas'), templateRecord('app-a', { category: 'prototype' }), templateRecord('fixed', { acceptsDesignSystem: false })])
  await writeSystems(path.join(resources, 'design-systems'), [systemRecord('alpha'), systemRecord('own', { origin: 'starter', upstream: null })])

  project = path.join(root, 'repo')
  await fs.mkdir(project, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  project = await fs.realpath(project)
  const sessionDir = path.join(configDir, 'projects', sanitizePath(project))
  await fs.mkdir(sessionDir, { recursive: true })
  const entries = [
    { type: 'session-meta', workDir: project, timestamp: new Date().toISOString() },
    { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: new Date().toISOString() },
  ]
  await fs.writeFile(path.join(sessionDir, 'session-1.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
})

afterEach(async () => {
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  if (appRootAtLoad === undefined) delete process.env.CLAUDE_APP_ROOT
  else process.env.CLAUDE_APP_ROOT = appRootAtLoad
  await fs.rm(root, { recursive: true, force: true })
})

describe('GET /api/design/templates', () => {
  it('returns the catalog bundled next to the app binaries', async () => {
    const { status, body } = await call('GET', '/api/design/templates')
    expect(status).toBe(200)
    expect(body.version).toBe(1)
    expect(body.templates.map((template: { id: string }) => template.id)).toEqual(['saas', 'app-a', 'fixed'])
  })

  it('answers 404 when the app has no catalog', async () => {
    process.env.CLAUDE_APP_ROOT = path.join(root, 'elsewhere', 'bin')
    const originalCwd = process.cwd()
    process.chdir(root)
    try {
      expect((await call('GET', '/api/design/templates')).status).toBe(404)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('refuses writes', async () => {
    expect((await call('POST', '/api/design/templates', {})).status).toBe(405)
  })
})

describe('GET /api/design/templates/:id/preview', () => {
  it('returns the template folder inside the app resources and its entry file', async () => {
    const { status, body } = await call('GET', '/api/design/templates/saas/preview')
    expect(status).toBe(200)
    expect(body.rootDir).toBe(path.join(root, 'Resources', 'design-templates', 'saas'))
    expect(body.filePath).toBe(path.join(body.rootDir, 'index.html'))
  })

  it('answers 404 for an unknown template and for an id that tries to leave the catalog', async () => {
    expect((await call('GET', '/api/design/templates/nope/preview')).status).toBe(404)
    expect((await call('GET', '/api/design/templates/..%2F..%2Fx/preview')).status).toBe(404)
  })
})

describe('POST /api/design/artifacts', () => {
  it('copies the template into the project, writes the manifest and registers the folder', async () => {
    const { status, body } = await call('POST', '/api/design/artifacts', { project, templateId: 'saas', name: 'landing', title: 'Landing' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: 'landing', dir: path.join(project, 'dc_artifacts', 'landing'), filePath: path.join(project, 'dc_artifacts', 'landing', 'index.html') })
    const manifest = JSON.parse(await fs.readFile(path.join(body.dir, 'artifact.json'), 'utf-8'))
    expect(manifest).toMatchObject({ id: body.id, kind: 'page', title: 'Landing', template: { id: 'saas', commit: 'abc123' } })
    expect(await fs.readFile(body.filePath, 'utf-8')).toBe('<h1>saas</h1>')
    const exclude = await fs.readFile(path.join(project, '.git', 'info', 'exclude'), 'utf-8')
    expect(exclude).toContain('dc_artifacts')
  })

  it('refuses a folder that no session knows', async () => {
    const stranger = path.join(root, 'stranger')
    await fs.mkdir(stranger)
    const { status } = await call('POST', '/api/design/artifacts', { project: stranger, templateId: 'saas' })
    expect(status).toBe(400)
    expect(await fs.readdir(stranger)).toEqual([])
  })

  it('refuses an unknown template and leaves the project untouched', async () => {
    const { status, body } = await call('POST', '/api/design/artifacts', { project, templateId: 'nope' })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('Unknown design template')
    expect(await fs.readdir(project)).not.toContain('dc_artifacts')
  })

  it('requires the project and the template id', async () => {
    expect((await call('POST', '/api/design/artifacts', { templateId: 'saas' })).status).toBe(400)
    expect((await call('POST', '/api/design/artifacts', { project })).status).toBe(400)
  })

  it('refuses reads', async () => {
    expect((await call('GET', '/api/design/artifacts')).status).toBe(405)
  })
})

describe('GET /api/design/systems/catalog', () => {
  it('returns the library bundled next to the app binaries', async () => {
    const { status, body } = await call('GET', '/api/design/systems/catalog')
    expect(status).toBe(200)
    expect(body.version).toBe(1)
    expect(body.systems.map((system: { id: string }) => system.id)).toEqual(['alpha', 'own'])
    expect(body.systems[0].swatches).toHaveLength(4)
  })

  it('answers 404 when the app has no library', async () => {
    process.env.CLAUDE_APP_ROOT = path.join(root, 'elsewhere', 'bin')
    const originalCwd = process.cwd()
    process.chdir(root)
    try {
      expect((await call('GET', '/api/design/systems/catalog')).status).toBe(404)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('refuses writes', async () => {
    expect((await call('POST', '/api/design/systems/catalog', {})).status).toBe(405)
  })
})

describe('POST /api/design/artifacts with a design system', () => {
  it('copies the system into the project and points the manifest at it', async () => {
    const { status, body } = await call('POST', '/api/design/artifacts', { project, templateId: 'saas', designSystemId: 'alpha' })
    expect(status).toBe(200)
    expect(body.designSystem).toBe('alpha')
    const manifest = JSON.parse(await fs.readFile(path.join(body.dir, 'artifact.json'), 'utf-8'))
    expect(manifest.designSystem).toBe('systems/alpha')
    const system = JSON.parse(await fs.readFile(path.join(project, 'dc_artifacts', 'systems', 'alpha', 'system.json'), 'utf-8'))
    expect(system).toMatchObject({ source: 'bundled', libraryId: 'alpha', name: 'Name of alpha' })
  })

  it('answers null for the design system when none is chosen', async () => {
    const { body } = await call('POST', '/api/design/artifacts', { project, templateId: 'saas' })
    expect(body.designSystem).toBeNull()
    expect(await fs.readdir(path.join(project, 'dc_artifacts'))).toEqual(['saas'])
  })

  it('refuses a template with its own look and creates nothing', async () => {
    const { status, body } = await call('POST', '/api/design/artifacts', { project, templateId: 'fixed', designSystemId: 'alpha' })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('does not take a design system')
    expect(await fs.readdir(project)).not.toContain('dc_artifacts')
  })

  it('refuses an unknown system and creates nothing', async () => {
    const { status } = await call('POST', '/api/design/artifacts', { project, templateId: 'saas', designSystemId: 'nope' })
    expect(status).toBe(400)
    expect(await fs.readdir(path.join(project, 'dc_artifacts'))).toEqual([])
  })
})
