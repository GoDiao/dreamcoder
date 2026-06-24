import type { UUID } from 'crypto'
import { chmod, copyFile, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createTwoFilesPatch, diffLines } from 'diff'
import { ApiError } from '../middleware/errorHandler.js'
import {
  type FileHistorySnapshot,
} from '../../utils/fileHistory.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { conversationService } from './conversationService.js'
import { sessionService, type MessageEntry } from './sessionService.js'

type RewindTarget = {
  targetUserMessageId: string
  userMessageIndex: number
  userMessageCount: number
  messagesRemoved: number
}

type RewindCodePreview = {
  available: boolean
  reason?: string
  filesChanged: string[]
  insertions: number
  deletions: number
}

type TranscriptFileChange = {
  path: string
  absolutePath: string
  additions: number
  deletions: number
  diff?: string
}

export type RewindTargetSelector = {
  targetUserMessageId?: string
  userMessageIndex?: number
  expectedContent?: string
}

export type SessionRewindPreview = {
  target: {
    targetUserMessageId: string
    userMessageIndex: number
    userMessageCount: number
  }
  conversation: {
    messagesRemoved: number
  }
  code: RewindCodePreview
}

export type SessionRewindExecuteResult = SessionRewindPreview & {
  conversation: SessionRewindPreview['conversation'] & {
    removedMessageIds: string[]
  }
}

export type SessionTurnCheckpointPreview = SessionRewindPreview & {
  workDir: string
}

export type SessionTurnCheckpointDiffResult = {
  target: SessionRewindPreview['target']
  workDir: string
  path: string
  state: 'ok' | 'missing' | 'error'
  diff?: string
  error?: string
}

function normalizeDiffStats(diffStats: {
  filesChanged?: string[]
  insertions?: number
  deletions?: number
} | undefined): RewindCodePreview {
  return {
    available: true,
    filesChanged: diffStats?.filesChanged ?? [],
    insertions: diffStats?.insertions ?? 0,
    deletions: diffStats?.deletions ?? 0,
  }
}

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function extractUserPromptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .join('\n')
}

function assertExpectedPromptMatches(
  targetMessage: { content: unknown },
  expectedContent: string | undefined,
): void {
  if (expectedContent === undefined) return

  const actual = normalizePromptText(extractUserPromptText(targetMessage.content))
  const expected = normalizePromptText(expectedContent)
  if (actual !== expected) {
    throw ApiError.badRequest(
      'The resolved rewind target does not match the selected prompt. Refresh the session and try again.',
    )
  }
}

async function resolveRewindTarget(
  sessionId: string,
  selector: RewindTargetSelector,
): Promise<RewindTarget> {
  const activeMessages = await sessionService.getSessionMessages(sessionId)
  const userMessages = activeMessages.filter((message) => message.type === 'user')

  if (userMessages.length === 0) {
    throw ApiError.badRequest('This session has no user messages to rewind.')
  }

  let targetUserMessage = null as (typeof userMessages)[number] | null
  let userMessageIndex = -1

  if (selector.targetUserMessageId) {
    const activeMessage = activeMessages.find(
      (message) => message.id === selector.targetUserMessageId,
    )
    if (activeMessage) {
      if (activeMessage.type !== 'user') {
        throw ApiError.badRequest('The selected rewind target is not a user message.')
      }
      targetUserMessage = activeMessage
      userMessageIndex = userMessages.findIndex(
        (message) => message.id === activeMessage.id,
      )
    }
  }

  if (!targetUserMessage && Number.isInteger(selector.userMessageIndex)) {
    userMessageIndex = selector.userMessageIndex!
    if (userMessageIndex >= 0 && userMessageIndex < userMessages.length) {
      targetUserMessage = userMessages[userMessageIndex]!
    }
  }

  if (
    !targetUserMessage ||
    userMessageIndex < 0 ||
    userMessageIndex >= userMessages.length
  ) {
    throw ApiError.badRequest(
      `Invalid rewind target. Expected targetUserMessageId or userMessageIndex 0-${userMessages.length - 1}.`,
    )
  }

  assertExpectedPromptMatches(targetUserMessage, selector.expectedContent)

  const activeMessageIndex = activeMessages.findIndex(
    (message) => message.id === targetUserMessage.id,
  )

  if (activeMessageIndex < 0) {
    throw ApiError.badRequest('The selected user message is not in the active chain.')
  }

  return {
    targetUserMessageId: targetUserMessage.id,
    userMessageIndex,
    userMessageCount: userMessages.length,
    messagesRemoved: activeMessages.length - activeMessageIndex,
  }
}

