import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ApiError } from '../middleware/errorHandler.js'
import {
  ARTIFACTS_DIRNAME,
  ARTIFACT_MANIFEST_FILE,
  artifactIdentity,
  artifactNameOf,
  artifactSignature,
  artifactsDirOf,
  getGlobalArtifactsDir,
  isSafeArtifactName,
  latestMtimeMs,
  readArtifactEntry,
  resolveArtifactEntryFile,
  fileInsideFolder,
  scanArtifactsDir,
  type ArtifactEntry,
} from '../../utils/artifacts.js'
import { isSameOrInsidePathForPlatform } from '../../utils/windowsDrivePath.js'
import { isSafeBoardFile } from '../../utils/canvas.js'
import { isSafeSlideId, slideFile } from '../../utils/deck.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { copyArtifactFolder } from '../../utils/artifactTransfer.js'
import { pathExists } from '../../utils/file.js'
import { createArtifactFromTemplate, type CreateFromTemplateOptions } from '../../utils/designTemplates.js'
import {
  DESIGN_SYSTEM_MANIFEST_FILE,
  installDesignSystem,
  scanDesignSystems,
  type DesignSystemEntry,
} from '../../utils/designSystems.js'
import { ensureArtifactsDirExcluded } from '../../utils/worktree.js'
import { listGitWorktrees } from './repositoryLaunchService.js'
import { readRecoverableJsonFile, normalizeJsonObject, writeJsonFileAtomic, writeTextFileAtomic } from './recoverableJsonFile.js'
import { ArtifactSessionIndex, type ArtifactSessionMark } from './artifactSessionIndex.js'
import { artifactEditLocks, type ArtifactEditLocks } from './artifactEditLocks.js'
import { artifactThumbnailService } from './artifactThumbnailService.js'
import { sessionService } from './sessionService.js'

export const GLOBAL_ARTIFACTS_MARKER = 'global'
const MAX_SLIDE_BYTES = 1024 * 1024

export type ArtifactListItem = {
  name: string
  artifactsDir: string
  dir: string
  workDir: string | null
  projectRoot: string | null
  branch: string | null
  id: string | null
  lastOpenedAt: number | null
  entryMissing: boolean
  thumbnailMtimeMs: number | null
  origin: ArtifactEntry['origin']
  sessions: ArtifactSessionMark[]
  manifest: ArtifactEntry['manifest']
  error: string | null
  latestMtimeMs: number
}

export type DesignSystemListItem = {
  name: string
  dir: string
  artifactsDir: string
  workDir: string | null
  manifest: DesignSystemEntry['manifest']
  error: string | null
}

export type ArtifactOpenTarget = {
  rootDir: string
  filePath: string
}

type UserWrite = { dir: string; files: string[]; latestMtimeMs: number }

type KnownWorkDir = { workDir: string; projectRoot: string | null; branch: string | null }

type ArtifactRegistry = { workDirs: string[] }

type OpenedTimes = Record<string, number>

function registryPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'artifact-registry.json')
}

function openedPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'artifact-opened.json')
}

function normalizeOpened(value: unknown): OpenedTimes | null {
  const record = normalizeJsonObject(value)
  if (!record) return null
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
}

function normalizeRegistry(value: unknown): ArtifactRegistry | null {
  const record = normalizeJsonObject(value)
  if (!record) return null
  const workDirs = Array.isArray(record.workDirs)
    ? record.workDirs.filter((item): item is string => typeof item === 'string' && path.isAbsolute(item))
    : []
  return { workDirs }
}

async function canonical(target: string): Promise<string> {
  try {
    return (await fs.realpath(target)).normalize('NFC')
  } catch {
    return path.resolve(target).normalize('NFC')
  }
}

export class ArtifactService {
  private registry: ArtifactRegistry | null = null
  private opened: OpenedTimes | null = null
  private readonly sessionIndex = new ArtifactSessionIndex()
  private readonly turnSnapshots = new Map<string, Map<string, string>>()

  constructor(private readonly locks: ArtifactEditLocks = artifactEditLocks) {}

  private async loadRegistry(): Promise<ArtifactRegistry> {
    if (!this.registry) {
      this.registry = await readRecoverableJsonFile<ArtifactRegistry>({
        filePath: registryPath(),
        label: 'artifact registry',
        defaultValue: { workDirs: [] },
        normalize: normalizeRegistry,
      })
    }
    return this.registry
  }

