import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { normalizeJsonObject, readRecoverableJsonFile, writeJsonFileAtomic } from './recoverableJsonFile.js'

export type ArtifactChangeSource = 'tool' | 'snapshot'

export type ArtifactSessionMark = { sessionId: string; source: ArtifactChangeSource }

type IndexData = {
  marks: Record<string, Record<string, ArtifactChangeSource>>
  dirs: Record<string, string[]>
}

function indexPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'artifact-sessions.json')
}

function normalizeIndex(value: unknown): IndexData | null {
  const record = normalizeJsonObject(value)
  if (!record) return null
  const data: IndexData = { marks: {}, dirs: {} }
  for (const [key, sessions] of Object.entries(normalizeJsonObject(record.marks) ?? {})) {
    const sessionRecord = normalizeJsonObject(sessions)
    if (!sessionRecord) continue
    data.marks[key] = {}
    for (const [sessionId, source] of Object.entries(sessionRecord)) {
      if (source === 'tool' || source === 'snapshot') data.marks[key]![sessionId] = source
    }
  }
  for (const [sessionId, dirs] of Object.entries(normalizeJsonObject(record.dirs) ?? {})) {
    if (Array.isArray(dirs)) data.dirs[sessionId] = dirs.filter((dir): dir is string => typeof dir === 'string')
  }
  return data
}

export class ArtifactSessionIndex {
  private data: IndexData | null = null

  private async load(): Promise<IndexData> {
    if (!this.data) {
      this.data = await readRecoverableJsonFile<IndexData>({
        filePath: indexPath(),
        label: 'artifact session index',
        defaultValue: { marks: {}, dirs: {} },
        normalize: normalizeIndex,
      })
    }
    return this.data
  }

  private async save(data: IndexData): Promise<void> {
    await writeJsonFileAtomic(indexPath(), data)
  }

  async record(key: string, sessionId: string, source: ArtifactChangeSource, artifactsDir: string): Promise<void> {
    const data = await this.load()
    const sessions = (data.marks[key] ??= {})
    const dirs = (data.dirs[sessionId] ??= [])
    let changed = false
    if (!dirs.includes(artifactsDir)) {
      dirs.push(artifactsDir)
      changed = true
    }
    if (sessions[sessionId] !== 'tool' && sessions[sessionId] !== source) {
      sessions[sessionId] = source
      changed = true
    }
    if (changed) await this.save(data)
  }

  async sessionsFor(keys: readonly string[]): Promise<ArtifactSessionMark[]> {
    const data = await this.load()
    const merged = new Map<string, ArtifactChangeSource>()
    for (const key of keys) {
      for (const [sessionId, source] of Object.entries(data.marks[key] ?? {})) {
        if (merged.get(sessionId) !== 'tool') merged.set(sessionId, source)
      }
    }
    return [...merged].map(([sessionId, source]) => ({ sessionId, source }))
  }

  async artifactsDirsOf(sessionId: string): Promise<string[]> {
    return (await this.load()).dirs[sessionId] ?? []
  }
}
