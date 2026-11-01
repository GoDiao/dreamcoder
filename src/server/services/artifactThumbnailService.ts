import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ApiError } from '../middleware/errorHandler.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { writeJsonFileAtomic } from './recoverableJsonFile.js'

export const THUMBNAIL_MAX_BYTES = 256 * 1024
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

type ThumbnailMeta = { id: string; mtimeMs: number }

function thumbnailsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'artifact-thumbnails')
}

function fileBase(id: string): string {
  return path.join(thumbnailsDir(), createHash('sha256').update(id).digest('hex').slice(0, 32))
}

function isJpeg(data: Uint8Array): boolean {
  return JPEG_MAGIC.every((byte, index) => data[index] === byte)
}

export class ArtifactThumbnailService {
  async save(id: string, mtimeMs: number, data: Uint8Array): Promise<void> {
    if (!id) throw ApiError.badRequest('id is required')
    if (!Number.isFinite(mtimeMs)) throw ApiError.badRequest('mtimeMs must be a number')
    if (data.length === 0 || data.length > THUMBNAIL_MAX_BYTES) throw ApiError.badRequest('The image must be between 1 byte and 256 KB')
    if (!isJpeg(data)) throw ApiError.badRequest('The image must be a JPEG')
    const base = fileBase(id)
    await fs.mkdir(thumbnailsDir(), { recursive: true })
    const temp = `${base}.${process.pid}.tmp`
    await fs.writeFile(temp, data)
    await fs.rename(temp, `${base}.jpg`)
    await writeJsonFileAtomic(`${base}.json`, { id, mtimeMs } satisfies ThumbnailMeta)
  }

  async mtimeOf(id: string): Promise<number | null> {
    try {
      const meta = JSON.parse(await fs.readFile(`${fileBase(id)}.json`, 'utf-8')) as Partial<ThumbnailMeta>
      return meta.id === id && typeof meta.mtimeMs === 'number' ? meta.mtimeMs : null
    } catch {
      return null
    }
  }

  async read(id: string): Promise<Buffer | null> {
    if ((await this.mtimeOf(id)) === null) return null
    try {
      return await fs.readFile(`${fileBase(id)}.jpg`)
    } catch {
      return null
    }
  }
}

export const artifactThumbnailService = new ArtifactThumbnailService()