  private async loadOpened(): Promise<OpenedTimes> {
    if (!this.opened) {
      this.opened = await readRecoverableJsonFile<OpenedTimes>({
        filePath: openedPath(),
        label: 'artifact opened times',
        defaultValue: {},
        normalize: normalizeOpened,
      })
    }
    return this.opened
  }

  async markOpened(id: string): Promise<void> {
    const opened = await this.loadOpened()
    opened[id] = Date.now()
    await writeJsonFileAtomic(openedPath(), opened)
  }

  private async saveRegistry(registry: ArtifactRegistry): Promise<void> {
    await writeJsonFileAtomic(registryPath(), registry)
  }

  async registerWrittenPath(writtenPath: string, sessionId?: string): Promise<{ artifactsDir: string } | null> {
    const artifactsDir = artifactsDirOf(writtenPath)
    if (!artifactsDir) return null
    const name = artifactNameOf(writtenPath)
    if (name && isSafeArtifactName(name) && sessionId) {
      const entry = await readArtifactEntry(artifactsDir, name)
      await this.sessionIndex.record(entry ? artifactIdentity(entry) : this.fallbackKey(artifactsDir, name), sessionId, 'tool', artifactsDir)
    }
    if (isSameOrInsidePathForPlatform(artifactsDir, getGlobalArtifactsDir())) return { artifactsDir }
    const workDir = await canonical(path.dirname(artifactsDir))
    const registry = await this.loadRegistry()
    if (!registry.workDirs.includes(workDir)) {
      registry.workDirs.push(workDir)
      await this.saveRegistry(registry)
      await ensureArtifactsDirExcluded(workDir)
    }
    return { artifactsDir }
  }

  private fallbackKey(artifactsDir: string, name: string): string {
    return `path:${path.join(artifactsDir, name)}`
  }

  private async snapshotDirs(sessionId: string, workDir: string): Promise<Map<string, string>> {
    const artifactsDirs = new Set([path.join(await canonical(workDir), ARTIFACTS_DIRNAME), ...(await this.sessionIndex.artifactsDirsOf(sessionId))])
    const snapshot = new Map<string, string>()
    for (const artifactsDir of artifactsDirs) {
      for (const entry of await scanArtifactsDir(artifactsDir)) {
        snapshot.set(`${artifactsDir}\u0000${artifactIdentity(entry)}`, await artifactSignature(entry.dir))
      }
    }
    return snapshot
  }

  async beginTurn(sessionId: string, workDir: string): Promise<void> {
    this.turnSnapshots.set(sessionId, await this.snapshotDirs(sessionId, workDir))
  }

  async endTurn(sessionId: string, workDir: string): Promise<void> {
    const before = this.turnSnapshots.get(sessionId)
    this.turnSnapshots.delete(sessionId)
    if (!before) return
    const after = await this.snapshotDirs(sessionId, workDir)
    for (const [snapshotKey, signature] of after) {
      if (before.get(snapshotKey) === signature) continue
      const [artifactsDir, identity] = snapshotKey.split('\u0000') as [string, string]
      await this.sessionIndex.record(identity, sessionId, 'snapshot', artifactsDir)
    }
  }

  async knownWorkDirs(): Promise<KnownWorkDir[]> {
    const found = new Map<string, KnownWorkDir>()
    const add = (workDir: string, projectRoot: string | null, branch: string | null) => {
      const existing = found.get(workDir)
      if (!existing) found.set(workDir, { workDir, projectRoot, branch })
      else found.set(workDir, {
        workDir,
        projectRoot: existing.projectRoot ?? projectRoot,
        branch: existing.branch ?? branch,
      })
    }

    const sessionDirs = await sessionService.listKnownWorkDirs()
    const projectRoots = new Set<string>()
    for (const { workDir, projectRoot } of sessionDirs) {
      add(await canonical(workDir), projectRoot, null)
      if (projectRoot) projectRoots.add(projectRoot)
    }
    for (const root of projectRoots) {
      for (const worktree of await listGitWorktrees(root)) add(worktree.path, root, worktree.branch)
    }
    for (const workDir of (await this.loadRegistry()).workDirs) {
      if (!(await pathExists(workDir))) continue
      add(workDir, findCanonicalGitRoot(workDir), null)
    }
    return [...found.values()]
  }