async function loadFileHistorySnapshots(
  sessionId: string,
): Promise<FileHistorySnapshot[] | null> {
  const snapshots = await sessionService.getSessionFileHistorySnapshots(sessionId)
  if (snapshots.length === 0) {
    return null
  }

  return snapshots
}

function expandTrackingPath(workDir: string, trackingPath: string): string {
  return isAbsolute(trackingPath) ? trackingPath : join(workDir, trackingPath)
}

function resolveBackupPath(sessionId: string, backupFileName: string): string {
  return join(getClaudeConfigHomeDir(), 'file-history', sessionId, backupFileName)
}

function collectTrackedPaths(
  snapshots: FileHistorySnapshot[],
): Set<string> {
  const trackedPaths = new Set<string>()
  for (const snapshot of snapshots) {
    for (const trackingPath of Object.keys(snapshot.trackedFileBackups)) {
      trackedPaths.add(trackingPath)
    }
  }
  return trackedPaths
}

function findTargetSnapshot(
  snapshots: FileHistorySnapshot[],
  targetUserMessageId: string,
): FileHistorySnapshot | null {
  return (
    snapshots.findLast((snapshot) => snapshot.messageId === (targetUserMessageId as UUID)) ??
    null
  )
}

function getEarliestBackupFileName(
  trackingPath: string,
  snapshots: FileHistorySnapshot[],
): string | null | undefined {
  for (const snapshot of snapshots) {
    const backup = snapshot.trackedFileBackups[trackingPath]
    if (backup !== undefined) {
      return backup.backupFileName
    }
  }

  return undefined
}

function getBackupFileNameForTarget(
  trackingPath: string,
  snapshots: FileHistorySnapshot[],
  targetSnapshot: FileHistorySnapshot,
): string | null | undefined {
  const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]
  if (targetBackup && 'backupFileName' in targetBackup) {
    return targetBackup.backupFileName
  }

  return getEarliestBackupFileName(trackingPath, snapshots)
}

async function resolveSessionWorkDir(sessionId: string): Promise<string> {
  return (
    (conversationService.hasSession(sessionId)
      ? conversationService.getSessionWorkDir(sessionId)
      : null) ||
    (await sessionService.getSessionWorkDir(sessionId)) ||
    process.cwd()
  )
}

async function resolveCheckpointBaseDir(
  sessionId: string,
  targetUserMessageId: string,
  fallbackWorkDir?: string,
): Promise<string> {
  return (
    (await sessionService.getSessionMessageCwd(sessionId, targetUserMessageId)) ||
    fallbackWorkDir ||
    (await resolveSessionWorkDir(sessionId))
  )
}

function normalizeComparablePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function toCheckpointResponsePath(
  trackingPath: string,
  checkpointBaseDir: string,
): string {
  if (isAbsolute(trackingPath)) {
    return trackingPath
  }

  const absolutePath = expandTrackingPath(checkpointBaseDir, trackingPath)
  const relativePath = normalizeComparablePath(relative(checkpointBaseDir, absolutePath))
  return relativePath && !relativePath.startsWith('../')
    ? relativePath
    : normalizeComparablePath(trackingPath)
}

function matchesCheckpointPath(
  requestedPath: string,
  trackingPath: string,
  checkpointBaseDir: string,
): boolean {
  const normalizedRequestedPath = normalizeComparablePath(requestedPath)
  const absolutePath = normalizeComparablePath(
    expandTrackingPath(checkpointBaseDir, trackingPath),
  )
  const responsePath = normalizeComparablePath(
    toCheckpointResponsePath(trackingPath, checkpointBaseDir),
  )

  return normalizedRequestedPath === absolutePath ||
    normalizedRequestedPath === normalizeComparablePath(trackingPath) ||
    normalizedRequestedPath === responsePath
}

