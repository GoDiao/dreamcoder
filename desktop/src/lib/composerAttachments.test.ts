import { afterEach, describe, expect, it, vi } from 'vitest'
import { filesToComposerAttachments, pathToComposerAttachment } from './composerAttachments'

function mockImageProcessing(width: number, height: number) {
  const close = vi.fn()
  const drawImage = vi.fn()
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
    callback(new Blob(['resized-image'], { type: type || 'image/png' }))
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const createImageBitmap = vi.fn(async () => ({ width, height, close }) as unknown as ImageBitmap)
  vi.stubGlobal('createImageBitmap', createImageBitmap)
  return { close, createImageBitmap, drawImage, toBlob }
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
    const processing = mockImageProcessing(2000, 2000)
    const file = new File([new Uint8Array(3.75 * 1024 * 1024)], 'boundary.png', { type: 'image/png' })
    const originalData = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.createImageBitmap).toHaveBeenCalledOnce()
    expect(processing.toBlob).not.toHaveBeenCalled()
    expect(attachment?.data).toBe(originalData)
    expect(attachment?.mimeType).toBe('image/png')
  })

  it('resizes an image whose dimensions exceed the client limit', async () => {
    const processing = mockImageProcessing(2001, 1200)
    const file = new File(['wide-image'], 'wide.png', { type: 'image/png' })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.drawImage).toHaveBeenCalled()
    expect(processing.toBlob).toHaveBeenCalled()
    expect(attachment?.data).not.toBe('data:image/png;base64,d2lkZS1pbWFnZQ==')
  })

  it('compresses an image whose raw bytes exceed the client limit', async () => {
    const processing = mockImageProcessing(320, 240)
    const file = new File([new Uint8Array(3.75 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })

    const [attachment] = await filesToComposerAttachments([file])

    expect(processing.drawImage).toHaveBeenCalled()
    expect(processing.toBlob).toHaveBeenCalled()
    expect(attachment?.data?.length).toBeLessThan(1024)
  })
})