  private async buildItem(entry: ArtifactEntry, artifactsDir: string, known: KnownWorkDir | null, opened: OpenedTimes): Promise<ArtifactListItem> {
    const id = entry.manifest?.id ?? null
    return {
      id,
      lastOpenedAt: id ? (opened[id] ?? null) : null,
      entryMissing: entry.manifest ? (await resolveArtifactEntryFile(entry)) === null : false,
      thumbnailMtimeMs: id ? await artifactThumbnailService.mtimeOf(id) : null,
      origin: entry.origin,
      sessions: await this.sessionIndex.sessionsFor([...(id ? [id] : []), this.fallbackKey(artifactsDir, entry.name)]),
      name: entry.name,
      artifactsDir,
      dir: entry.dir,
      workDir: known?.workDir ?? null,
      projectRoot: known?.projectRoot ?? null,
      branch: known?.branch ?? null,
      manifest: entry.manifest,
      error: entry.error,
      latestMtimeMs: await latestMtimeMs(entry.dir),
    }
  }

  private async listIn(artifactsDir: string, known: KnownWorkDir | null): Promise<ArtifactListItem[]> {
    const opened = await this.loadOpened()
    const entries = await scanArtifactsDir(artifactsDir)
    return Promise.all(entries.map(entry => this.buildItem(entry, artifactsDir, known, opened)))
  }

  async listWorkDir(known: KnownWorkDir): Promise<ArtifactListItem[]> {
    return this.listIn(path.join(known.workDir, ARTIFACTS_DIRNAME), known)
  }

  async listGlobal(): Promise<ArtifactListItem[]> {
    return this.listIn(getGlobalArtifactsDir(), null)
  }

  async listAll(): Promise<ArtifactListItem[]> {
    const dirs = await this.knownWorkDirs()
    const lists = await Promise.all([...dirs.map(dir => this.listWorkDir(dir)), this.listGlobal()])
    return lists.flat()
  }

  async listForWorkDir(sessionWorkDir: string): Promise<{
    current: ArtifactListItem[]
    others: ArtifactListItem[]
    systems: { current: DesignSystemListItem[]; others: DesignSystemListItem[] }
  }> {
    const workDir = await canonical(sessionWorkDir)
    const dirs = await this.knownWorkDirs()
    const currentKnown = dirs.find(dir => dir.workDir === workDir) ?? {
      workDir,
      projectRoot: findCanonicalGitRoot(workDir),
      branch: null,
    }
    const siblings = dirs.filter(dir => dir.workDir !== workDir && dir.projectRoot !== null && dir.projectRoot === currentKnown.projectRoot)
    const [current, ...rest] = await Promise.all([
      this.listWorkDir(currentKnown),
      ...siblings.map(dir => this.listWorkDir(dir)),
      this.listGlobal(),
    ])
    const [currentSystems, ...otherSystems] = await Promise.all([
      this.listSystems(currentKnown.workDir),
      ...siblings.map(dir => this.listSystems(dir.workDir)),
      this.listSystems(null),
    ])
    return { current, others: rest.flat(), systems: { current: currentSystems, others: otherSystems.flat() } }
  }

  private async listSystems(workDir: string | null): Promise<DesignSystemListItem[]> {
    const artifactsDir = workDir ? path.join(workDir, ARTIFACTS_DIRNAME) : getGlobalArtifactsDir()
    return (await scanDesignSystems(artifactsDir)).map(entry => ({
      name: entry.name,
      dir: entry.dir,
      artifactsDir,
      workDir,
      manifest: entry.manifest,
      error: entry.error,
    }))
  }

  async installSystemInWorkDir(
    sessionWorkDir: string,
    options: { systemId: string; name?: string },
    sessionId?: string,
  ): Promise<{ name: string; dir: string; artifactsDir: string; reused: boolean }> {
    const artifactsDir = path.join(await canonical(sessionWorkDir), ARTIFACTS_DIRNAME)
    let installed: Awaited<ReturnType<typeof installDesignSystem>>
    try {
      installed = await installDesignSystem({ ...options, artifactsDir })
    } catch (error) {
      throw ApiError.badRequest(error instanceof Error ? error.message : String(error))
    }
    await this.registerWrittenPath(path.join(installed.dir, DESIGN_SYSTEM_MANIFEST_FILE), sessionId)
    return { name: installed.name, dir: installed.dir, artifactsDir, reused: installed.reused }
  }

  private async resolveArtifactsDir(dir: string): Promise<string> {
    if (dir === GLOBAL_ARTIFACTS_MARKER) return getGlobalArtifactsDir()
    if (!path.isAbsolute(dir) || path.basename(dir) !== ARTIFACTS_DIRNAME) {
      throw ApiError.badRequest('dir must be a dc_artifacts directory')
    }
    const resolved = path.resolve(dir)
    if (resolved === getGlobalArtifactsDir()) return resolved
    const real = await canonical(resolved)
    const known = await this.knownWorkDirs()
    const match = known.some(item => path.join(item.workDir, ARTIFACTS_DIRNAME) === real)
    if (!match) throw ApiError.badRequest('dir is not a known artifacts directory')
    return real
  }

