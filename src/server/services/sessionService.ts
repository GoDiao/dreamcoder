import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { ApiError } from '../middleware/errorHandler.js'
import { LITE_READ_BUF_SIZE, sanitizePath as sanitizePortablePath } from '../../utils/sessionStoragePortable.js'
import type { FileHistorySnapshot } from '../../utils/fileHistory.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { calculateUSDCost, MODEL_COSTS } from '../../utils/modelCost.js'
import {
  calculateCurrentContextTokenTotal,
  MODEL_CONTEXT_WINDOW_DEFAULT,
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from '../../utils/context.js'
import { getCanonicalName } from '../../utils/model/model.js'
import {
  resolveSessionWorkspaceLaunch,
  type CreateSessionRepositoryOptions,
  type PreparedSessionWorkspace,
} from './repositoryLaunchService.js'
import { registerFilesystemAccessRoot } from './filesystemAccessRoots.js'
import { readJsonlFile } from './jsonlFile.js'
import { normalizeDriveRootPathForPlatform } from './windowsDrivePath.js'
import { cleanSessionTitleSource } from '../../utils/sessionTitleText.js'
import { extractTextBlocks, parseLocalCommand } from '../transcript/classify.js'
import {
  collectTaskNotifications,
  entriesToMessages,
  findSubagentLinks,
  shouldHideTranscriptEntry,
  subagentEntriesToMessages,
  type MessageEntry,
} from '../transcript/entries.js'
import { buildSessionTranscript } from '../transcript/history.js'
import type { SessionTranscript } from '../transcript/items.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { PermissionMode } from '../ws/protocol.js'
import type { TitleSource } from '../session/state/types.js'
import { permissionModeFromTranscriptEntries } from './permissionModes.js'
import { runtimeSelectionFromTranscriptEntries } from './runtimeSelection.js'
import type { RuntimeSelection } from '../session/state/types.js'

export type SessionListItem = {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  /** False when messageCount skipped the unread middle of a large transcript. */
  messageCountExact?: boolean
  projectPath: string
  projectRoot: string | null
  workDir: string | null
  workDirExists: boolean
  lastAssistantMessage?: string
}

export type DeleteSessionFailure = {
  sessionId: string
  message: string
  code?: string
}

export type DeleteSessionsResult = {
  successes: string[]
  failures: DeleteSessionFailure[]
}

export type SessionDetail = SessionListItem & {
  messages: MessageEntry[]
}

export type SessionLaunchInfo = {
  filePath: string
  projectDir: string
  workDir: string
  repository?: PreparedSessionWorkspace['repository']
  worktreeSession?: PersistedWorktreeSession | null
  transcriptMessageCount: number
  customTitle: string | null
}

export type TrimSessionResult = {
  removedCount: number
  removedMessageIds: string[]
}

export type TranscriptUsageSnapshot = {
  source: 'transcript'
  totalCostUSD: number
  costDisplay: string
  hasUnknownModelCost: boolean
  totalAPIDuration: number
  totalDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadInputTokens: number
  totalCacheCreationInputTokens: number
  totalWebSearchRequests: number
  models: Array<{
    model: string
    displayName: string
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    webSearchRequests: number
    costUSD: number
    costDisplay: string
    contextWindow: number
    maxOutputTokens: number
  }>
}

export type TranscriptMetadataSnapshot = {
  model?: string
  cwd?: string
  version?: string
}

export type TranscriptContextEstimate = {
  categories: Array<{
    name: string
    tokens: number
    color: string
    isDeferred?: boolean
  }>
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  gridRows: Array<Array<{
    color: string
    isFilled: boolean
    categoryName: string
    tokens: number
    percentage: number
    squareFullness: number
  }>>
  model: string
  memoryFiles: Array<{ path: string; type: string; tokens: number }>
  mcpTools: Array<{ name: string; serverName: string; tokens: number; isLoaded?: boolean }>
  agents: Array<{ agentType: string; source: string; tokens: number }>
  apiUsage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
}

const SESSION_METADATA_ENTRY_TYPES = [
  'session-meta',
  'custom-title',
  'ai-title',
  'permission-mode',
  'runtime-config',
  'worktree-state',
] as const

const CLEAR_KEPT_ENTRY_TYPES = ['custom-title', 'ai-title', 'worktree-state'] as const

function lastEntryOfType(entries: RawEntry[], type: string): RawEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.type === type) return entries[i]
  }
  return undefined
}

function entryTime(entry: RawEntry | undefined): number | null {
  if (!entry || typeof entry.timestamp !== 'string') return null
  const time = Date.parse(entry.timestamp)
  return Number.isNaN(time) ? null : time
}

function newerMetadataEntries(duplicate: RawEntry[], primary: RawEntry[]): RawEntry[] {
  const carried: RawEntry[] = []
  for (const type of SESSION_METADATA_ENTRY_TYPES) {
    const candidate = lastEntryOfType(duplicate, type)
    if (!candidate) continue
    const current = lastEntryOfType(primary, type)
    if (!current) {
      carried.push(candidate)
      continue
    }
    const candidateTime = entryTime(candidate)
    const currentTime = entryTime(current)
    if (candidateTime !== null && (currentTime === null || candidateTime > currentTime)) carried.push(candidate)
  }
  return carried
}

type RawEntry = {
  type?: string
  subtype?: string
  content?: unknown
  uuid?: string
  messageId?: string
  parentUuid?: string | null
  parent_tool_use_id?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  cwd?: string
  message?: {
    role?: string
    content?: unknown
    model?: string
    id?: string
    type?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      server_tool_use?: {
        web_search_requests?: number
      }
      speed?: string
    }
  }
  timestamp?: string
  version?: string
  snapshot?: {
    messageId?: string
    trackedFileBackups?: Record<string, unknown>
    timestamp?: string
  }
  customTitle?: string
  worktreeSession?: PersistedWorktreeSession | null
  title?: string
  [key: string]: unknown
}

type PersistedWorktreeSession = {
  originalCwd: string
  worktreePath: string
  worktreeName: string
  worktreeBranch?: string
  originalBranch?: string
  originalHeadCommit?: string
  sessionId: string
  tmuxSessionName?: string
  hookBased?: boolean
}

