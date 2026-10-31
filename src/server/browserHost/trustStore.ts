import * as path from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { readRecoverableJsonFile, writeJsonFileAtomic } from '../services/recoverableJsonFile.js'
import type { BrowserTrustRequest } from './hostChannel.js'

const TRUST_FILE_SCHEMA_VERSION = 1
const MAX_TRUSTED_ORIGINS = 500
const LOG_PREFIX = '[browser-trust]'

export class BrowserTrustError extends Error {
  readonly code: 'invalid_origin' | 'limit'

  constructor(code: 'invalid_origin' | 'limit', message: string) {
    super(message)
    this.name = 'BrowserTrustError'
    this.code = code
  }
}

const ORIGIN_SHAPE = /^https:\/\/[^/\\?#\s*]+\/?$/i

export function normalizeTrustedOrigin(input: unknown): string | null {
  if (typeof input !== 'string' || !ORIGIN_SHAPE.test(input)) return null
  try {
    const url = new URL(input)
    return url.username || url.password ? null : url.origin
  } catch {
    return null
  }
}

type TrustFile = { schemaVersion: number; origins: string[] }

function normalizeTrustFile(value: unknown): TrustFile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const origins = (value as Record<string, unknown>).origins
  if (!Array.isArray(origins)) return null
  const seen = new Set<string>()
  for (const entry of origins) {
    const origin = normalizeTrustedOrigin(entry)
    if (origin) seen.add(origin)
  }
  return { schemaVersion: TRUST_FILE_SCHEMA_VERSION, origins: [...seen].slice(0, MAX_TRUSTED_ORIGINS) }
}

export type BrowserTrustStoreOptions = {
  getFilePath?: () => string
}

export function defaultTrustFilePath() {
  return path.join(getClaudeConfigHomeDir(), 'dreamcoder', 'browser-trust.json')
}

export class BrowserTrustStore {
  private readonly getFilePath: () => string
  private tail: Promise<unknown> = Promise.resolve()

  constructor(options: BrowserTrustStoreOptions = {}) {
    this.getFilePath = options.getFilePath ?? defaultTrustFilePath
  }

  async has(origin: string): Promise<boolean> {
    try {
      return (await this.read()).includes(origin)
    } catch (error) {
      console.error(`${LOG_PREFIX} could not read the trusted-site list, treating every site as untrusted: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  list(): Promise<string[]> {
    return this.serialized(() => this.read())
  }

  async add(input: string): Promise<string[]> {
    const origin = this.requireOrigin(input)
    return this.serialized(async () => {
      const origins = await this.read()
      if (origins.includes(origin)) return origins
      if (origins.length >= MAX_TRUSTED_ORIGINS) {
        throw new BrowserTrustError('limit', `The trusted-site list is full (${MAX_TRUSTED_ORIGINS} sites). Remove one first.`)
      }
      return this.write([...origins, origin])
    })
  }

  async remove(input: string): Promise<string[]> {
    const origin = this.requireOrigin(input)
    return this.serialized(async () => {
      const origins = await this.read()
      if (!origins.includes(origin)) return origins
      return this.write(origins.filter((entry) => entry !== origin))
    })
  }

  handle(request: BrowserTrustRequest): Promise<string[]> {
    if (request.op === 'list') return this.list()
    if (request.origin === undefined) return Promise.reject(new BrowserTrustError('invalid_origin', 'An origin is required.'))
    return request.op === 'add' ? this.add(request.origin) : this.remove(request.origin)
  }

  private requireOrigin(input: string) {
    const origin = normalizeTrustedOrigin(input)
    if (!origin) {
      throw new BrowserTrustError(
        'invalid_origin',
        'Only exact https origins such as https://example.com can be trusted: no wildcards, paths, credentials or other schemes.',
      )
    }
    return origin
  }

  private async read(): Promise<string[]> {
    const file = await readRecoverableJsonFile<TrustFile>({
      filePath: this.getFilePath(),
      label: 'browser trusted sites',
      defaultValue: { schemaVersion: TRUST_FILE_SCHEMA_VERSION, origins: [] },
      normalize: normalizeTrustFile,
    })
    return file.origins
  }

  private async write(origins: string[]): Promise<string[]> {
    await writeJsonFileAtomic(this.getFilePath(), { schemaVersion: TRUST_FILE_SCHEMA_VERSION, origins })
    return origins
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.catch(() => undefined)
    return result
  }
}