  async resolveOpen(dir: string, name: string, boardId?: string): Promise<ArtifactOpenTarget> {
    const rootDir = path.dirname(await this.artifactFolder(dir, name))
    const entry = await readArtifactEntry(rootDir, name)
    if (!entry) throw ApiError.notFound(`Artifact not found: ${name}`)
    if (!entry.manifest) throw ApiError.badRequest(entry.error ?? 'Invalid artifact manifest')
    if (boardId !== undefined) return { rootDir, filePath: await this.resolveBoardFile(entry, boardId) }
    const filePath = await resolveArtifactEntryFile(entry)
    if (!filePath) throw ApiError.notFound(`Entry file not found for artifact: ${name}`)
    return { rootDir, filePath }
  }

  private async resolveBoardFile(entry: ArtifactEntry, boardId: string): Promise<string> {
    if (entry.manifest?.kind !== 'canvas') throw ApiError.badRequest('The artifact is not a canvas')
    const board = entry.manifest.boards?.find(candidate => candidate.id === boardId)
    if (!board) throw ApiError.notFound(`Board not found: ${boardId}`)
    if (!isSafeBoardFile(board.file)) throw ApiError.badRequest(`Board file is not allowed: ${board.file}`)
    const file = await fileInsideFolder(entry.dir, board.file)
    if (!file) throw ApiError.notFound(`Board file not found: ${board.file}`)
    return file
  }

