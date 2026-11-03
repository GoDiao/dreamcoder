import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { clipboardImageFiles, filesToComposerAttachments, pathToComposerAttachment } from './composerAttachments'

const BYTE_LIMIT = 3.75 * 1024 * 1024

type Encoding = { type: string; quality: number | undefined; width: number; height: number }

function mockImageProcessing({
  width,
  height,
  encodedSize = () => 13,
  undecodableTypes = [],
}: {
  width: number
  height: number
  encodedSize?: (encoding: Encoding, index: number) => number
  undecodableTypes?: string[]
}) {
  const close = vi.fn()
  const canvasSizes: { width: number; height: number }[] = []
  const encodings: Encoding[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvasSizes.push({ width: this.width, height: this.height })
    return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    const encoding = { type: type || 'image/png', quality: quality as number | undefined, width: this.width, height: this.height }
    encodings.push(encoding)
    callback(new Blob([new Uint8Array(encodedSize(encoding, encodings.length - 1))], { type: encoding.type }))
  })
  const createImageBitmap = vi.fn(async (source: Blob) => {
    if (undecodableTypes.includes(source.type)) {
      throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
    }
    return { width, height, close } as unknown as ImageBitmap
  })
  vi.stubGlobal('createImageBitmap', createImageBitmap)
  return { canvasSizes, close, createImageBitmap, encodings }
}

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

