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
  scanArtifactsDir,
  type ArtifactEntry,
} from '../../utils/artifacts.js'
import { isSameOrInsidePathForPlatform } from '../../utils/windowsDrivePath.js'
import { isSafeBoardFile } from '../../utils/canvas.js'
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
import { readRecoverableJsonFile, normalizeJsonObject, writeJsonFileAtomic } from './recoverableJsonFile.js'
import { ArtifactSessionIndex, type ArtifactSessionMark } from './artifactSessionIndex.js'
import { artifactThumbnailService } from './artifactThumbnailService.js'
import { sessionService } from './sessionService.js'

export const GLOBAL_ARTIFACTS_MARKER = 'global'

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
    if (!isSafeArtifactName(name)) throw ApiError.badRequest('Invalid artifact name')
    const rootDir = await this.resolveArtifactsDir(dir)
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
    const candidate = path.resolve(entry.dir, board.file)
    const real = await fs.realpath(candidate).catch(() => null)
    const realDir = await fs.realpath(entry.dir)
    if (!real || !isSameOrInsidePathForPlatform(real, realDir)) throw ApiError.notFound(`Board file not found: ${board.file}`)
    return candidate
  }

  async updateBoard(
    dir: string,
    name: string,
    boardId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<{ latestMtimeMs: number }> {
    if (!isSafeArtifactName(name)) throw ApiError.badRequest('Invalid artifact name')
    const rootDir = await this.resolveArtifactsDir(dir)
    const entry = await readArtifactEntry(rootDir, name)
    if (!entry) throw ApiError.notFound(`Artifact not found: ${name}`)
    if (entry.manifest?.kind !== 'canvas') throw ApiError.badRequest('The artifact is not a canvas')
    const file = path.join(entry.dir, ARTIFACT_MANIFEST_FILE)
    const raw = JSON.parse(await fs.readFile(file, 'utf-8')) as { boards?: Array<Record<string, unknown>> }
    const board = raw.boards?.find(candidate => candidate.id === boardId)
    if (!board) throw ApiError.notFound(`Board not found: ${boardId}`)
    Object.assign(board, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    await writeJsonFileAtomic(file, raw)
    return { latestMtimeMs: await latestMtimeMs(entry.dir) }
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
