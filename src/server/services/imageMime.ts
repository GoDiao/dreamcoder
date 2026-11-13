import * as path from 'node:path'

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

export function detectImageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return IMAGE_MIME_BY_EXTENSION[ext] ?? null
}
