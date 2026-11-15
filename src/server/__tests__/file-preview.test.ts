import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readFilePreview, type FilePreviewOptions } from '../services/filePreview.js'

const ONE_KIB = 1024
const cleanupDirs = new Set<string>()

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  cleanupDirs.add(dir)
  return dir
}

function options(overrides: Partial<FilePreviewOptions> = {}): FilePreviewOptions {
  return { maxBytes: ONE_KIB, language: 'text', oversize: 'refuse', ...overrides }
}

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await fs.rm(dir, { recursive: true, force: true })
  }
  cleanupDirs.clear()
})

describe('readFilePreview', () => {
  it('reads a text file the caller can show', async () => {
    const dir = await makeTempDir('file-preview-text-')
    const file = path.join(dir, 'note.ts')
    const content = 'export const answer = 42\n'
    await fs.writeFile(file, content)

    await expect(readFilePreview(file, options({ language: 'typescript' }))).resolves.toEqual({
      state: 'text',
      language: 'typescript',
      size: content.length,
      content,
      truncated: false,
      readBytes: content.length,
    })
  })

  it('marks a file holding a zero byte as binary', async () => {
    const dir = await makeTempDir('file-preview-binary-')
    const file = path.join(dir, 'data.bin')
    await fs.writeFile(file, Buffer.from([0x41, 0x00, 0x42]))

    await expect(readFilePreview(file, options())).resolves.toMatchObject({
      state: 'binary',
      language: 'binary',
      size: 3,
    })
  })

  it('refuses an oversized file when the caller refuses it', async () => {
    const dir = await makeTempDir('file-preview-refuse-')
    const file = path.join(dir, 'big.txt')
    await fs.writeFile(file, 'a'.repeat(ONE_KIB + 10))

    await expect(readFilePreview(file, options())).resolves.toEqual({
      state: 'too_large',
      language: 'text',
      size: ONE_KIB + 10,
    })
  })

  it('truncates an oversized file when the caller reads a preview', async () => {
    const dir = await makeTempDir('file-preview-truncate-')
    const file = path.join(dir, 'big.txt')
    await fs.writeFile(file, 'a'.repeat(ONE_KIB + 10))

    const preview = await readFilePreview(file, options({ oversize: 'truncate' }))

    expect(preview).toMatchObject({
      state: 'text',
      size: ONE_KIB + 10,
      readBytes: ONE_KIB,
      truncated: true,
    })
    expect(preview.content).toHaveLength(ONE_KIB)
  })

  it('reads a file of exactly the limit, in both modes', async () => {
    const dir = await makeTempDir('file-preview-limit-')
    const file = path.join(dir, 'exact.txt')
    await fs.writeFile(file, 'a'.repeat(ONE_KIB))

    for (const oversize of ['refuse', 'truncate'] as const) {
      const preview = await readFilePreview(file, options({ oversize }))

      expect(preview).toMatchObject({ state: 'text', size: ONE_KIB, readBytes: ONE_KIB, truncated: false })
    }
  })

  it('reports an error it cannot attribute to absence', async () => {
    const dir = await makeTempDir('file-preview-error-')

    await expect(readFilePreview(path.join(dir, 'bad\u0000name.ts'), options())).resolves.toMatchObject({
      state: 'error',
      size: 0,
    })
  })

  it('reports a missing file instead of throwing', async () => {
    const dir = await makeTempDir('file-preview-missing-')

    await expect(readFilePreview(path.join(dir, 'nope.ts'), options())).resolves.toEqual({
      state: 'missing',
      language: 'text',
      size: 0,
    })
  })

  it('reports an image without reading it, and inlines it only on request', async () => {
    const dir = await makeTempDir('file-preview-image-')
    const file = path.join(dir, 'pixel.png')
    const bytes = Buffer.from('hello', 'utf8')
    await fs.writeFile(file, bytes)

    await expect(readFilePreview(file, options())).resolves.toEqual({
      state: 'image',
      language: 'image',
      size: bytes.length,
      mimeType: 'image/png',
    })
    await expect(readFilePreview(file, options({ inlineImage: true }))).resolves.toMatchObject({
      state: 'image',
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    })
  })
})