async function readWindow(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0)
  const buf = Buffer.allocUnsafe(length)
  const { bytesRead } = await handle.read(buf, 0, length, position)
  return bytesRead === length ? buf : buf.subarray(0, bytesRead)
}

/**
 * Complete JSONL lines inside a byte window.
 * A window that begins or ends mid-line drops that partial record so a cut
 * multi-byte character is never parsed.
 */
function completeWindowLines(
  buf: Buffer,
  dropLeadingPartial: boolean,
  dropTrailingPartial: boolean,
): string[] {
  const byteLength = buf.length
  if (byteLength === 0) return []

  let start = 0
  let end = byteLength
  if (dropLeadingPartial) {
    const newline = buf.indexOf(0x0a)
    if (newline < 0) return []
    start = newline + 1
  }
  if (dropTrailingPartial) {
    const lastNewline = buf.lastIndexOf(0x0a, end - 1)
    if (lastNewline < start) return []
    end = lastNewline
  }
  if (end <= start) return []

  const parts = buf.toString('utf8', start, end).split('\n')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts
}

const HEAD_READ_CHUNK = 64 * 1024

/**
 * First `limit` non-empty lines, then stop. A snapshot line can be larger
 * than the tail window, so the head is bounded by line count rather than bytes.
 */
async function readHeadNonEmptyLines(
  handle: fs.FileHandle,
  size: number,
  limit: number,
): Promise<{ lines: string[]; endOffset: number }> {
  const lines: string[] = []
  if (limit <= 0 || size <= 0) return { lines, endOffset: 0 }

  let offset = 0
  let pending = Buffer.alloc(0)
  while (offset < size && lines.length < limit) {
    const chunk = await readWindow(handle, offset, Math.min(HEAD_READ_CHUNK, size - offset))
    if (chunk.length === 0) break
    offset += chunk.length
    const buf = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    let start = 0
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0x0a) continue
      const line = buf.toString('utf8', start, i).trim()
      start = i + 1
      if (!line) continue
      lines.push(line)
      if (lines.length >= limit) {
        return { lines, endOffset: offset - (buf.length - start) }
      }
    }
    pending = start === buf.length ? Buffer.alloc(0) : Buffer.from(buf.subarray(start))
  }

  if (pending.length > 0 && lines.length < limit) {
    const line = pending.toString('utf8').trim()
    if (line) lines.push(line)
  }
  return { lines, endOffset: offset }
}

/** Lines after the head. The last 64KB is enough once the head has stopped early. */
async function readTailLines(
  handle: fs.FileHandle,
  size: number,
  headEndOffset: number,
): Promise<{ lines: string[]; exact: boolean }> {
  if (headEndOffset >= size) return { lines: [], exact: true }

  const tailStart = Math.max(0, size - LITE_READ_BUF_SIZE)
  if (headEndOffset >= tailStart) {
    const rest = await readWindow(handle, headEndOffset, size - headEndOffset)
    return { lines: completeWindowLines(rest, false, false), exact: true }
  }

  const tail = await readWindow(handle, tailStart, size - tailStart)
  let dropLeading = false
  if (tailStart > 0) {
    const boundary = await readWindow(handle, tailStart - 1, 1)
    dropLeading = boundary.length !== 1 || boundary[0] !== 0x0a
  }
  return { lines: completeWindowLines(tail, dropLeading, false), exact: false }
}

function summarizeSessionWindowLines(
  lines: string[],
  headLines: number,
  tailLines: number,
  includeLastAssistantMessage: boolean,
): { entries: RawEntry[]; messageCount: number; lastAssistantMessage: string } {
  const trimmedLines: string[] = []
  let messageCount = 0
  let lastAssistantMessage = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    trimmedLines.push(trimmed)

    if (
      (trimmed.includes('"type":"user"') || trimmed.includes('"type":"assistant"')) &&
      trimmed.includes('"role"')
    ) {
      messageCount++
    }

    if (includeLastAssistantMessage && trimmed.includes('"assistant"')) {
      try {
        const entry = JSON.parse(trimmed) as RawEntry
        if (
          entry?.type === 'assistant' &&
          entry.message?.role === 'assistant' &&
          !entry.isSidechain &&
          !entry.isMeta &&
          !entry.parent_tool_use_id &&
          !shouldHideTranscriptEntry(entry)
        ) {
          const text = extractTextBlocks(entry.message.content).join('\n').trim()
          if (text) lastAssistantMessage = text
        }
      } catch { }
    }
  }

  const head = trimmedLines.slice(0, headLines)
  const orderedTail = trimmedLines.slice(Math.max(0, trimmedLines.length - tailLines))
  const entries: RawEntry[] = []
  for (const line of [...head, ...orderedTail]) {
    try { entries.push(JSON.parse(line) as RawEntry) } catch { }
  }
  return { entries, messageCount, lastAssistantMessage }
}