function silenceWarnings() {
  return vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

describe('composer attachment payloads', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps many selected desktop project files as paths instead of request-body data', () => {
    const projectRoot = '/tmp/dreamcoder-issue-444-regression'
    const files = Array.from({ length: 12 }, (_, index) => (
      `${projectRoot}/assets/large-${index + 1}.bin`
    ))

    const oldInlineAttachments = files.map((filePath) => ({
      type: 'file',
      name: filePath.split('/').pop(),
      data: `data:application/octet-stream;base64,${'A'.repeat(256 * 1024)}`,
      mimeType: 'application/octet-stream',
    }))
    const oldInlinePayload = JSON.stringify({
      type: 'user_message',
      content: 'analyze these files',
      attachments: oldInlineAttachments,
    })

    const pathOnlyAttachments = files.map(pathToComposerAttachment)
    const pathOnlyPayload = JSON.stringify({
      type: 'user_message',
      content: 'analyze these files',
      attachments: pathOnlyAttachments,
    })

    expect(oldInlinePayload.length).toBeGreaterThan(3 * 1024 * 1024)
    expect(pathOnlyPayload.length).toBeLessThan(3 * 1024)
    expect(pathOnlyAttachments.every((attachment) => attachment.path && !attachment.data)).toBe(true)
  })

  it('keeps an image at the dimension and byte limits byte-for-byte', async () => {
    const processing = mockImageProcessing({ width: 2000, height: 2000 })
    const file = new File([new Uint8Array(BYTE_LIMIT)], 'boundary.png', { type: 'image/png' })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.createImageBitmap).toHaveBeenCalledOnce()
    expect(processing.encodings).toEqual([])
    expect(processing.close).toHaveBeenCalledOnce()
    expect(attachment).toMatchObject({ name: 'boundary.png', mimeType: 'image/png', data: await readAsDataUrl(file) })
  })

  it.each([
    [2001, 1200, 2000, 1199],
    [2000, 2001, 1999, 2000],
    [3001, 2999, 2000, 1998],
    [2999, 3001, 1998, 2000],
  ])('scales a %ix%i image to %ix%i before encoding it', async (width, height, scaledWidth, scaledHeight) => {
    const processing = mockImageProcessing({ width, height })
    const file = new File(['image'], 'large.png', { type: 'image/png' })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.canvasSizes).toEqual([{ width: scaledWidth, height: scaledHeight }])
    expect(processing.encodings).toEqual([{ type: 'image/png', quality: 0.86, width: scaledWidth, height: scaledHeight }])
    expect(attachment).toMatchObject({
      name: 'large.png',
      mimeType: 'image/png',
      data: await readAsDataUrl(new Blob([new Uint8Array(13)], { type: 'image/png' })),
    })
  })

  it('switches a PNG that stays over the byte limit to WebP and names it after its new type', async () => {
    const processing = mockImageProcessing({
      width: 320,
      height: 240,
      encodedSize: ({ type }) => (type === 'image/png' ? BYTE_LIMIT + 1 : 13),
    })
    const file = new File([new Uint8Array(BYTE_LIMIT + 1)], 'shot.png', { type: 'image/png' })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.encodings).toEqual([
      { type: 'image/png', quality: 0.86, width: 320, height: 240 },
      { type: 'image/webp', quality: 0.86, width: 320, height: 240 },
    ])
    const encoded = await readAsDataUrl(new Blob([new Uint8Array(13)], { type: 'image/webp' }))
    expect(attachment).toMatchObject({ name: 'shot.webp', mimeType: 'image/webp', data: encoded, previewUrl: encoded })
  })

  it('lowers the quality to 0.5 before shrinking, and starts again at 0.86 after each shrink', async () => {
    const processing = mockImageProcessing({
      width: 4000,
      height: 3000,
      encodedSize: (_, index) => (index < 5 ? BYTE_LIMIT + 1 : 13),
    })
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.encodings.map(({ type }) => type)).toEqual(Array(6).fill('image/jpeg'))
    expect(processing.encodings.map(({ quality }) => quality)).toEqual(
      [0.86, 0.74, 0.62, 0.5, 0.86, 0.74].map((quality) => expect.closeTo(quality, 5)),
    )
    expect(processing.encodings.map(({ width, height }) => `${width}x${height}`)).toEqual([
      '2000x1500', '2000x1500', '2000x1500', '2000x1500', '1800x1350', '1800x1350',
    ])
    expect(attachment).toMatchObject({ name: 'photo.jpg', mimeType: 'image/jpeg' })
  })

  it('gives up after 12 encodings that all stay over the byte limit, logs it and tells the user', async () => {
    const warn = silenceWarnings()
    const processing = mockImageProcessing({ width: 4000, height: 3000, encodedSize: () => BYTE_LIMIT + 1 })
    const file = new File(['huge'], 'huge.png', { type: 'image/png' })

    const attachments = await filesToComposerAttachments([file])

    expect(attachments).toEqual([])
    expect(processing.encodings).toHaveLength(12)
    expect(processing.close).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('[attachments] Could not attach a file', 'huge.png', expect.any(Error))
    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith('Could not attach huge.png.')
  })

  it('attaches an image the browser cannot decode unchanged when it is within the byte limit', async () => {
    const processing = mockImageProcessing({ width: 0, height: 0, undecodableTypes: ['image/svg+xml'] })
    const file = new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.createImageBitmap).toHaveBeenCalledOnce()
    expect(processing.encodings).toEqual([])
    const original = await readAsDataUrl(file)
    expect(attachment).toMatchObject({ name: 'icon.svg', type: 'image', mimeType: 'image/svg+xml', data: original, previewUrl: original })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('fails an image the browser cannot decode when it is over the byte limit', async () => {
    const warn = silenceWarnings()
    mockImageProcessing({ width: 0, height: 0, undecodableTypes: ['image/heic'] })
    const file = new File([new Uint8Array(BYTE_LIMIT + 1)], 'photo.heic', { type: 'image/heic' })

    const attachments = await filesToComposerAttachments([file])

    expect(attachments).toEqual([])
    expect(warn).toHaveBeenCalledWith('[attachments] Could not attach a file', 'photo.heic', expect.any(DOMException))
    expect(toast.error).toHaveBeenCalledWith('Could not attach photo.heic.')
  })

  it('still attaches the other file of a batch when one of them fails', async () => {
    silenceWarnings()
    mockImageProcessing({ width: 320, height: 240, undecodableTypes: ['image/heic'] })
    const files = [
      new File(['ok'], 'ok.png', { type: 'image/png' }),
      new File([new Uint8Array(BYTE_LIMIT + 1)], 'photo.heic', { type: 'image/heic' }),
    ]

    const attachments = await filesToComposerAttachments(files)

    expect(attachments.map(({ name }) => name)).toEqual(['ok.png'])
    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith('Could not attach photo.heic.')
  })

  it('names every file that failed in a single message', async () => {
    silenceWarnings()
    mockImageProcessing({ width: 320, height: 240, undecodableTypes: ['image/heic'] })
    const files = [
      new File([new Uint8Array(BYTE_LIMIT + 1)], 'first.heic', { type: 'image/heic' }),
      new File(['ok'], 'ok.png', { type: 'image/png' }),
      new File([new Uint8Array(BYTE_LIMIT + 1)], 'second.heic', { type: 'image/heic' }),
    ]

    const attachments = await filesToComposerAttachments(files)

    expect(attachments.map(({ name }) => name)).toEqual(['ok.png'])
    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith('Could not attach first.heic, second.heic.')
  })
})

describe('clipboard images', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps only image items that give a file, and names a JPEG with a .jpg extension', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const textFile = vi.fn(() => new File(['text'], 'note.txt', { type: 'text/plain' }))
    const jpeg = new File(['jpeg'], 'image.jpeg', { type: 'image/jpeg', lastModified: 42 })
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: textFile },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
      { kind: 'file', type: 'image/jpeg', getAsFile: () => jpeg },
    ] as unknown as DataTransferItemList

    const files = clipboardImageFiles(items)

    expect(textFile).not.toHaveBeenCalled()
    expect(files.map(({ name, type, lastModified }) => ({ name, type, lastModified }))).toEqual([
      { name: 'pasted-image-1700000000000-1.jpg', type: 'image/jpeg', lastModified: 42 },
    ])
  })
})