  async updateBoard(
    dir: string,
    name: string,
    boardId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<UserWrite> {
    return this.asUser(dir, name, async folder => {
      const canvas = await this.readManifestOf(folder, 'canvas')
      const boards = canvas.raw.boards as Array<Record<string, unknown>> | undefined
      const board = boards?.find(candidate => candidate.id === boardId)
      if (!board) throw ApiError.notFound(`Board not found: ${boardId}`)
      Object.assign(board, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      await writeJsonFileAtomic(canvas.manifestFile, canvas.raw)
      return [ARTIFACT_MANIFEST_FILE]
    })
  }

  private async artifactFolder(dir: string, name: string): Promise<string> {
    if (!isSafeArtifactName(name)) throw ApiError.badRequest('Invalid artifact name')
    return path.join(await this.resolveArtifactsDir(dir), name)
  }

  private async asUser(dir: string, name: string, write: (folder: string) => Promise<string[]>): Promise<UserWrite> {
    const folder = await this.artifactFolder(dir, name)
    const holder = `write:${randomUUID()}`
    await this.locks.hold(folder, holder)
    try {
      const files = await write(folder)
      await this.locks.record(folder, files)
      return { dir: folder, files, latestMtimeMs: await latestMtimeMs(folder) }
    } finally {
      await this.locks.release(folder, holder)
    }
  }

  async holdEdit(dir: string, name: string, holder: string): Promise<void> {
    const folder = await this.artifactFolder(dir, name)
    if (!(await pathExists(folder))) throw ApiError.notFound(`Artifact not found: ${name}`)
    await this.locks.hold(folder, holder)
  }

  async releaseEdit(dir: string, name: string, holder: string): Promise<void> {
    await this.locks.release(await this.artifactFolder(dir, name), holder)
  }

  private async readManifestOf(folder: string, kind: 'deck' | 'canvas') {
    const name = path.basename(folder)
    const entry = await readArtifactEntry(path.dirname(folder), name)
    if (!entry) throw ApiError.notFound(`Artifact not found: ${name}`)
    if (entry.manifest?.kind !== kind) throw ApiError.badRequest(`The artifact is not a ${kind}`)
    const manifestFile = path.join(entry.dir, ARTIFACT_MANIFEST_FILE)
    const raw = JSON.parse(await fs.readFile(manifestFile, 'utf-8')) as Record<string, unknown>
    return { dir: entry.dir, manifestFile, raw, manifest: entry.manifest }
  }

  private async readDeck(folder: string) {
    const deck = await this.readManifestOf(folder, 'deck')
    return { ...deck, slides: deck.manifest.slides ?? [] }
  }

  private async slidePath(deckDir: string, slides: string[], id: string): Promise<string | null> {
    if (!isSafeSlideId(id)) throw ApiError.badRequest('Invalid slide id')
    if (!slides.includes(id)) throw ApiError.notFound(`Slide not found: ${id}`)
    return fileInsideFolder(deckDir, slideFile(id))
  }

  async reorderSlides(dir: string, name: string, slides: string[]): Promise<UserWrite> {
    return this.asUser(dir, name, async folder => {
      const deck = await this.readDeck(folder)
      const sameIds = slides.length === deck.slides.length && new Set(slides).size === slides.length && slides.every(id => deck.slides.includes(id))
      if (!sameIds) throw ApiError.conflict('The slides changed since the deck was shown')
      await writeJsonFileAtomic(deck.manifestFile, { ...deck.raw, slides })
      return [ARTIFACT_MANIFEST_FILE]
    })
  }

  async deleteSlide(dir: string, name: string, id: string): Promise<UserWrite> {
    return this.asUser(dir, name, async folder => {
      const deck = await this.readDeck(folder)
      const file = await this.slidePath(deck.dir, deck.slides, id)
      await writeJsonFileAtomic(deck.manifestFile, { ...deck.raw, slides: deck.slides.filter(candidate => candidate !== id) })
      if (file) await fs.rm(file, { force: true })
      return [ARTIFACT_MANIFEST_FILE, slideFile(id)]
    })
  }

  async writeSlide(dir: string, name: string, id: string, html: string, previous: string): Promise<UserWrite> {
    if (Buffer.byteLength(html) > MAX_SLIDE_BYTES) throw ApiError.badRequest('The slide is too large')
    return this.asUser(dir, name, async folder => {
      const deck = await this.readDeck(folder)
      const file = await this.slidePath(deck.dir, deck.slides, id)
      if (!file) throw ApiError.notFound(`Slide file not found: ${slideFile(id)}`)
      if ((await fs.readFile(file, 'utf-8')) !== previous) throw ApiError.conflict('The slide changed since it was shown')
      await writeTextFileAtomic(file, html)
      return [slideFile(id)]
    })
  }

  async copyIntoWorkDir(id: string, targetWorkDir: string): Promise<{ id: string; name: string; artifactsDir: string; dir: string }> {
    const item = (await this.listAll()).find(candidate => candidate.id === id)
    if (!item) throw ApiError.notFound(`Artifact not found: ${id}`)
    const workDir = await canonical(targetWorkDir)
    if (item.workDir === workDir) return { id, name: item.name, artifactsDir: item.artifactsDir, dir: item.dir }
    const artifactsDir = path.join(workDir, ARTIFACTS_DIRNAME)
    const copied = await copyArtifactFolder({ source: item.dir, destArtifactsDir: artifactsDir, removeSource: item.workDir === null })
    await this.registerWrittenPath(path.join(copied.dir, ARTIFACT_MANIFEST_FILE))
    const entry = await readArtifactEntry(artifactsDir, copied.name)
    return { id: entry?.manifest?.id ?? id, name: copied.name, artifactsDir, dir: copied.dir }
  }

  async createFromTemplate(
    project: string,
    options: Omit<CreateFromTemplateOptions, 'artifactsDir'>,
  ): Promise<{ id: string; name: string; artifactsDir: string; dir: string; filePath: string; designSystem: string | null }> {
    const workDir = await canonical(project)
    const known = await this.knownWorkDirs()
    if (!known.some(candidate => candidate.workDir === workDir || candidate.projectRoot === workDir)) {
      throw ApiError.badRequest('The project is not a known project folder')
    }
    const artifactsDir = path.join(workDir, ARTIFACTS_DIRNAME)
    let created: Awaited<ReturnType<typeof createArtifactFromTemplate>>
    try {
      created = await createArtifactFromTemplate({ ...options, artifactsDir })
    } catch (error) {
      throw ApiError.badRequest(error instanceof Error ? error.message : String(error))
    }
    await this.registerWrittenPath(path.join(created.dir, ARTIFACT_MANIFEST_FILE))
    return {
      designSystem: created.designSystem?.name ?? null,
      id: created.manifest.id,
      name: created.name,
      artifactsDir,
      dir: created.dir,
      filePath: path.join(created.dir, created.manifest.entry),
    }
  }

  async resolveOpenById(id: string): Promise<ArtifactOpenTarget> {
    const item = (await this.listAll()).find(candidate => candidate.id === id)
    if (!item) throw ApiError.notFound(`Artifact not found: ${id}`)
    return this.resolveOpen(item.workDir === null ? GLOBAL_ARTIFACTS_MARKER : item.artifactsDir, item.name)
  }
}

export const artifactService = new ArtifactService()