export class SessionService {
  private transcriptWrites = new Map<string, Promise<void>>()

  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
  }

  private getProjectsDir(): string {
    return path.join(this.getConfigDir(), 'projects')
  }

  private sanitizePath(dirPath: string): string {
    return sanitizePortablePath(dirPath)
  }

  private readJsonlFile(filePath: string): Promise<RawEntry[]> {
    return readJsonlFile<RawEntry>(filePath)
  }

  private async scanSessionFileHead(
    filePath: string,
    headLines: number,
    tailLines: number,
    includeLastAssistantMessage = false,
  ): Promise<{ entries: RawEntry[]; messageCount: number; lastAssistantMessage: string; messageCountExact: boolean }> {
    let handle: fs.FileHandle | undefined
    try {
      handle = await fs.open(filePath, 'r')
      const stat = await handle.stat()
      if (!stat.isFile()) {
        const error = new Error(`EISDIR: illegal operation on a directory, read '${filePath}'`) as NodeJS.ErrnoException
        error.code = 'EISDIR'
        throw error
      }
      const head = await readHeadNonEmptyLines(handle, stat.size, headLines)
      const tail = await readTailLines(handle, stat.size, head.endOffset)
      const summary = summarizeSessionWindowLines(
        [...head.lines, ...tail.lines],
        headLines,
        tailLines,
        includeLastAssistantMessage,
      )
      return { ...summary, messageCountExact: tail.exact }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], messageCount: 0, lastAssistantMessage: '', messageCountExact: true }
      }
      throw err
    } finally {
      await handle?.close()
    }
  }

  private async appendJsonlEntry(filePath: string, entry: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify(entry) + '\n'
    await fs.appendFile(filePath, line, 'utf-8')
  }

  private resolveWorkDirFromEntries(
    entries: RawEntry[],
    fallbackProjectDir?: string,
  ): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.type === 'session-meta' && typeof (entry as Record<string, unknown>).workDir === 'string') {
        return normalizeDriveRootPathForPlatform((entry as Record<string, unknown>).workDir as string)
      }
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      const cwd = entries[i]?.cwd
      if (typeof cwd === 'string' && cwd.trim()) {
        return normalizeDriveRootPathForPlatform(cwd)
      }
    }

    return fallbackProjectDir ? this.desanitizePath(fallbackProjectDir) : null
  }

  private resolveRepositoryFromEntries(entries: RawEntry[]): PreparedSessionWorkspace['repository'] | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
      const repository = (entries[i] as Record<string, unknown>)?.repository
      if (repository && typeof repository === 'object') {
        return repository as PreparedSessionWorkspace['repository']
      }
    }
    return undefined
  }

  private resolveWorktreeSessionFromEntries(entries: RawEntry[]): PersistedWorktreeSession | null | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry?.type !== 'worktree-state') continue

      const worktreeSession = entry.worktreeSession
      if (worktreeSession === null) return null
      if (
        worktreeSession &&
        typeof worktreeSession === 'object' &&
        typeof worktreeSession.worktreePath === 'string' &&
        typeof worktreeSession.worktreeName === 'string'
      ) {
        return worktreeSession
      }
    }
    return undefined
  }

  private async resolveProjectRootFromEntries(
    entries: RawEntry[],
    workDir: string | null,
    fallbackProjectDir?: string,
  ): Promise<string | null> {
    const worktreeSession = this.resolveWorktreeSessionFromEntries(entries)
    const repository = this.resolveRepositoryFromEntries(entries)

    const candidate = worktreeSession?.originalCwd ||
      repository?.repoRoot ||
      workDir ||
      (fallbackProjectDir ? this.desanitizePath(fallbackProjectDir) : null)

    if (!candidate) return null

    const canonicalCandidate = await this.canonicalizeProjectPath(candidate)
    const gitRoot = findCanonicalGitRoot(canonicalCandidate)
    if (gitRoot) return gitRoot

    if (workDir) {
      const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`
      const markerIndex = canonicalCandidate.indexOf(marker)
      if (markerIndex > 0) return canonicalCandidate.slice(0, markerIndex)
    }

    return canonicalCandidate
  }

  private async canonicalizeProjectPath(projectPath: string): Promise<string> {
    try {
      return normalizeDriveRootPathForPlatform(await fs.realpath(projectPath)).normalize('NFC')
    } catch {
      return projectPath.normalize('NFC')
    }
  }

  private countTranscriptMessages(entries: RawEntry[]): number {
    return entries.filter((entry) =>
      !entry.isMeta &&
      !!entry.message?.role &&
      (entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system')
    ).length
  }

  private goalCreationCommandTitle(entry: RawEntry): string | null {
    if (
      entry.type !== 'system' ||
      entry.subtype !== 'local_command' ||
      typeof entry.content !== 'string'
    ) {
      return null
    }

    const command = parseLocalCommand(entry.content)
    if (command?.name !== 'goal') return null

    const args = command.args
    if (!args || /^clear\b/i.test(args)) return null

    const title = cleanSessionTitleSource(`/goal ${args}`)
    return title ? title.length > 80 ? title.slice(0, 80) + '...' : title : null
  }

  private subagentTranscriptPath(
    projectDir: string,
    sessionId: string,
    agentId: string,
  ): string {
    const normalizedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`
    return path.join(
      this.getProjectsDir(),
      projectDir,
      sessionId,
      'subagents',
      `${normalizedAgentId}.jsonl`,
    )
  }

  private async loadSubagentToolMessages(
    projectDir: string,
    sessionId: string,
    parentToolUseId: string,
    agentId: string,
  ): Promise<MessageEntry[]> {
    const entries = await this.readJsonlFile(this.subagentTranscriptPath(projectDir, sessionId, agentId))
    return subagentEntriesToMessages(entries, parentToolUseId, agentId)
  }

  private async appendSubagentToolMessages(
    projectDir: string,
    sessionId: string,
    messages: MessageEntry[],
  ): Promise<MessageEntry[]> {
    const resultLinks = findSubagentLinks(messages)
    if (resultLinks.size === 0) {
      return messages
    }

    const childMessages = await Promise.all(
      [...resultLinks.entries()].map(([parentToolUseId, agentId]) =>
        this.loadSubagentToolMessages(projectDir, sessionId, parentToolUseId, agentId),
      ),
    )
    return [...messages, ...childMessages.flat()]
  }

  private extractTitle(entries: RawEntry[]): string {
    return this.extractTitleWithSource(entries)?.text ?? 'Untitled Session'
  }

  private extractTitleWithSource(entries: RawEntry[]): { text: string; source: TitleSource } | null {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (e.type === 'custom-title' && e.customTitle) {
        return { text: e.customTitle, source: 'custom' }
      }
    }

    for (const e of entries) {
      const goalTitle = this.goalCreationCommandTitle(e)
      if (goalTitle) return { text: goalTitle, source: 'goal' }
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (e.type === 'ai-title' && e.aiTitle) {
        const title = cleanSessionTitleSource(String(e.aiTitle))
        if (title) return { text: title, source: 'ai' }
      }
    }

    for (const e of entries) {
      if (e.type === 'user' && !e.isMeta && e.message?.role === 'user') {
        const content = e.message.content
        let text: string | undefined
        if (typeof content === 'string') {
          text = content
        } else if (Array.isArray(content)) {
          const textBlock = content.find(
            (block: Record<string, unknown>) => block.type === 'text' && typeof block.text === 'string'
          )
          if (textBlock) text = textBlock.text as string
        }
        if (text) {
          const title = cleanSessionTitleSource(text)
          if (title) return { text: title.length > 80 ? title.slice(0, 80) + '...' : title, source: 'first-message' }
        }
      }
    }

    return null
  }

  private async discoverSessionFiles(projectFilter?: string): Promise<
    Array<{ filePath: string; projectDir: string; sessionId: string }>
  > {
    const projectsDir = this.getProjectsDir()
    let projectDirs: string[]

    try {
      projectDirs = await fs.readdir(projectsDir)
    } catch {
      return []
    }

    if (projectFilter) {
      const sanitized = this.sanitizePath(normalizeDriveRootPathForPlatform(projectFilter))
      projectDirs = projectDirs.filter((d) => d === sanitized)
    }

    const results: Array<{ filePath: string; projectDir: string; sessionId: string }> = []

    for (const dir of projectDirs) {
      const dirPath = path.join(projectsDir, dir)

      try {
        const stat = await fs.stat(dirPath)
        if (!stat.isDirectory()) continue
      } catch {
        continue
      }

      let files: string[]
      try {
        files = await fs.readdir(dirPath)
      } catch {
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const sessionId = file.replace('.jsonl', '')
        results.push({
          filePath: path.join(dirPath, file),
          projectDir: dir,
          sessionId,
        })
      }
    }

    return results
  }

  desanitizePath(sanitized: string): string {
    const windowsDrivePath = sanitized.match(/^([a-zA-Z])--(.+)$/)
    if (windowsDrivePath) {
      return `${windowsDrivePath[1]}:${path.win32.sep}${windowsDrivePath[2].replace(/-/g, path.win32.sep)}`
    }

    const windowsDriveRoot = sanitized.match(/^([a-zA-Z])--$/)
    if (windowsDriveRoot) {
      return `${windowsDriveRoot[1]}:${path.win32.sep}`
    }

    return sanitized.replace(/-/g, path.sep)
  }

  private async findSessionFiles(
    sessionId: string
  ): Promise<Array<{ filePath: string; projectDir: string }>> {
    if (!this.isValidSessionId(sessionId)) {
      return []
    }

    const projectsDir = this.getProjectsDir()
    let projectDirs: string[]

    try {
      projectDirs = await fs.readdir(projectsDir)
    } catch {
      return []
    }

    const matches: Array<{ filePath: string; projectDir: string; mtimeMs: number }> = []
    for (const dir of projectDirs) {
      const filePath = path.join(projectsDir, dir, `${sessionId}.jsonl`)
      try {
        const stat = await fs.stat(filePath)
        matches.push({ filePath, projectDir: dir, mtimeMs: stat.mtimeMs })
      } catch {
        continue
      }
    }

    return matches
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(({ filePath, projectDir }) => ({ filePath, projectDir }))
  }

  async findSessionFile(
    sessionId: string
  ): Promise<{ filePath: string; projectDir: string } | null> {
    const matches = await this.findSessionFiles(sessionId)
    if (matches.length <= 1) return matches[0] ?? null
    for (const match of matches) {
      if (this.hasConversationContent(await this.readJsonlFile(match.filePath))) return match
    }
    return matches[0]!
  }

  private hasConversationContent(entries: RawEntry[]): boolean {
    return this.countTranscriptMessages(entries) > 0 ||
      entries.some((entry) => entry.type === 'system' && entry.subtype === 'local_command')
  }

  private enqueueSessionWrite<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.transcriptWrites.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    const settled = next.then(() => {}, () => {})
    this.transcriptWrites.set(sessionId, settled)
    void settled.finally(() => {
      if (this.transcriptWrites.get(sessionId) === settled) this.transcriptWrites.delete(sessionId)
    })
    return next
  }

  private async writableSessionFile(sessionId: string): Promise<{ filePath: string; projectDir: string } | null> {
    const primary = await this.findSessionFile(sessionId)
    if (!primary) return null
    const duplicates = (await this.findSessionFiles(sessionId)).filter((match) => match.filePath !== primary.filePath)
    if (duplicates.length === 0) return primary
    let primaryEntries = await this.readJsonlFile(primary.filePath)
    if (!this.hasConversationContent(primaryEntries)) return primary
    for (const duplicate of duplicates) {
      const entries = await this.readJsonlFile(duplicate.filePath)
      if (this.hasConversationContent(entries)) continue
      const carried = newerMetadataEntries(entries, primaryEntries)
      for (const entry of carried) {
        await this.appendJsonlEntry(primary.filePath, entry)
      }
      primaryEntries = [...primaryEntries, ...carried]
      await fs.rm(duplicate.filePath, { force: true })
    }
    return primary
  }

  private isValidSessionId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  }

  private formatCost(cost: number): string {
    return `$${cost > 0.5 ? (Math.round(cost * 100) / 100).toFixed(2) : cost.toFixed(4)}`
  }

  private getTranscriptContextWindow(model: string): number {
    try {
      return getContextWindowForModel(model)
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('Config accessed before allowed')
      ) {
        return MODEL_CONTEXT_WINDOW_DEFAULT
      }
      throw err
    }
  }

  async getTranscriptMetadata(sessionId: string): Promise<TranscriptMetadataSnapshot | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const metadata: TranscriptMetadataSnapshot = {}

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!
      if (!metadata.model && typeof entry.message?.model === 'string') {
        metadata.model = entry.message.model
      }
      if (!metadata.cwd && typeof entry.cwd === 'string') {
        metadata.cwd = entry.cwd
      }
      if (!metadata.version && typeof entry.version === 'string') {
        metadata.version = entry.version
      }
      if (metadata.model && metadata.cwd && metadata.version) break
    }

    return metadata
  }

  async getTranscriptContextEstimate(sessionId: string): Promise<TranscriptContextEstimate | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    let latest: {
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
      cacheCreationInputTokens: number
    } | null = null

    for (const entry of entries) {
      const usage = entry.message?.usage
      const model = entry.message?.model
      if (!usage || typeof model !== 'string') continue

      const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
      const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
      const cacheReadInputTokens = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
      const cacheCreationInputTokens = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0
      const promptTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens
      if (promptTokens === 0 && outputTokens === 0) continue

      latest = {
        model,
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
      }
    }

    if (!latest) return null

    const rawMaxTokens = this.getTranscriptContextWindow(latest.model)
    const promptTokens = latest.inputTokens + latest.cacheReadInputTokens + latest.cacheCreationInputTokens
    const totalTokens = calculateCurrentContextTokenTotal(promptTokens, {
      input_tokens: latest.inputTokens,
      output_tokens: latest.outputTokens,
      cache_read_input_tokens: latest.cacheReadInputTokens,
      cache_creation_input_tokens: latest.cacheCreationInputTokens,
    }, rawMaxTokens)
    const percentage = rawMaxTokens > 0 ? Math.round((totalTokens / rawMaxTokens) * 100) : 0
    const categories: TranscriptContextEstimate['categories'] = [
      { name: 'Input tokens', tokens: latest.inputTokens, color: '#8f3217' },
      { name: 'Cache read', tokens: latest.cacheReadInputTokens, color: '#0f5c8f' },
      { name: 'Cache write', tokens: latest.cacheCreationInputTokens, color: '#7c3aed' },
      { name: 'Output tokens', tokens: latest.outputTokens, color: '#2f7d32' },
      { name: 'Free space', tokens: Math.max(0, rawMaxTokens - totalTokens), color: '#a1a1aa', isDeferred: true },
    ].filter((category) => category.tokens > 0)

    const filledSquares = Math.max(0, Math.min(100, Math.round((totalTokens / Math.max(1, rawMaxTokens)) * 100)))
    const gridRows = Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => {
        const index = row * 10 + col
        const isFilled = index < filledSquares
        return {
          color: isFilled ? '#8f3217' : '#a1a1aa',
          isFilled,
          categoryName: isFilled ? 'Input context' : 'Free space',
          tokens: Math.round(rawMaxTokens / 100),
          percentage: 1,
          squareFullness: isFilled ? 1 : 0,
        }
      }),
    )

    return {
      categories,
      totalTokens,
      maxTokens: rawMaxTokens,
      rawMaxTokens,
      percentage,
      gridRows,
      model: latest.model,
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      apiUsage: {
        input_tokens: latest.inputTokens,
        output_tokens: latest.outputTokens,
        cache_creation_input_tokens: latest.cacheCreationInputTokens,
        cache_read_input_tokens: latest.cacheReadInputTokens,
      },
    }
  }

  async getTranscriptUsage(sessionId: string): Promise<TranscriptUsageSnapshot | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const models = new Map<string, TranscriptUsageSnapshot['models'][number]>()
    let totalCostUSD = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheReadInputTokens = 0
    let totalCacheCreationInputTokens = 0
    let totalWebSearchRequests = 0
    let hasUnknownModelCost = false
    let firstUsageAt: number | null = null
    let lastUsageAt: number | null = null

    for (const entry of entries) {
      const usage = entry.message?.usage
      const model = entry.message?.model
      if (!usage || typeof model !== 'string') continue

      const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
      const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
      const cacheReadInputTokens = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
      const cacheCreationInputTokens = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0
      const webSearchRequests = typeof usage.server_tool_use?.web_search_requests === 'number'
        ? usage.server_tool_use.web_search_requests
        : 0

      if (
        inputTokens === 0 &&
        outputTokens === 0 &&
        cacheReadInputTokens === 0 &&
        cacheCreationInputTokens === 0 &&
        webSearchRequests === 0
      ) {
        continue
      }

      const canonical = getCanonicalName(model)
      if (!Object.prototype.hasOwnProperty.call(MODEL_COSTS, canonical)) {
        hasUnknownModelCost = true
      }

      const costUsage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheReadInputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
        server_tool_use: { web_search_requests: webSearchRequests },
        speed: usage.speed,
      } as Parameters<typeof calculateUSDCost>[1]
      const costUSD = calculateUSDCost(model, costUsage)

      let modelUsage = models.get(model)
      if (!modelUsage) {
        modelUsage = {
          model,
          displayName: canonical,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          costDisplay: '$0.0000',
          contextWindow: this.getTranscriptContextWindow(model),
          maxOutputTokens: getModelMaxOutputTokens(model).default,
        }
        models.set(model, modelUsage)
      }

      modelUsage.inputTokens += inputTokens
      modelUsage.outputTokens += outputTokens
      modelUsage.cacheReadInputTokens += cacheReadInputTokens
      modelUsage.cacheCreationInputTokens += cacheCreationInputTokens
      modelUsage.webSearchRequests += webSearchRequests
      modelUsage.costUSD += costUSD
      modelUsage.costDisplay = this.formatCost(modelUsage.costUSD)

      totalCostUSD += costUSD
      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      totalCacheReadInputTokens += cacheReadInputTokens
      totalCacheCreationInputTokens += cacheCreationInputTokens
      totalWebSearchRequests += webSearchRequests

      if (entry.timestamp) {
        const time = Date.parse(entry.timestamp)
        if (!Number.isNaN(time)) {
          firstUsageAt = firstUsageAt === null ? time : Math.min(firstUsageAt, time)
          lastUsageAt = lastUsageAt === null ? time : Math.max(lastUsageAt, time)
        }
      }
    }

    if (models.size === 0) return null

    return {
      source: 'transcript',
      totalCostUSD,
      costDisplay: this.formatCost(totalCostUSD),
      hasUnknownModelCost,
      totalAPIDuration: 0,
      totalDuration:
        firstUsageAt !== null && lastUsageAt !== null
          ? Math.max(0, Math.round((lastUsageAt - firstUsageAt) / 1000))
          : 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadInputTokens,
      totalCacheCreationInputTokens,
      totalWebSearchRequests,
      models: Array.from(models.values()),
    }
  }

  async listSessions(options?: {
    project?: string
    limit?: number
    offset?: number
    includeLastAssistantMessage?: boolean
  }): Promise<{ sessions: SessionListItem[]; total: number }> {
    const mem0 = process.memoryUsage()
    console.log(`[mem:sidecar] listSessions:start rss=${(mem0.rss/1024/1024).toFixed(1)}MB heapUsed=${(mem0.heapUsed/1024/1024).toFixed(1)}MB`)
    const sessionFiles = await this.discoverSessionFiles(options?.project)
    const filesWithStats = (await Promise.all(sessionFiles.map(async (sessionFile) => {
      try {
        return {
          ...sessionFile,
          stat: await fs.stat(sessionFile.filePath),
        }
      } catch {
        return null
      }
    }))).filter((item): item is NonNullable<typeof item> => item !== null)

    filesWithStats.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime())

    const total = filesWithStats.length
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 50
    const paginatedFiles = filesWithStats.slice(offset, offset + limit)

    const items = (await Promise.all(paginatedFiles.map(async ({ filePath, projectDir, sessionId, stat }) => {
      try {
        const { entries: headEntries, messageCount, lastAssistantMessage, messageCountExact } = await this.scanSessionFileHead(
          filePath,
          100,
          100,
          options?.includeLastAssistantMessage,
        )
        const workDir = this.resolveWorkDirFromEntries(headEntries, projectDir)
        const projectRoot = await this.resolveProjectRootFromEntries(headEntries, workDir, projectDir)
        const workDirExists = await this.pathExists(workDir)

        const title = this.extractTitle(headEntries)

        let createdAt = stat.birthtime.toISOString()
        for (const e of headEntries) {
          if (e.timestamp) {
            createdAt = e.timestamp
            break
          }
        }

        return {
          id: sessionId,
          title,
          createdAt,
          modifiedAt: stat.mtime.toISOString(),
          messageCount,
          ...(messageCountExact ? {} : { messageCountExact: false }),
          projectPath: projectDir,
          projectRoot,
          workDir,
          workDirExists,
          ...(options?.includeLastAssistantMessage ? { lastAssistantMessage } : {}),
        }
      } catch {
        return null
      }
    }))).filter((item): item is SessionListItem => item !== null)

    const mem1 = process.memoryUsage()
    console.log(`[mem:sidecar] listSessions:done total=${total} returned=${items.length} rss=${(mem1.rss/1024/1024).toFixed(1)}MB heapUsed=${(mem1.heapUsed/1024/1024).toFixed(1)}MB`)
    return { sessions: items, total }
  }

  async getSession(sessionId: string): Promise<SessionDetail | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const { filePath, projectDir } = found
    const stat = await fs.stat(filePath)
    const entries = await this.readJsonlFile(filePath)

    const messages = await this.appendSubagentToolMessages(
      projectDir,
      sessionId,
      entriesToMessages(entries),
    )
    const title = this.extractTitle(entries)
    const workDir = this.resolveWorkDirFromEntries(entries, projectDir)
    const projectRoot = await this.resolveProjectRootFromEntries(entries, workDir, projectDir)
    const workDirExists = await this.pathExists(workDir)

    let createdAt = stat.birthtime.toISOString()
    for (const e of entries) {
      if (e.timestamp) {
        createdAt = e.timestamp
        break
      }
    }

    return {
      id: sessionId,
      title,
      createdAt,
      modifiedAt: stat.mtime.toISOString(),
      messageCount: messages.length,
      projectPath: projectDir,
      projectRoot,
      workDir,
      workDirExists,
      messages,
    }
  }

  async getSessionMessages(sessionId: string): Promise<MessageEntry[]> {
    const mem0 = process.memoryUsage()
    const found = await this.findSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const messages = await this.appendSubagentToolMessages(
      found.projectDir,
      sessionId,
      entriesToMessages(entries),
    )
    const mem1 = process.memoryUsage()
    console.log(`[mem:sidecar] getSessionMessages:done session=${sessionId} entries=${entries.length} msgs=${messages.length} rss=${(mem1.rss/1024/1024).toFixed(1)}MB heapUsed=${(mem1.heapUsed/1024/1024).toFixed(1)}MB (delta rss=${((mem1.rss-mem0.rss)/1024/1024).toFixed(1)}MB)`)
    return messages
  }

  async createSession(
    workDir?: string,
    repositoryOptions?: CreateSessionRepositoryOptions,
    permissionMode?: PermissionMode,
    runtime?: RuntimeSelection,
  ): Promise<{ sessionId: string; workDir: string }> {
    const resolvedWorkDir = workDir || os.homedir()
    const sessionId = crypto.randomUUID()

    const preparedWorkspace = await resolveSessionWorkspaceLaunch(
      resolvedWorkDir,
      repositoryOptions,
      sessionId,
    )
    const absWorkDir = preparedWorkspace.workDir
    registerFilesystemAccessRoot(absWorkDir)
    console.log(
      `[SessionService] createSession: requested workDir=${JSON.stringify(
        workDir,
      )}, resolved=${absWorkDir}, repository=${JSON.stringify(
        preparedWorkspace.repository ?? null,
      )} (process.cwd()=${process.cwd()})`,
    )

    const sanitized = this.sanitizePath(absWorkDir)
    const dirPath = path.join(this.getProjectsDir(), sanitized)

    await fs.mkdir(dirPath, { recursive: true })

    const filePath = path.join(dirPath, `${sessionId}.jsonl`)
    const now = new Date().toISOString()

    const initialEntry = {
      type: 'file-history-snapshot',
      messageId: crypto.randomUUID(),
      snapshot: {
        messageId: crypto.randomUUID(),
        trackedFileBackups: {},
        timestamp: now,
      },
      isSnapshotUpdate: false,
    }

    const metaEntry = {
      type: 'session-meta',
      isMeta: true,
      workDir: absWorkDir,
      repository: preparedWorkspace.repository,
      timestamp: now,
    }

    const modeEntry = permissionMode
      ? JSON.stringify(this.permissionModeEntry(sessionId, permissionMode)) + '\n'
      : ''
    const runtimeEntry = runtime
      ? JSON.stringify(this.runtimeConfigEntry(sessionId, runtime)) + '\n'
      : ''
    await fs.writeFile(
      filePath,
      JSON.stringify(initialEntry) + '\n' + JSON.stringify(metaEntry) + '\n' + modeEntry + runtimeEntry,
      'utf-8',
    )

    return { sessionId, workDir: absWorkDir }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const found = await this.findSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    await fs.unlink(found.filePath)
  }

  async deleteSessions(sessionIds: string[]): Promise<DeleteSessionsResult> {
    const successes: string[] = []
    const failures: DeleteSessionFailure[] = []

    const results = await Promise.all(sessionIds.map(async (sessionId) => {
      try {
        await this.deleteSession(sessionId)
        return { type: 'success' as const, sessionId }
      } catch (error) {
        return {
          type: 'failure' as const,
          sessionId,
          message: error instanceof Error ? error.message : 'Unknown delete failure',
          code: error instanceof ApiError ? error.code : undefined,
        }
      }
    }))

    for (const result of results) {
      if (result.type === 'success') {
        successes.push(result.sessionId)
      } else {
        failures.push({
          sessionId: result.sessionId,
          message: result.message,
          code: result.code,
        })
      }
    }

    return { successes, failures }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    if (!title || typeof title !== 'string') {
      throw ApiError.badRequest('title is required')
    }

    await this.enqueueSessionWrite(sessionId, async () => {
      const found = await this.writableSessionFile(sessionId)
      if (!found) {
        throw ApiError.notFound(`Session not found: ${sessionId}`)
      }
      await this.appendJsonlEntry(found.filePath, this.customTitleEntry(title))
    })
  }

  appendAiTitle(sessionId: string, title: string): Promise<void> {
    return this.enqueueSessionWrite(sessionId, async () => {
      const found = await this.writableSessionFile(sessionId)
      if (!found) return
      await this.appendJsonlEntry(found.filePath, {
        type: 'ai-title',
        aiTitle: title,
        timestamp: new Date().toISOString(),
      })
    })
  }

  restoreCustomTitle(sessionId: string, title: string): Promise<boolean> {
    return this.enqueueSessionWrite(sessionId, async () => {
      const found = await this.writableSessionFile(sessionId)
      if (!found) return false
      const entries = await this.readJsonlFile(found.filePath)
      const last = lastEntryOfType(entries, 'custom-title')
      if (last?.customTitle === title) return false
      await this.appendJsonlEntry(found.filePath, this.customTitleEntry(title))
      return true
    })
  }

  private customTitleEntry(title: string): Record<string, unknown> {
    return { type: 'custom-title', customTitle: title, timestamp: new Date().toISOString() }
  }

  async getCustomTitle(sessionId: string): Promise<string | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    let customTitle: string | null = null
    for (const entry of entries) {
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle.trim()) {
        customTitle = entry.customTitle
      }
    }
    return customTitle
  }

  async getSessionWorkDir(sessionId: string): Promise<string | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    return this.resolveWorkDirFromEntries(entries, found.projectDir)
  }

  async getSessionMessageCwd(
    sessionId: string,
    messageId: string,
  ): Promise<string | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const entry = entries.find((candidate) => candidate.uuid === messageId)
    return typeof entry?.cwd === 'string' && entry.cwd.trim() ? entry.cwd : null
  }

  async getSessionLaunchInfo(sessionId: string): Promise<SessionLaunchInfo | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.readJsonlFile(found.filePath)
    const workDir = this.resolveWorkDirFromEntries(entries, found.projectDir) || process.cwd()
    const repository = this.resolveRepositoryFromEntries(entries)
    const worktreeSession = this.resolveWorktreeSessionFromEntries(entries)
    let customTitle: string | null = null

    for (const entry of entries) {
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
        customTitle = entry.customTitle
      }
    }
    const transcriptMessageCount = this.countTranscriptMessages(entries)

    return {
      filePath: found.filePath,
      projectDir: found.projectDir,
      workDir,
      repository,
      worktreeSession,
      transcriptMessageCount,
      customTitle,
    }
  }

  async deleteSessionFile(sessionId: string): Promise<void> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return
    await fs.unlink(found.filePath)
  }

  clearSessionTranscript(sessionId: string, fallbackWorkDir?: string): Promise<void> {
    return this.enqueueSessionWrite(sessionId, () => this.rewriteClearedTranscript(sessionId, fallbackWorkDir))
  }

  private async rewriteClearedTranscript(sessionId: string, fallbackWorkDir?: string): Promise<void> {
    let found = await this.writableSessionFile(sessionId)
    if (!found && fallbackWorkDir) {
      const resolvedPath = path.resolve(normalizeDriveRootPathForPlatform(fallbackWorkDir))
      const absWorkDir = await fs.realpath(resolvedPath).catch(() => resolvedPath)
      const dirPath = path.join(this.getProjectsDir(), this.sanitizePath(absWorkDir))
      await fs.mkdir(dirPath, { recursive: true })
      found = {
        filePath: path.join(dirPath, `${sessionId}.jsonl`),
        projectDir: this.sanitizePath(absWorkDir),
      }
    }
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const workDir = this.resolveWorkDirFromEntries(entries, found.projectDir) || fallbackWorkDir || process.cwd()
    const repository = this.resolveRepositoryFromEntries(entries)
    const permissionMode = permissionModeFromTranscriptEntries(entries)
    const runtime = runtimeSelectionFromTranscriptEntries(entries)
    const now = new Date().toISOString()

    const initialEntry = {
      type: 'file-history-snapshot',
      messageId: crypto.randomUUID(),
      snapshot: {
        messageId: crypto.randomUUID(),
        trackedFileBackups: {},
        timestamp: now,
      },
      isSnapshotUpdate: false,
    }

    const metaEntry = {
      type: 'session-meta',
      isMeta: true,
      workDir,
      repository,
      timestamp: now,
    }

    const modeEntry = permissionMode
      ? `${JSON.stringify(this.permissionModeEntry(sessionId, permissionMode))}\n`
      : ''
    const runtimeEntry = runtime !== undefined
      ? `${JSON.stringify(this.runtimeConfigEntry(sessionId, runtime))}\n`
      : ''
    const keptEntries = CLEAR_KEPT_ENTRY_TYPES
      .map((type) => lastEntryOfType(entries, type))
      .filter((entry): entry is RawEntry => !!entry)
      .map((entry) => `${JSON.stringify(entry)}\n`)
      .join('')
    await fs.writeFile(
      found.filePath,
      `${JSON.stringify(initialEntry)}\n${JSON.stringify(metaEntry)}\n${modeEntry}${runtimeEntry}${keptEntries}`,
      'utf-8',
    )
  }

  async getSessionRestoreInfo(sessionId: string): Promise<{
    permissionMode: PermissionMode | null
    runtime?: RuntimeSelection | null
    title: { text: string; source: TitleSource } | null
    workDir: string
    projectRoot: string | null
    repository?: PreparedSessionWorkspace['repository']
    workDirExists: boolean
  } | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null
    const entries = await this.readJsonlFile(found.filePath)
    const workDir = this.resolveWorkDirFromEntries(entries, found.projectDir) || ''
    const repository = this.resolveRepositoryFromEntries(entries)
    const runtime = runtimeSelectionFromTranscriptEntries(entries)
    return {
      permissionMode: permissionModeFromTranscriptEntries(entries),
      ...(runtime !== undefined ? { runtime } : {}),
      title: this.extractTitleWithSource(entries),
      workDir,
      projectRoot: workDir ? await this.resolveProjectRootFromEntries(entries, workDir, found.projectDir) : null,
      ...(repository ? { repository } : {}),
      workDirExists: workDir ? await this.pathExists(workDir) : false,
    }
  }

  async getSessionPermissionMode(sessionId: string): Promise<PermissionMode | null> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return null
    return permissionModeFromTranscriptEntries(await this.readJsonlFile(found.filePath))
  }

  appendSessionPermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<void> {
    return this.appendSessionEntry(sessionId, this.permissionModeEntry(sessionId, permissionMode))
  }

  appendSessionRuntimeConfig(sessionId: string, runtime: RuntimeSelection | null): Promise<void> {
    return this.appendSessionEntry(sessionId, this.runtimeConfigEntry(sessionId, runtime))
  }

  private appendSessionEntry(sessionId: string, entry: Record<string, unknown>): Promise<void> {
    return this.enqueueSessionWrite(sessionId, async () => {
      const found = await this.writableSessionFile(sessionId)
      if (!found) return
      await this.appendJsonlEntry(found.filePath, entry)
    })
  }

  private permissionModeEntry(sessionId: string, permissionMode: PermissionMode): Record<string, unknown> {
    return { type: 'permission-mode', permissionMode, sessionId, timestamp: new Date().toISOString() }
  }

  private runtimeConfigEntry(sessionId: string, runtime: RuntimeSelection | null): Record<string, unknown> {
    return { type: 'runtime-config', runtime, sessionId, timestamp: new Date().toISOString() }
  }

  appendSessionMetadata(
    sessionId: string,
    metadata: {
      workDir: string
      customTitle?: string | null
      repository?: PreparedSessionWorkspace['repository']
    }
  ): Promise<void> {
    return this.enqueueSessionWrite(sessionId, async () => {
      const found = await this.writableSessionFile(sessionId)
      if (!found) return
      const entries = await this.readJsonlFile(found.filePath)
      const workDir = normalizeDriveRootPathForPlatform(metadata.workDir)
      const repository = metadata.repository ?? this.resolveRepositoryFromEntries(entries)
      const lastMeta = lastEntryOfType(entries, 'session-meta')
      if (
        !lastMeta ||
        lastMeta.workDir !== workDir ||
        JSON.stringify(lastMeta.repository ?? null) !== JSON.stringify(repository ?? null)
      ) {
        await this.appendJsonlEntry(found.filePath, {
          type: 'session-meta',
          isMeta: true,
          workDir,
          repository,
          timestamp: new Date().toISOString(),
        })
      }
      if (metadata.customTitle && lastEntryOfType(entries, 'custom-title')?.customTitle !== metadata.customTitle) {
        await this.appendJsonlEntry(found.filePath, this.customTitleEntry(metadata.customTitle))
      }
    })
  }

  trimSessionMessagesFrom(
    sessionId: string,
    startMessageId: string,
  ): Promise<TrimSessionResult> {
    return this.enqueueSessionWrite(sessionId, () => this.trimSessionFile(sessionId, startMessageId))
  }

  private async trimSessionFile(
    sessionId: string,
    startMessageId: string,
  ): Promise<TrimSessionResult> {
    const found = await this.writableSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const activeMessages = entriesToMessages(entries)
    const startIndex = activeMessages.findIndex((message) => message.id === startMessageId)

    if (startIndex < 0) {
      throw ApiError.badRequest(`Message not found in active session chain: ${startMessageId}`)
    }

    const removedMessageIds = activeMessages
      .slice(startIndex)
      .map((message) => message.id)
    const remainingMessageIds = new Set(
      activeMessages
        .slice(0, startIndex)
        .map((message) => message.id),
    )

    if (removedMessageIds.length === 0) {
      return { removedCount: 0, removedMessageIds: [] }
    }

    const removedIds = new Set(removedMessageIds)
    const filteredEntries = entries.filter(
      (entry) => {
        if (typeof entry.uuid !== 'string') return true
        if (removedIds.has(entry.uuid)) return false
        if (
          entry.message?.role &&
          (entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system')
        ) {
          return remainingMessageIds.has(entry.uuid)
        }
        return true
      },
    )

    const content =
      filteredEntries.length > 0
        ? filteredEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
        : ''
    await fs.writeFile(found.filePath, content, 'utf-8')

    return {
      removedCount: removedMessageIds.length,
      removedMessageIds,
    }
  }

  async getSessionFileHistorySnapshots(
    sessionId: string,
  ): Promise<FileHistorySnapshot[]> {
    const found = await this.findSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const snapshotsByMessageId = new Map<string, FileHistorySnapshot>()

    for (const entry of entries) {
      if (entry.type !== 'file-history-snapshot' || !entry.snapshot) continue

      const snapshotMessageId =
        typeof entry.snapshot.messageId === 'string'
          ? entry.snapshot.messageId
          : typeof entry.messageId === 'string'
            ? entry.messageId
            : null

      if (!snapshotMessageId) continue

      snapshotsByMessageId.set(snapshotMessageId, {
        messageId: snapshotMessageId as FileHistorySnapshot['messageId'],
        trackedFileBackups:
          entry.snapshot.trackedFileBackups &&
          typeof entry.snapshot.trackedFileBackups === 'object'
            ? (entry.snapshot.trackedFileBackups as FileHistorySnapshot['trackedFileBackups'])
            : {},
        timestamp: new Date(
          entry.snapshot.timestamp || entry.timestamp || new Date().toISOString(),
        ),
      })
    }

    return [...snapshotsByMessageId.values()]
  }

  /** Reads the session file once and interprets it into display items. */
  async getSessionTranscript(sessionId: string): Promise<SessionTranscript> {
    const found = await this.findSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.readJsonlFile(found.filePath)
    const messages = await this.appendSubagentToolMessages(
      found.projectDir,
      sessionId,
      entriesToMessages(entries),
    )
    return buildSessionTranscript(messages, collectTaskNotifications(entries))
  }

  private async pathExists(targetPath: string | null): Promise<boolean> {
    if (!targetPath) return false

    try {
      const stat = await fs.stat(targetPath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }
}

export const sessionService = new SessionService()
