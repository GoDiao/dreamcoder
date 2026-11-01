import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isSameOrInsidePathForPlatform } from './windowsDrivePath.js'

export const ARTIFACTS_DIRNAME = 'dc_artifacts'
export const ARTIFACT_MANIFEST_FILE = 'artifact.json'
export const ARTIFACT_ORIGIN_FILE = '.origin.json'
export const DESIGN_SYSTEMS_FOLDER = 'systems'
export const RESERVED_ARTIFACT_NAMES = [DESIGN_SYSTEMS_FOLDER]

export const ARTIFACT_KINDS = ['page', 'canvas'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export type ArtifactBoard = {
  id: string
  file: string
  title?: string
  x: number
  y: number
  width: number
  height: number
}

export type ArtifactManifest = {
  version: 1
  id: string
  kind: ArtifactKind
  title: string
  entry: string
  designSystem?: string
  template?: { id: string; commit: string }
  boards?: ArtifactBoard[]
}

export type ArtifactOrigin = {
  workDir: string | null
  projectRoot: string | null
  branch: string | null
}

export type ArtifactEntry = {
  name: string
  dir: string
  origin: ArtifactOrigin | null
  manifest: ArtifactManifest | null
  error: string | null
}

export function getGlobalArtifactsDir(): string {
  return join(getClaudeConfigHomeDir(), 'artifacts-global', ARTIFACTS_DIRNAME)
}

function segmentsOf(path: string): string[] {
  return resolve(path).split(sep)
}

export function hasArtifactsSegment(path: string): boolean {
  return segmentsOf(path).includes(ARTIFACTS_DIRNAME)
}

export function artifactsDirOf(path: string): string | null {
  const segments = segmentsOf(path)
  const index = segments.indexOf(ARTIFACTS_DIRNAME)
  if (index < 0) return null
  return segments.slice(0, index + 1).join(sep)
}

export function artifactNameOf(path: string): string | null {
  const segments = segmentsOf(path)
  const index = segments.indexOf(ARTIFACTS_DIRNAME)
  const name = index < 0 ? undefined : segments[index + 1]
  return name ? name : null
}

export function isGlobalArtifactsPath(path: string): boolean {
  return isSameOrInsidePathForPlatform(path, getGlobalArtifactsDir())
}

export function isSafeArtifactName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !RESERVED_ARTIFACT_NAMES.includes(name)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseBoards(value: unknown): ArtifactBoard[] | undefined {
  if (!Array.isArray(value)) return undefined
  const boards: ArtifactBoard[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const board = item as Record<string, unknown>
    if (typeof board.id !== 'string' || typeof board.file !== 'string') continue
    if (![board.x, board.y, board.width, board.height].every(isFiniteNumber)) continue
    boards.push({
      id: board.id,
      file: board.file,
      ...(typeof board.title === 'string' && { title: board.title }),
      x: board.x as number,
      y: board.y as number,
      width: board.width as number,
      height: board.height as number,
    })
  }
  return boards
}

export function parseJsonObject(
  raw: string,
  fileName: string,
): { record: Record<string, unknown>; error: null } | { record: null; error: string } {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (error) {
    return { record: null, error: `${fileName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { record: null, error: `${fileName} must be a JSON object` }
  }
  return { record: data as Record<string, unknown>, error: null }
}

export async function listSafeFolderNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
    .map(entry => entry.name)
    .filter(isSafeArtifactName)
    .sort()
}

export function parseArtifactManifest(raw: string): { manifest: ArtifactManifest | null; error: string | null } {
  const { record, error: parseError } = parseJsonObject(raw, ARTIFACT_MANIFEST_FILE)
  if (!record) return { manifest: null, error: parseError }
  const problems: string[] = []
  if (record.version !== 1) problems.push('version must be 1')
  if (typeof record.id !== 'string' || record.id.trim() === '') problems.push('id is required')
  if (typeof record.kind !== 'string' || !(ARTIFACT_KINDS as readonly string[]).includes(record.kind)) {
    problems.push(`kind must be one of ${ARTIFACT_KINDS.join(', ')}`)
  }
  if (typeof record.title !== 'string' || record.title.trim() === '') problems.push('title is required')
  const kind = record.kind as ArtifactKind
  if ((ARTIFACT_KINDS as readonly string[]).includes(String(record.kind)) && typeof record.entry !== 'string') {
    problems.push('entry is required')
  }
  if (problems.length > 0) return { manifest: null, error: problems.join('; ') }
  const template = record.template as { id?: unknown; commit?: unknown } | undefined
  return {
    manifest: {
      version: 1,
      id: record.id as string,
      kind,
      title: record.title as string,
      entry: record.entry as string,
      ...(typeof record.designSystem === 'string' && { designSystem: record.designSystem }),
      ...(template && typeof template.id === 'string' && typeof template.commit === 'string' && {
        template: { id: template.id, commit: template.commit },
      }),
      ...(record.boards !== undefined && { boards: parseBoards(record.boards) }),
    },
    error: null,
  }
}

export async function latestMtimeMs(dir: string): Promise<number> {
  let latest = 0
  for (const stamp of (await listFileStamps(dir)).values()) latest = Math.max(latest, stamp.mtimeMs)
  return latest
}

async function readArtifactOrigin(dir: string): Promise<ArtifactOrigin | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, ARTIFACT_ORIGIN_FILE), 'utf-8')) as Partial<ArtifactOrigin>
    return { workDir: parsed.workDir ?? null, projectRoot: parsed.projectRoot ?? null, branch: parsed.branch ?? null }
  } catch {
    return null
  }
}

export function newArtifactId(): string {
  return randomUUID()
}

export function artifactIdentity(entry: Pick<ArtifactEntry, 'dir' | 'manifest'>): string {
  return entry.manifest?.id ?? `path:${entry.dir}`
}

export async function readArtifactEntry(artifactsDir: string, name: string): Promise<ArtifactEntry | null> {
  const dir = join(artifactsDir, name)
  let raw: string
  try {
    raw = await readFile(join(dir, ARTIFACT_MANIFEST_FILE), 'utf-8')
  } catch {
    return null
  }
  const { manifest, error } = parseArtifactManifest(raw)
  return { name, dir, origin: await readArtifactOrigin(dir), manifest, error }
}

export async function scanArtifactsDir(artifactsDir: string): Promise<ArtifactEntry[]> {
  const entries: ArtifactEntry[] = []
  for (const name of await listSafeFolderNames(artifactsDir)) {
    const entry = await readArtifactEntry(artifactsDir, name)
    if (entry) entries.push(entry)
  }
  return entries
}

export async function resolveArtifactEntryFile(entry: ArtifactEntry): Promise<string | null> {
  if (!entry.manifest) return null
  const candidate = resolve(entry.dir, entry.manifest.entry)
  if (!isSameOrInsidePathForPlatform(candidate, entry.dir)) return null
  try {
    const [realEntry, realDir] = await Promise.all([realpath(candidate), realpath(entry.dir)])
    return isSameOrInsidePathForPlatform(realEntry, realDir) ? candidate : null
  } catch {
    return null
  }
}

export type ArtifactOpenInput = { rootDir: string; filePath: string }

export async function resolveArtifactOpenInput(input: string, baseDir: string | null): Promise<ArtifactOpenInput | null> {
  if (/^[a-z][a-z0-9+.-]{1,}:/i.test(input)) return null
  const resolved = resolve(baseDir ?? '', input)
  const rootDir = artifactsDirOf(resolved)
  const name = artifactNameOf(resolved)
  if (!rootDir || !name || !isSafeArtifactName(name)) return null
  const folder = join(rootDir, name)
  if (resolved !== folder && resolved !== join(folder, ARTIFACT_MANIFEST_FILE)) {
    return { rootDir, filePath: resolved }
  }
  const entry = await readArtifactEntry(rootDir, name)
  const filePath = entry ? await resolveArtifactEntryFile(entry) : null
  return filePath ? { rootDir, filePath } : null
}

export type FileStamp = { size: number; mtimeMs: number }

export async function listFileStamps(dir: string): Promise<Map<string, FileStamp>> {
  const result = new Map<string, FileStamp>()
  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else {
        try {
          const info = await stat(full)
          result.set(relative(dir, full), { size: info.size, mtimeMs: info.mtimeMs })
        } catch {
          continue
        }
      }
    }
  }
  await walk(dir)
  return result
}

export async function artifactSignature(dir: string): Promise<string> {
  const stamps = await listFileStamps(dir)
  const lines = [...stamps].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, stamp]) => `${file}:${stamp.size}:${stamp.mtimeMs}`)
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}
