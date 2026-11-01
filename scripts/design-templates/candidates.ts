import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { localReferences } from '../../src/utils/artifactCheck.js'
import { fileExists } from '../../src/utils/bundledContent.js'
import { parseFrontmatter, SOURCE_DIRS, type SourceDir } from './convert.js'

const PAGE_MODES = new Set(['prototype', 'template'])
const SKILL_FILE = 'SKILL.md'
const EXAMPLE_FILE = 'example.html'

export type Candidate = {
  id: string
  sourceDir: SourceDir
  mode: string
  platform: string | null
  scenario: string | null
  bytes: number
  relativeReferences: string[]
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export async function findCandidates(checkout: string): Promise<Candidate[]> {
  const root = resolve(checkout)
  const candidates: Candidate[] = []
  for (const sourceDir of SOURCE_DIRS) {
    const entries = await readdir(join(root, sourceDir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const folder = join(root, sourceDir, entry.name)
      if (!(await fileExists(join(folder, SKILL_FILE))) || !(await fileExists(join(folder, EXAMPLE_FILE)))) continue
      const metadata = parseFrontmatter(await readFile(join(folder, SKILL_FILE), 'utf-8'))
      const od = typeof metadata.od === 'object' && metadata.od !== null ? (metadata.od as Record<string, unknown>) : {}
      const mode = text(od.mode)
      if (!mode || !PAGE_MODES.has(mode)) continue
      const html = await readFile(join(folder, EXAMPLE_FILE), 'utf-8')
      candidates.push({
        id: entry.name,
        sourceDir,
        mode,
        platform: text(od.platform),
        scenario: text(od.scenario),
        bytes: Buffer.byteLength(html),
        relativeReferences: localReferences(html),
      })
    }
  }
  return candidates
}

async function main() {
  const [checkout, output] = process.argv.slice(2)
  if (!checkout) throw new Error('Usage: bun run scripts/design-templates/candidates.ts <open-design checkout> [output.json]')
  const json = `${JSON.stringify(await findCandidates(checkout), null, 2)}\n`
  if (output) await Bun.write(output, json)
  else process.stdout.write(json)
}

if (import.meta.main) await main()