function buildTurnPreview(
  target: RewindTarget,
  preview: RewindCodePreview,
  workDir: string,
): SessionTurnCheckpointPreview {
  return {
    target: {
      targetUserMessageId: target.targetUserMessageId,
      userMessageIndex: target.userMessageIndex,
      userMessageCount: target.userMessageCount,
    },
    conversation: {
      messagesRemoved: target.messagesRemoved,
    },
    code: preview,
    workDir,
  }
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

function countInsertedLines(content: string): number {
  return diffLines('', content).reduce((total, change) => (
    change.added ? total + (change.count || 0) : total
  ), 0)
}

function buildCheckpointDiff(
  displayPath: string,
  oldContent: string,
  newContent: string,
  oldExists: boolean,
  newExists: boolean,
): string {
  const oldFileName = oldExists ? `a/${displayPath}` : '/dev/null'
  const newFileName = newExists ? `b/${displayPath}` : '/dev/null'

  return createTwoFilesPatch(
    oldFileName,
    newFileName,
    oldContent,
    newContent,
    '',
    '',
    { context: 3 },
  )
}

async function readBackupContent(
  sessionId: string,
  backupFileName: string | null | undefined,
): Promise<string | null | undefined> {
  if (backupFileName === undefined) return undefined
  if (backupFileName === null) return null
  return await readFileOrNull(resolveBackupPath(sessionId, backupFileName))
}

function countTurnDiffStats(
  beforeContent: string | null,
  afterContent: string | null,
): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const change of diffLines(beforeContent ?? '', afterContent ?? '')) {
    if (change.added) insertions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return { insertions, deletions }
}

function getTurnMessageRange(
  activeMessages: Awaited<ReturnType<typeof sessionService.getSessionMessages>>,
  targetUserMessageId: string,
): { start: number; end: number } | null {
  const start = activeMessages.findIndex((message) => message.id === targetUserMessageId)
  if (start < 0) return null
  const nextUserIndex = activeMessages.findIndex(
    (message, index) => index > start && message.type === 'user',
  )
  return { start, end: nextUserIndex >= 0 ? nextUserIndex : activeMessages.length }
}

function hasCompletedTurn(
  activeMessages: Awaited<ReturnType<typeof sessionService.getSessionMessages>>,
  targetUserMessageId: string,
): boolean {
  const range = getTurnMessageRange(activeMessages, targetUserMessageId)
  if (!range) return false
  return activeMessages.slice(range.start + 1, range.end).some((message) =>
    message.type === 'assistant' ||
    message.type === 'tool_use' ||
    message.type === 'tool_result' ||
    message.type === 'error',
  )
}

function getNextUserMessageId(
  userMessages: Awaited<ReturnType<typeof sessionService.getSessionMessages>>,
  userMessageIndex: number,
): string | null {
  return userMessages[userMessageIndex + 1]?.id ?? null
}

