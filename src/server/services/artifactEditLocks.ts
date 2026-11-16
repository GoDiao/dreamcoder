import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SDKControlArtifactEditWaitRequestSchema } from '../../entrypoints/sdk/controlSchemas.js'
import { ARTIFACT_EDIT_WAIT_SUBTYPE } from '../../utils/artifactEditLock.js'
import { artifactFolderContaining, readArtifactEntry } from '../../utils/artifacts.js'
import { sessionStateStore, type SessionStateStore } from '../session/state/store.js'
import type { ArtifactWait } from '../session/state/types.js'
import { conversationService, type HostRequest } from './conversationService.js'

const ARTIFACT_EDIT_HOLD_MS = 20_000

type Lock = { holders: Map<string, ReturnType<typeof setTimeout>>; files: Set<string>; waiters: Array<(files: string[]) => void> }

async function lockKey(folder: string): Promise<string> {
  try {
    return (await fs.realpath(folder)).normalize('NFC')
  } catch {
    return path.resolve(folder).normalize('NFC')
  }
}

async function titleOf(folder: string): Promise<string> {
  const entry = await readArtifactEntry(path.dirname(folder), path.basename(folder)).catch(() => null)
  return entry?.manifest?.title || path.basename(folder)
}

export function createArtifactEditLocks(
  holdMs = ARTIFACT_EDIT_HOLD_MS,
  store: Pick<SessionStateStore, 'apply' | 'applyIfPresent'> = sessionStateStore,
) {
  const locks = new Map<string, Lock>()
  const waitsBySession = new Map<string, Map<string, ArtifactWait>>()

  function publish(sessionId: string) {
    const waits = [...(waitsBySession.get(sessionId)?.values() ?? [])]
    const wait = waits.at(-1) ?? null
    if (wait) store.apply(sessionId, { type: 'artifact_wait_changed', wait })
    else store.applyIfPresent(sessionId, { type: 'artifact_wait_changed', wait: null })
  }

  function startWait(sessionId: string, requestId: string, wait: ArtifactWait) {
    const waits = waitsBySession.get(sessionId) ?? new Map<string, ArtifactWait>()
    waitsBySession.set(sessionId, waits)
    waits.set(requestId, wait)
    publish(sessionId)
  }

  function endWait(sessionId: string, requestId: string) {
    const waits = waitsBySession.get(sessionId)
    if (!waits?.delete(requestId)) return
    if (waits.size === 0) waitsBySession.delete(sessionId)
    publish(sessionId)
  }

  function drop(key: string, holder: string) {
    const lock = locks.get(key)
    if (!lock) return
    clearTimeout(lock.holders.get(holder))
    lock.holders.delete(holder)
    if (lock.holders.size > 0) return
    locks.delete(key)
    const files = [...lock.files]
    for (const resolve of lock.waiters) resolve(files)
  }

  async function wait(folder: string): Promise<string[]> {
    const lock = locks.get(await lockKey(folder))
    if (!lock) return []
    return new Promise(resolve => lock.waiters.push(resolve))
  }

  return {
    async hold(folder: string, holder: string): Promise<void> {
      const key = await lockKey(folder)
      const lock = locks.get(key) ?? { holders: new Map(), files: new Set<string>(), waiters: [] }
      locks.set(key, lock)
      clearTimeout(lock.holders.get(holder))
      const timer = setTimeout(() => drop(key, holder), holdMs)
      timer.unref?.()
      lock.holders.set(holder, timer)
    },

    async record(folder: string, files: string[]): Promise<void> {
      const lock = locks.get(await lockKey(folder))
      for (const file of files) lock?.files.add(file)
    },

    async release(folder: string, holder: string): Promise<void> {
      drop(await lockKey(folder), holder)
    },

    wait,

    cancelWait: endWait,

    handleControlRequest(sessionId: string, cliMsg: HostRequest): boolean {
      return conversationService.answerHostRequest(sessionId, cliMsg, new Set([ARTIFACT_EDIT_WAIT_SUBTYPE]), async () => {
        const parsed = SDKControlArtifactEditWaitRequestSchema().safeParse(cliMsg.request)
        if (!parsed.success) throw new Error(`Invalid ${ARTIFACT_EDIT_WAIT_SUBTYPE} request: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`)
        const folder = artifactFolderContaining(parsed.data.path)
        if (!folder || !locks.has(await lockKey(folder))) return { files: [] }
        const requestId = typeof cliMsg.request_id === 'string' ? cliMsg.request_id : ''
        let answered = false
        const waiting = wait(folder).finally(() => { answered = true })
        const title = await titleOf(folder)
        if (!answered) startWait(sessionId, requestId, { folder, title })
        try {
          return { files: await waiting }
        } finally {
          endWait(sessionId, requestId)
        }
      })
    },
  }
}

export type ArtifactEditLocks = ReturnType<typeof createArtifactEditLocks>

export const artifactEditLocks = createArtifactEditLocks()
