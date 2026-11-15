import * as fs from 'node:fs/promises'
import { detectImageMimeType } from './imageMime.js'

export type FilePreviewState = 'text' | 'image' | 'binary' | 'too_large' | 'missing' | 'error'

export type FilePreviewOversizeMode = 'refuse' | 'truncate'

export type FilePreviewOptions = {
  maxBytes: number
  language: string
  oversize: FilePreviewOversizeMode
  inlineImage?: boolean
  describeError?: (error: unknown) => string
}

export type FilePreview = {
  state: FilePreviewState
  language: string
  size: number
  content?: string
  dataUrl?: string
  mimeType?: string
  truncated?: boolean
  readBytes?: number
  error?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function readFilePreview(
  absolutePath: string,
  options: FilePreviewOptions,
): Promise<FilePreview> {
  const { maxBytes, language, oversize, inlineImage = false, describeError } = options

  const fail = (error: unknown, size = 0): FilePreview => ({
    state: 'error',
    language,
    size,
    error: describeError ? describeError(error) : errorMessage(error),
  })

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(absolutePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { state: 'missing', language, size: 0 }
    }
    return fail(error)
  }

  if (!stat.isFile()) {
    return { state: 'missing', language, size: 0 }
  }

  const imageMimeType = detectImageMimeType(absolutePath)

  if (imageMimeType) {
    if (!inlineImage) {
      return { state: 'image', language: 'image', size: stat.size, mimeType: imageMimeType }
    }
    try {
      const data = await fs.readFile(absolutePath)
      return {
        state: 'image',
        language: 'image',
        size: stat.size,
        mimeType: imageMimeType,
        dataUrl: `data:${imageMimeType};base64,${data.toString('base64')}`,
      }
    } catch (error) {
      return fail(error, stat.size)
    }
  }

  if (stat.size > maxBytes && oversize === 'refuse') {
    return { state: 'too_large', language, size: stat.size }
  }

  let data: Buffer
  try {
    if (stat.size > maxBytes) {
      const fileHandle = await fs.open(absolutePath, 'r')
      try {
        const previewBuffer = Buffer.alloc(maxBytes)
        const { bytesRead } = await fileHandle.read(previewBuffer, 0, maxBytes, 0)
        data = previewBuffer.subarray(0, bytesRead)
      } finally {
        await fileHandle.close()
      }
    } else {
      data = await fs.readFile(absolutePath)
    }
  } catch (error) {
    return fail(error, stat.size)
  }

  if (data.includes(0)) {
    return { state: 'binary', language: 'binary', size: stat.size }
  }

  return {
    state: 'text',
    language,
    size: stat.size,
    content: data.toString('utf8'),
    truncated: data.length < stat.size,
    readBytes: data.length,
  }
}
