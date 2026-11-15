import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ARTIFACT_SHELL_DIRNAME } from '../../src/utils/artifactShell.js'
import { BUNDLED_CATALOG_FILE } from '../../src/utils/bundledContent.js'
import type { DesignTemplateCatalog, DesignTemplateRecord } from '../../src/utils/designTemplates.js'
import { launchChrome, type HeadlessChrome } from '../lib/headlessChrome.js'
import { openDeck, serveDeck, shootSlide } from './slides.js'

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = '1280,800'
const LONGEST_SIDE = '640'

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`${command[0]} failed: ${result.stderr.toString().trim()}`)
}

function shootPage(entry: string, png: string, profile: string) {
  run([
    CHROME,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT}`,
    '--virtual-time-budget=3000',
    `--screenshot=${png}`,
    entry,
  ])
}

async function shootDeck(chrome: HeadlessChrome, folder: string, shellDir: string, png: string) {
  const server = serveDeck(folder, shellDir)
  try {
    const page = await chrome.newPage()
    const [first] = await openDeck(page, server.url)
    if (!first) throw new Error(`${folder} has no slides`)
    await writeFile(png, await shootSlide(page, first))
  } finally {
    server.stop()
  }
}

async function main() {
  const categories = process.argv.slice(2)
  const root = join(import.meta.dir, '..', '..', 'desktop')
  const templatesDir = join(root, 'design-templates')
  const shellDir = join(root, 'public', ARTIFACT_SHELL_DIRNAME)
  const catalog = JSON.parse(await readFile(join(templatesDir, BUNDLED_CATALOG_FILE), 'utf-8')) as DesignTemplateCatalog
  const wanted = catalog.templates.filter((template: DesignTemplateRecord) => categories.length === 0 || categories.includes(template.category))
  const outDir = join(root, 'public', 'design-templates')
  await mkdir(outDir, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'design-template-thumbs-'))
  const chrome = wanted.some(template => template.category === 'slides') ? await launchChrome() : null
  try {
    for (const template of wanted) {
      const png = join(work, `${template.id}.png`)
      const folder = join(templatesDir, template.id)
      if (template.category === 'slides') await shootDeck(chrome!, folder, shellDir, png)
      else shootPage(pathToFileURL(join(folder, template.entry)).href, png, join(work, 'profile'))
      run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', LONGEST_SIDE, png, '--out', join(outDir, `${template.id}.jpg`)])
      console.log(`Thumbnail for ${template.id}`)
    }
  } finally {
    await chrome?.close()
    await rm(work, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
