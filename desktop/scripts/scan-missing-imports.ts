import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '../..')
const srcRoot = path.join(repoRoot, 'src')
const adaptersRoot = path.join(repoRoot, 'adapters')

const ALLOWED_STUB_ROOTS = [srcRoot, adaptersRoot]

const STUB_MARKER_TS = '// @generated stub from scan-missing-imports'
const STUB_MARKER_TEXT = '<!-- @generated stub from scan-missing-imports -->'

const TS_STUB_CONTENT = `${STUB_MARKER_TS}
const __target = function noop() {}
const __handler: ProxyHandler<any> = {
  get(_t, prop) {
    if (prop === '__esModule') return true
    if (prop === 'default') return new Proxy(__target, __handler)
    if (prop === Symbol.toPrimitive) return () => undefined
    if (prop === Symbol.iterator) return function* () {}
    if (prop === Symbol.asyncIterator) return async function* () {}
    if (prop === 'then') return undefined
    return new Proxy(__target, __handler)
  },
  apply() {
    return new Proxy(__target, __handler)
  },
  construct() {
    return new Proxy(__target, __handler)
  },
}
const stub: any = new Proxy(__target, __handler)
export default stub
export const __stubMissing = true
export const createCachedMCState = stub
export const isCachedMicrocompactEnabled = stub
export const isModelSupportedForCacheEditing = stub
export const getCachedMCConfig = stub
export const markToolsSentToAPI = stub
export const resetCachedMCState = stub
export const checkProtectedNamespace = stub
export const getCoordinatorUserContext = stub
`

const TEXT_STUB_CONTENT = `${STUB_MARKER_TEXT}\nstub\n`
const JSON_STUB_CONTENT = `{"__stubMissing": true}\n`

const TEXT_EXTS = new Set(['.md', '.markdown', '.txt'])
const JSON_EXTS = new Set(['.json', '.json5'])

const IMPORT_PATTERNS = [
  /from\s+['"](\.[^'"]+)['"]/g,
  /import\s*\(\s*['"](\.[^'"]+)['"]/g,
  /require\s*\(\s*['"](\.[^'"]+)['"]/g,
  /import\s+['"](\.[^'"]+)['"]/g,
  /typeof\s+import\s*\(\s*['"](\.[^'"]+)['"]/g,
]

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'])

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue
    if (entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile() && SOURCE_EXT.has(path.extname(entry.name))) {
      yield full
    }
  }
}

function resolveCandidates(importer: string, spec: string): string[] {
  const importerDir = path.dirname(importer)
  const base = path.resolve(importerDir, spec)
  return [
    base,
    base + '.ts',
    base + '.tsx',
    base + '.mts',
    base + '.cts',
    base + '.js',
    base + '.jsx',
    base + '.mjs',
    base + '.cjs',
    base.replace(/\.(m|c)?js$/, '.ts'),
    base.replace(/\.(m|c)?js$/, '.tsx'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ]
}

function pickStubPath(importer: string, spec: string): string {
  const importerDir = path.dirname(importer)
  const base = path.resolve(importerDir, spec)
  if (base.endsWith('.js')) return base.slice(0, -3) + '.ts'
  if (base.endsWith('.jsx')) return base.slice(0, -4) + '.tsx'
  if (path.extname(base) === '') return base + '.ts'
  return base
}

function pickStubContent(stubPath: string): { content: string; marker: string } {
  const ext = path.extname(stubPath).toLowerCase()
  if (TEXT_EXTS.has(ext)) {
    return { content: TEXT_STUB_CONTENT, marker: STUB_MARKER_TEXT }
  }
  if (JSON_EXTS.has(ext)) {
    return { content: JSON_STUB_CONTENT, marker: '"__stubMissing"' }
  }
  return { content: TS_STUB_CONTENT, marker: STUB_MARKER_TS }
}

async function* walkRoots(roots: string[]): AsyncGenerator<string> {
  for (const root of roots) {
    if (!existsSync(root)) continue
    yield* walk(root)
  }
}

async function main() {
  const missing = new Map<string, Set<string>>()
  let scannedFiles = 0

  for await (const file of walkRoots([srcRoot, adaptersRoot])) {
    scannedFiles++
    let contents: string
    try {
      contents = await readFile(file, 'utf8')
    } catch {
      continue
    }

    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(contents)) !== null) {
        const spec = match[1]!
        if (!spec.startsWith('.')) continue
        const candidates = resolveCandidates(file, spec)
        let exists = false
        for (const c of candidates) {
          if (existsSync(c)) {
            exists = true
            break
          }
        }
        if (exists) continue
        const stubPath = pickStubPath(file, spec)
        if (!missing.has(stubPath)) missing.set(stubPath, new Set())
        missing.get(stubPath)!.add(path.relative(repoRoot, file))
      }
    }
  }

  console.log(`[scan] scanned ${scannedFiles} source files`)
  console.log(`[scan] missing ${missing.size} stub targets`)

  let createdCount = 0
  let skippedCount = 0
  for (const [stubPath, importers] of missing) {
    const isAllowed = ALLOWED_STUB_ROOTS.some(
      (root) => stubPath.startsWith(root + path.sep),
    )
    if (!isAllowed) {
      console.warn(`[scan] skip out-of-tree stub target: ${stubPath}`)
      continue
    }
    const { content, marker } = pickStubContent(stubPath)
    if (existsSync(stubPath)) {
      try {
        const existing = await readFile(stubPath, 'utf8')
        if (!existing.includes(marker) && !existing.includes(STUB_MARKER_TS)) {
          console.warn(
            `[scan] skip non-stub existing file: ${path.relative(repoRoot, stubPath)}`,
          )
          skippedCount++
          continue
        }
      } catch {
      }
    }
    await mkdir(path.dirname(stubPath), { recursive: true })
    await writeFile(stubPath, content, 'utf8')
    createdCount++
    const rel = path.relative(repoRoot, stubPath)
    const sample = [...importers].slice(0, 2).join(', ')
    console.log(
      `[scan] stub: ${rel} (referenced from ${sample}${importers.size > 2 ? `, +${importers.size - 2}` : ''})`,
    )
  }
  console.log(`[scan] created ${createdCount} stubs, skipped ${skippedCount}`)
}

await main()