function isWithinBaseDir(absolutePath: string, baseDir: string): boolean {
  const relativePath = relative(baseDir, absolutePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function normalizeTranscriptRelativePath(filePath: string): string {
  return normalizeComparablePath(filePath).replace(/^\/+/, '')
}

function resolveTranscriptToolPath(
  filePath: unknown,
  baseDir: string,
): { path: string; absolutePath: string } | null {
  if (typeof filePath !== 'string' || !filePath.trim()) return null
  const normalizedBaseDir = resolve(baseDir)
  const absolutePath = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(normalizedBaseDir, filePath)
  if (!isWithinBaseDir(absolutePath, normalizedBaseDir)) return null

  return {
    path: normalizeTranscriptRelativePath(relative(normalizedBaseDir, absolutePath)),
    absolutePath,
  }
}

function countTranscriptLines(content: string): number {
  if (!content) return 0
  const lines = content.split(/\r\n|\r|\n/)
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.length
}

function buildTranscriptDiff(
  oldPath: string,
  newPath: string,
  oldContent: string,
  newContent: string,
): string {
  const oldLines = oldContent ? oldContent.split('\n') : []
  const newLines = newContent ? newContent.split('\n') : []
  if (oldLines.at(-1) === '') oldLines.pop()
  if (newLines.at(-1) === '') newLines.pop()

  return [
    `diff --session a/${oldPath} b/${newPath}`,
    `--- ${oldPath === '/dev/null' ? '/dev/null' : `a/${oldPath}`}`,
    `+++ b/${newPath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join('\n')
}

function buildTranscriptEditChange(
  filePath: { path: string; absolutePath: string },
  input: Record<string, unknown>,
): TranscriptFileChange {
  const oldString = typeof input.old_string === 'string' ? input.old_string : ''
  const newString = typeof input.new_string === 'string' ? input.new_string : ''
  return {
    path: filePath.path,
    absolutePath: filePath.absolutePath,
    additions: countTranscriptLines(newString),
    deletions: countTranscriptLines(oldString),
    diff: buildTranscriptDiff(filePath.path, filePath.path, oldString, newString),
  }
}

function extractApplyPatchTranscriptChanges(
  patch: unknown,
  baseDir: string,
): TranscriptFileChange[] {
  if (typeof patch !== 'string') return []
  const changes: TranscriptFileChange[] = []

  for (const line of patch.split('\n')) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
    if (!match?.[1]) continue
    const filePath = resolveTranscriptToolPath(match[1], baseDir)
    if (!filePath) continue
    changes.push({
      path: filePath.path,
      absolutePath: filePath.absolutePath,
      additions: 0,
      deletions: 0,
    })
  }

  return changes
}

function extractTranscriptChangesFromTool(
  toolName: string,
  input: Record<string, unknown>,
  baseDir: string,
): TranscriptFileChange[] {
  const normalizedToolName = toolName.toLowerCase()
  if (normalizedToolName === 'write') {
    const filePath = resolveTranscriptToolPath(input.file_path ?? input.path, baseDir)
    if (!filePath) return []
    const content = typeof input.content === 'string' ? input.content : ''
    return [{
      path: filePath.path,
      absolutePath: filePath.absolutePath,
      additions: countTranscriptLines(content),
      deletions: 0,
      diff: buildTranscriptDiff('/dev/null', filePath.path, '', content),
    }]
  }

  if (normalizedToolName === 'edit') {
    const filePath = resolveTranscriptToolPath(input.file_path ?? input.path, baseDir)
    if (!filePath) return []
    return [buildTranscriptEditChange(filePath, input)]
  }

  if (normalizedToolName === 'multiedit') {
    const filePath = resolveTranscriptToolPath(input.file_path ?? input.path, baseDir)
    if (!filePath || !Array.isArray(input.edits)) return []
    return input.edits
      .filter((edit): edit is Record<string, unknown> => !!edit && typeof edit === 'object')
      .map((edit) => buildTranscriptEditChange(filePath, edit))
  }

  if (normalizedToolName === 'notebookedit') {
    const filePath = resolveTranscriptToolPath(
      input.notebook_path ?? input.file_path ?? input.path,
      baseDir,
    )
    if (!filePath) return []
    const oldString = typeof input.old_source === 'string' ? input.old_source : ''
    const newString = typeof input.new_source === 'string' ? input.new_source : ''
    return [{
      path: filePath.path,
      absolutePath: filePath.absolutePath,
      additions: countTranscriptLines(newString),
      deletions: countTranscriptLines(oldString),
      diff: buildTranscriptDiff(filePath.path, filePath.path, oldString, newString),
    }]
  }

  if (normalizedToolName === 'apply_patch') {
    return extractApplyPatchTranscriptChanges(input.patch, baseDir)
  }

  return []
}

function getToolUseIds(messages: MessageEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'tool_use' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (record.type === 'tool_use' && typeof record.id === 'string') {
        ids.add(record.id)
      }
    }
  }
  return ids
}

function getTranscriptTurnMessages(
  activeMessages: MessageEntry[],
  targetUserMessageId: string,
): MessageEntry[] {
  const range = getTurnMessageRange(activeMessages, targetUserMessageId)
  if (!range) return []

  const rawTurnMessages = activeMessages.slice(range.start + 1, range.end)
  const parentTurnMessages = rawTurnMessages.filter((message) => !message.parentToolUseId)
  const turnToolUseIds = getToolUseIds(parentTurnMessages)
  if (turnToolUseIds.size === 0) return parentTurnMessages

  const inlineChildMessages = rawTurnMessages.filter((message) =>
    message.parentToolUseId && turnToolUseIds.has(message.parentToolUseId)
  )
  const turnMessages = [...parentTurnMessages, ...inlineChildMessages]
  const includedIds = new Set(turnMessages.map((message) => message.id))
  const childMessages = activeMessages.filter((message) =>
    message.parentToolUseId &&
    turnToolUseIds.has(message.parentToolUseId) &&
    !includedIds.has(message.id)
  )

  return [...turnMessages, ...childMessages]
}

function collectTranscriptTurnFileChanges(
  activeMessages: MessageEntry[],
  targetUserMessageId: string,
  baseDir: string,
): TranscriptFileChange[] {
  const turnMessages = getTranscriptTurnMessages(activeMessages, targetUserMessageId)
  if (turnMessages.length === 0) return []

  const changes = new Map<string, TranscriptFileChange>()
  for (const message of turnMessages) {
    if (message.type !== 'tool_use' || !Array.isArray(message.content)) continue

    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (record.type !== 'tool_use' || typeof record.name !== 'string') continue
      const input = record.input
      if (!input || typeof input !== 'object') continue

      for (const change of extractTranscriptChangesFromTool(
        record.name,
        input as Record<string, unknown>,
        baseDir,
      )) {
        const existing = changes.get(change.path)
        if (!existing) {
          changes.set(change.path, change)
          continue
        }

        changes.set(change.path, {
          ...existing,
          additions: existing.additions + change.additions,
          deletions: existing.deletions + change.deletions,
          diff: [existing.diff, change.diff].filter(Boolean).join('\n'),
        })
      }
    }
  }

  return [...changes.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function buildTranscriptTurnCodePreview(
  activeMessages: MessageEntry[],
  targetUserMessageId: string,
  baseDir: string,
): RewindCodePreview {
  const changes = collectTranscriptTurnFileChanges(activeMessages, targetUserMessageId, baseDir)
  if (changes.length === 0) {
    return {
      available: false,
      reason: 'No transcript file changes were recorded for this turn.',
      filesChanged: [],
      insertions: 0,
      deletions: 0,
    }
  }

  return normalizeDiffStats({
    filesChanged: changes.map((change) => change.absolutePath),
    insertions: changes.reduce((total, change) => total + change.additions, 0),
    deletions: changes.reduce((total, change) => total + change.deletions, 0),
  })
}

function findTranscriptTurnDiff(
  activeMessages: MessageEntry[],
  targetUserMessageId: string,
  baseDir: string,
  requestedPath: string,
): TranscriptFileChange | null {
  const changes = collectTranscriptTurnFileChanges(activeMessages, targetUserMessageId, baseDir)
  return changes.find((change) =>
    matchesCheckpointPath(requestedPath, change.path, baseDir) ||
    normalizeComparablePath(requestedPath) === normalizeComparablePath(change.absolutePath)
  ) ?? null
}

async function getTurnBoundaryContents(
  sessionId: string,
  checkpointBaseDir: string,
  trackingPath: string,
  targetSnapshot: FileHistorySnapshot,
  nextSnapshot: FileHistorySnapshot | null,
): Promise<{ beforeContent: string | null; afterContent: string | null }> {
  const absolutePath = expandTrackingPath(checkpointBaseDir, trackingPath)
  const beforeContent = await readBackupContent(
    sessionId,
    targetSnapshot.trackedFileBackups[trackingPath]?.backupFileName,
  )

  if (!nextSnapshot) {
    return {
      beforeContent: beforeContent ?? null,
      afterContent: await readFileOrNull(absolutePath),
    }
  }

  const nextContent = await readBackupContent(
    sessionId,
    nextSnapshot.trackedFileBackups[trackingPath]?.backupFileName,
  )

  return {
    beforeContent: beforeContent ?? null,
    afterContent: nextContent === undefined ? beforeContent ?? null : nextContent,
  }
}

async function buildTurnCodePreview(
  sessionId: string,
  checkpointBaseDir: string,
  targetSnapshot: FileHistorySnapshot,
  nextSnapshot: FileHistorySnapshot | null,
): Promise<RewindCodePreview> {
  const trackedPaths = new Set([
    ...Object.keys(targetSnapshot.trackedFileBackups),
    ...Object.keys(nextSnapshot?.trackedFileBackups ?? {}),
  ])
  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0

  for (const trackingPath of trackedPaths) {
    const { beforeContent, afterContent } = await getTurnBoundaryContents(
      sessionId,
      checkpointBaseDir,
      trackingPath,
      targetSnapshot,
      nextSnapshot,
    )
    if (beforeContent === afterContent) continue

    filesChanged.push(expandTrackingPath(checkpointBaseDir, trackingPath))
    const stats = countTurnDiffStats(beforeContent, afterContent)
    insertions += stats.insertions
    deletions += stats.deletions
  }

  return normalizeDiffStats({ filesChanged, insertions, deletions })
}

async function hasFileChanged(
  filePath: string,
  backupFilePath: string,
): Promise<boolean> {
  try {
    const [currentStat, backupStat] = await Promise.all([
      stat(filePath),
      stat(backupFilePath),
    ])

    if (currentStat.size !== backupStat.size) {
      return true
    }

    const [currentContent, backupContent] = await Promise.all([
      readFile(filePath),
      readFile(backupFilePath),
    ])
    return !currentContent.equals(backupContent)
  } catch {
    return true
  }
}

async function restoreBackupFile(
  filePath: string,
  backupFilePath: string,
): Promise<void> {
  const backupStats = await stat(backupFilePath)
  try {
    await copyFile(backupFilePath, filePath)
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException
    if (maybeErr.code !== 'ENOENT') throw error
    await mkdir(dirname(filePath), { recursive: true })
    await copyFile(backupFilePath, filePath)
  }
  await chmod(filePath, backupStats.mode)
}

async function buildCodePreview(
  sessionId: string,
  checkpointBaseDir: string,
  targetUserMessageId: string,
): Promise<{
  snapshots: FileHistorySnapshot[] | null
  preview: RewindCodePreview
}> {
  const snapshots = await loadFileHistorySnapshots(sessionId)
  if (!snapshots) {
    return {
      snapshots: null,
      preview: {
        available: false,
        reason: 'No file checkpoints were recorded for this session.',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
    }
  }

  const targetSnapshot = findTargetSnapshot(snapshots, targetUserMessageId)
  if (!targetSnapshot) {
    return {
      snapshots,
      preview: {
        available: false,
        reason: 'No file checkpoint is available for the selected message.',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
    }
  }

  const trackedPaths = collectTrackedPaths(snapshots)
  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0

  for (const trackingPath of trackedPaths) {
    const backupFileName = getBackupFileNameForTarget(
      trackingPath,
      snapshots,
      targetSnapshot,
    )

    if (backupFileName === undefined) continue

    const absolutePath = expandTrackingPath(checkpointBaseDir, trackingPath)

    if (backupFileName === null) {
      const currentContent = await readFileOrNull(absolutePath)
      if (currentContent !== null) {
        filesChanged.push(absolutePath)
        insertions += countInsertedLines(currentContent)
      }
      continue
    }

    const backupFilePath = resolveBackupPath(sessionId, backupFileName)
    if (!(await hasFileChanged(absolutePath, backupFilePath))) {
      continue
    }

    filesChanged.push(absolutePath)
    const [currentContent, backupContent] = await Promise.all([
      readFileOrNull(absolutePath),
      readFileOrNull(backupFilePath),
    ])
    for (const change of diffLines(currentContent ?? '', backupContent ?? '')) {
      if (change.added) {
        insertions += change.count || 0
      }
      if (change.removed) {
        deletions += change.count || 0
      }
    }
  }

  return {
    snapshots,
    preview: normalizeDiffStats({
      filesChanged,
      insertions,
      deletions,
    }),
  }
}

export async function previewSessionRewind(
  sessionId: string,
  selector: RewindTargetSelector,
): Promise<SessionRewindPreview> {
  const target = await resolveRewindTarget(sessionId, selector)
  const workDir = await resolveSessionWorkDir(sessionId)
  const checkpointBaseDir = await resolveCheckpointBaseDir(
    sessionId,
    target.targetUserMessageId,
    workDir,
  )
  const { preview } = await buildCodePreview(
    sessionId,
    checkpointBaseDir,
    target.targetUserMessageId,
  )

  return {
    target: {
      targetUserMessageId: target.targetUserMessageId,
      userMessageIndex: target.userMessageIndex,
      userMessageCount: target.userMessageCount,
    },
    conversation: {
      messagesRemoved: target.messagesRemoved,
    },
    code: preview,
  }
}

export async function listSessionTurnCheckpoints(
  sessionId: string,
): Promise<SessionTurnCheckpointPreview[]> {
  const activeMessages = await sessionService.getSessionMessages(sessionId)
  const userMessages = activeMessages.filter((message) => message.type === 'user')
  if (userMessages.length === 0) {
    return []
  }

  const workDir = await resolveSessionWorkDir(sessionId)
  const snapshots = await loadFileHistorySnapshots(sessionId)
  const checkpoints: SessionTurnCheckpointPreview[] = []

  for (const [userMessageIndex, userMessage] of userMessages.entries()) {
    const activeMessageIndex = activeMessages.findIndex(
      (message) => message.id === userMessage.id,
    )
    if (activeMessageIndex < 0) continue
    if (!hasCompletedTurn(activeMessages, userMessage.id)) continue

    const target: RewindTarget = {
      targetUserMessageId: userMessage.id,
      userMessageIndex,
      userMessageCount: userMessages.length,
      messagesRemoved: activeMessages.length - activeMessageIndex,
    }
    const checkpointBaseDir = await resolveCheckpointBaseDir(
      sessionId,
      target.targetUserMessageId,
      workDir,
    )
    const targetSnapshot = snapshots ? findTargetSnapshot(snapshots, target.targetUserMessageId) : null
    const nextUserMessageId = getNextUserMessageId(userMessages, userMessageIndex)
    const nextSnapshot = nextUserMessageId && snapshots
      ? findTargetSnapshot(snapshots, nextUserMessageId)
      : null
    const checkpointPreview = targetSnapshot
      ? await buildTurnCodePreview(sessionId, checkpointBaseDir, targetSnapshot, nextSnapshot)
      : null
    const preview = checkpointPreview?.available && checkpointPreview.filesChanged.length > 0
      ? checkpointPreview
      : buildTranscriptTurnCodePreview(
          activeMessages,
          target.targetUserMessageId,
          checkpointBaseDir,
        )

    if (!preview.available || preview.filesChanged.length === 0) continue
    checkpoints.push(buildTurnPreview(target, preview, checkpointBaseDir))
  }

  return checkpoints
}

export async function getSessionTurnCheckpointDiff(
  sessionId: string,
  selector: RewindTargetSelector,
  requestedPath: string,
): Promise<SessionTurnCheckpointDiffResult> {
  const target = await resolveRewindTarget(sessionId, selector)
  const workDir = await resolveSessionWorkDir(sessionId)
  const checkpointBaseDir = await resolveCheckpointBaseDir(
    sessionId,
    target.targetUserMessageId,
    workDir,
  )
  const activeMessages = await sessionService.getSessionMessages(sessionId)
  const snapshots = await loadFileHistorySnapshots(sessionId)
  const missingResult = {
    target: buildTurnPreview(
      target,
      {
        available: false,
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      },
      checkpointBaseDir,
    ).target,
    workDir: checkpointBaseDir,
    path: normalizeComparablePath(requestedPath),
    state: 'missing' as const,
  }
  const transcriptChange = findTranscriptTurnDiff(
    activeMessages,
    target.targetUserMessageId,
    checkpointBaseDir,
    requestedPath,
  )
  const transcriptResult = transcriptChange?.diff
    ? {
        target: missingResult.target,
        workDir: checkpointBaseDir,
        path: transcriptChange.path,
        state: 'ok' as const,
        diff: transcriptChange.diff,
      }
    : null

  if (!snapshots) {
    return transcriptResult ?? missingResult
  }

  const targetSnapshot = findTargetSnapshot(snapshots, target.targetUserMessageId)
  if (!targetSnapshot) {
    return transcriptResult ?? missingResult
  }
  const userMessages = activeMessages.filter((message) => message.type === 'user')
  const nextUserMessageId = getNextUserMessageId(userMessages, target.userMessageIndex)
  const nextSnapshot = nextUserMessageId
    ? findTargetSnapshot(snapshots, nextUserMessageId)
    : null

  for (const trackingPath of new Set([
    ...Object.keys(targetSnapshot.trackedFileBackups),
    ...Object.keys(nextSnapshot?.trackedFileBackups ?? {}),
  ])) {
    if (!matchesCheckpointPath(requestedPath, trackingPath, checkpointBaseDir)) {
      continue
    }

    const displayPath = toCheckpointResponsePath(trackingPath, checkpointBaseDir)

    try {
      const { beforeContent, afterContent } = await getTurnBoundaryContents(
        sessionId,
        checkpointBaseDir,
        trackingPath,
        targetSnapshot,
        nextSnapshot,
      )

      if (beforeContent === afterContent) {
        return {
          ...missingResult,
          path: displayPath,
        }
      }

      return {
        target: missingResult.target,
        workDir: checkpointBaseDir,
        path: displayPath,
        state: 'ok',
        diff: buildCheckpointDiff(
          displayPath,
          beforeContent ?? '',
          afterContent ?? '',
          beforeContent !== null,
          afterContent !== null,
        ),
      }
    } catch (error) {
      return {
        target: missingResult.target,
        workDir: checkpointBaseDir,
        path: displayPath,
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return transcriptResult ?? missingResult
}

export async function executeSessionRewind(
  sessionId: string,
  selector: RewindTargetSelector,
): Promise<SessionRewindExecuteResult> {
  const target = await resolveRewindTarget(sessionId, selector)
  const workDir = await resolveSessionWorkDir(sessionId)
  const checkpointBaseDir = await resolveCheckpointBaseDir(
    sessionId,
    target.targetUserMessageId,
    workDir,
  )
  const { snapshots, preview } = await buildCodePreview(
    sessionId,
    checkpointBaseDir,
    target.targetUserMessageId,
  )

  await conversationService.stopSessionAndWait(sessionId)

  if (preview.available && snapshots) {
    const targetSnapshot = findTargetSnapshot(snapshots, target.targetUserMessageId)
    if (!targetSnapshot) {
      throw ApiError.badRequest('No file checkpoint is available for the selected message.')
    }

    for (const trackingPath of collectTrackedPaths(snapshots)) {
      const backupFileName = getBackupFileNameForTarget(
        trackingPath,
        snapshots,
        targetSnapshot,
      )

      if (backupFileName === undefined) continue

      const absolutePath = expandTrackingPath(checkpointBaseDir, trackingPath)

      if (backupFileName === null) {
        try {
          await unlink(absolutePath)
        } catch (error) {
          const maybeErr = error as NodeJS.ErrnoException
          if (maybeErr.code !== 'ENOENT') throw error
        }
        continue
      }

      await restoreBackupFile(
        absolutePath,
        resolveBackupPath(sessionId, backupFileName),
      )
    }
  }

  const trimResult = await sessionService.trimSessionMessagesFrom(
    sessionId,
    target.targetUserMessageId,
  )

  return {
    target: {
      targetUserMessageId: target.targetUserMessageId,
      userMessageIndex: target.userMessageIndex,
      userMessageCount: target.userMessageCount,
    },
    conversation: {
      messagesRemoved: trimResult.removedCount,
      removedMessageIds: trimResult.removedMessageIds,
    },
    code: preview,
  }
}
