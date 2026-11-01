import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { bundledDirCandidates } from '../bundledContent.js'
import { renderWebCloneSection, resolveWebCloneDir, webCloneRunner } from '../webClone.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-clone-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function writeScripts(dir: string) {
  await fs.mkdir(path.join(dir, 'scripts'), { recursive: true })
  await fs.writeFile(path.join(dir, 'scripts', 'recon-site.mjs'), '')
}

describe('resolveWebCloneDir', () => {
  it('finds the folder next to the bundled binaries of a packaged app', async () => {
    const appRoot = path.join(root, 'Resources', 'bin')
    await fs.mkdir(appRoot, { recursive: true })
    await writeScripts(path.join(root, 'Resources', 'web-clone'))
    expect(await resolveWebCloneDir(bundledDirCandidates('web-clone', appRoot, '/nowhere'))).toBe(path.join(root, 'Resources', 'web-clone'))
  })

  it('finds the source folder from the development binaries folder', async () => {
    const appRoot = path.join(root, 'desktop', 'binaries', 'aarch64-apple-darwin')
    await fs.mkdir(appRoot, { recursive: true })
    await writeScripts(path.join(root, 'desktop', 'web-clone'))
    expect(await resolveWebCloneDir(bundledDirCandidates('web-clone', appRoot, '/nowhere'))).toBe(path.join(root, 'desktop', 'web-clone'))
  })

  it('fails with the name of what is missing', async () => {
    await expect(resolveWebCloneDir(bundledDirCandidates('web-clone', undefined, root))).rejects.toThrow('website clone scripts catalog was not found')
  })

  it('finds the bundled scripts of this repository from the development app root', async () => {
    const desktop = path.resolve(import.meta.dir, '..', '..', '..', 'desktop')
    const found = await resolveWebCloneDir(bundledDirCandidates('web-clone', path.join(desktop, 'binaries', 'aarch64-apple-darwin'), '/nowhere'))
    expect(found).toBe(path.join(desktop, 'web-clone'))
  })
})

describe('the prompt section', () => {
  it('names the scripts directory and the command that runs a script with the CLI executable', () => {
    const section = renderWebCloneSection('/app/Resources/web-clone', '/app/Resources/bin/dreamcoder-sidecar')
    expect(section).toContain('Scripts directory: /app/Resources/web-clone/scripts')
    expect(section).toContain('BUN_BE_BUN=1 "/app/Resources/bin/dreamcoder-sidecar" "/app/Resources/web-clone/scripts/<script>.mjs" <arguments>')
    expect(section).toContain('only when the user explicitly asks to clone')
    expect(section).toContain('$env:BUN_BE_BUN')
  })

  it('quotes the script path and turns Windows separators into slashes', () => {
    const section = renderWebCloneSection('C:\\Program Files\\App\\web-clone', 'C:\\Program Files\\App\\sidecar.exe')
    expect(section).toContain('Scripts directory: C:/Program Files/App/web-clone/scripts')
    expect(section).toContain('"C:/Program Files/App/web-clone/scripts/<script>.mjs" <arguments>')
    expect(section).toContain('& "<the same executable>" "<script>" <arguments>')
  })

  it('quotes an executable path that has spaces', () => {
    expect(webCloneRunner('/Applications/My App/bin/sidecar')).toBe('BUN_BE_BUN=1 "/Applications/My App/bin/sidecar"')
  })

  it('says cloning is not available when the scripts were not found', () => {
    const section = renderWebCloneSection(null)
    expect(section).toContain('not available in this build')
    expect(section).not.toContain('Scripts directory')
  })
})

describe('the bundled scripts', () => {
  const dir = path.resolve(import.meta.dir, '..', '..', '..', 'desktop', 'web-clone')
  const scripts = path.join(dir, 'scripts')

  it('are the upstream scripts with their MIT license', async () => {
    const names = (await fs.readdir(scripts)).filter(name => name.endsWith('.mjs')).sort()
    expect(names).toEqual([
      'asset-harvest.mjs',
      'audit-clone.mjs',
      'compare-recon.mjs',
      'init-clone.mjs',
      'interaction-probe.mjs',
      'mirror-site.mjs',
      'network-capture.mjs',
      'od-preview-rewrite.mjs',
      'recon-site.mjs',
      'route-crawl.mjs',
      'sourcemap-hunt.mjs',
      'visual-diff.mjs',
    ])
    expect(await fs.readFile(path.join(dir, 'LICENSE'), 'utf-8')).toContain('MIT License')
  })

  it('reach a browser only through the app: no launching of a system browser and no search for one', async () => {
    const adapter = await fs.readFile(path.join(scripts, 'lib', 'system-browser.mjs'), 'utf-8')
    const loader = await fs.readFile(path.join(scripts, 'lib', 'playwright-loader.mjs'), 'utf-8')
    for (const text of [adapter, loader]) {
      expect(text).not.toContain('spawn')
      expect(text).not.toContain('child_process')
      expect(text).not.toContain('executablePath')
      expect(text).not.toContain('Google Chrome')
      expect(text).not.toContain('OD_BROWSER_EXECUTABLE_PATH')
      expect(text).not.toContain('OD_DAEMON_URL')
      expect(text).not.toContain('playwright"')
    }
    expect(loader).toContain('DREAMCODER_WEB_CLONE_URL')
    expect(loader).toContain('DREAMCODER_WEB_CLONE_TOKEN')
    expect(adapter).toContain('authorization')
  })
})
