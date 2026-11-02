import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUNDLED_CATALOG_FILE } from '../../src/utils/bundledContent.js'
import type { DesignTemplateCatalog } from '../../src/utils/designTemplates.js'

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORT = '1280,800'
const LONGEST_SIDE = '640'

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`${command[0]} failed: ${result.stderr.toString().trim()}`)
}

async function main() {
  const root = join(import.meta.dir, '..', '..', 'desktop')
  const catalog = JSON.parse(await readFile(join(root, 'design-templates', BUNDLED_CATALOG_FILE), 'utf-8')) as DesignTemplateCatalog
  const outDir = join(root, 'public', 'design-templates')
  await mkdir(outDir, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'design-template-thumbs-'))
  try {
    for (const template of catalog.templates) {
      const png = join(work, `${template.id}.png`)
      const entry = pathToFileURL(join(root, 'design-templates', template.id, template.entry)).href
      run([
        CHROME,
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--user-data-dir=${join(work, 'profile')}`,
        `--window-size=${VIEWPORT}`,
        '--virtual-time-budget=3000',
        `--screenshot=${png}`,
        entry,
      ])
      run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', LONGEST_SIDE, png, '--out', join(outDir, `${template.id}.jpg`)])
      console.log(`Thumbnail for ${template.id}`)
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
