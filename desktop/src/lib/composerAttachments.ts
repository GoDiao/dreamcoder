import { t } from '../i18n'
import { useUIStore } from '../stores/uiStore'
import { isDesktopRuntime } from './desktopRuntime'
import { getFilePath, pickFiles } from './shell'

const IMAGE_MAX_WIDTH = 2000
const IMAGE_MAX_HEIGHT = 2000
const IMAGE_TARGET_RAW_SIZE = 3.75 * 1024 * 1024
const IMAGE_QUALITY = 0.86
const IMAGE_MIN_QUALITY = 0.5
const IMAGE_ENCODE_ATTEMPTS = 12

export type ComposerAttachment = {
  id: string
  name: string
  type: 'image' | 'file'
  path?: string
  mimeType?: string
  previewUrl?: string
  data?: string
  isDirectory?: boolean
  lineStart?: number
  lineEnd?: number
  note?: string
  quote?: string
}

function nextAttachmentId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function getFileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/g, '')
  return normalized.split(/[\\/]/).filter(Boolean).pop() || filePath
}

export function pathToComposerAttachment(filePath: string): ComposerAttachment {
  return {
    id: nextAttachmentId(),
    name: getFileNameFromPath(filePath),
    type: 'file',
    path: filePath,
  }
}

export function pathsToComposerAttachments(filePaths: string[]): ComposerAttachment[] {
  return filePaths
    .filter((filePath) => typeof filePath === 'string' && filePath.length > 0)
    .map(pathToComposerAttachment)
}

export function dataTransferHasFiles(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? [])
  return types.includes('Files') || dataTransfer.files.length > 0
}

export async function dataTransferToComposerAttachments(dataTransfer: DataTransfer): Promise<ComposerAttachment[]> {
  return filesToComposerAttachments(dataTransfer.files)
}

export async function selectNativeFileAttachments(): Promise<ComposerAttachment[] | null> {
  if (!isDesktopRuntime()) return null

  try {
    const selected = await pickFiles({
      multiple: true,
      directory: false,
    })
    const paths = normalizeDialogSelection(selected)
    return pathsToComposerAttachments(paths)
  } catch (error) {
    console.warn('[attachments] Native file picker failed; falling back to browser file input', error)
    return null
  }
}

export async function filesToComposerAttachments(files: FileList | File[]): Promise<ComposerAttachment[]> {
  const entries = Array.from(files)
  const results = await Promise.allSettled(entries.map(fileToComposerAttachment))
  const attachments: ComposerAttachment[] = []
  const failures: { file: File; reason: unknown }[] = []
  results.forEach((result, index) => {
    if (result.status === 'rejected') failures.push({ file: entries[index]!, reason: result.reason })
    else if (result.value) attachments.push(result.value)
  })
  reportAttachmentFailures(failures)
  return attachments
}

function reportAttachmentFailures(failures: { file: File; reason: unknown }[]) {
  if (failures.length === 0) return
  for (const { file, reason } of failures) {
    console.warn('[attachments] Could not attach a file', file.name, reason)
  }
  useUIStore.getState().addToast({
    type: 'error',
    message: t('chat.attachmentFailed', { name: failures.map(({ file }) => file.name).join(', ') }),
  })
}

export function clipboardImageFiles(items: DataTransferItemList): File[] {
  const files: File[] = []
  const timestamp = Date.now()
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item?.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    files.push(new File([file], `pasted-image-${timestamp}-${files.length + 1}.${imageExtension(file.type)}`, {
      type: file.type,
      lastModified: file.lastModified,
    }))
  }
  return files
}

export async function prepareImageDataUrl(data: string, mimeType: string) {
  const source = dataUrlToBlob(data, mimeType)
  return prepareImageSource(source, data, mimeType)
}

function normalizeDialogSelection(selected: string | string[] | null): string[] {
  if (!selected) return []
  const paths = Array.isArray(selected) ? selected : [selected]
  return paths.filter((filePath) => typeof filePath === 'string' && filePath.length > 0)
}

async function fileToComposerAttachment(file: File): Promise<ComposerAttachment | null> {
  const nativePath = isDesktopRuntime() ? getFilePath(file) : undefined
  if (nativePath) {
    return pathToComposerAttachment(nativePath)
  }

  const isImage = file.type.startsWith('image/')
  const data = await readFileAsDataUrl(file)
  const prepared = isImage
    ? await prepareImageSource(file, data, file.type || 'image/png')
    : null
  return {
    id: nextAttachmentId(),
    name: prepared && prepared.data !== data ? nameWithImageExtension(file.name, prepared.mimeType) : file.name,
    type: isImage ? 'image' : 'file',
    mimeType: prepared?.mimeType || file.type || undefined,
    previewUrl: prepared?.data,
    data: prepared?.data || data,
  }
}

async function prepareImageSource(source: Blob, originalData: string, mimeType: string) {
  let image: ImageBitmap
  try {
    image = await createImageBitmap(source)
  } catch (error) {
    if (source.size <= IMAGE_TARGET_RAW_SIZE) return { data: originalData, mimeType }
    throw error
  }
  try {
    if (
      source.size <= IMAGE_TARGET_RAW_SIZE &&
      image.width <= IMAGE_MAX_WIDTH &&
      image.height <= IMAGE_MAX_HEIGHT
    ) {
      return { data: originalData, mimeType }
    }

    let { width, height } = fitWithinImageLimits(image.width, image.height)
    let outputType = encoderMimeType(mimeType)
    let quality = IMAGE_QUALITY

    for (let attempt = 0; attempt < IMAGE_ENCODE_ATTEMPTS; attempt += 1) {
      const blob = await renderImageBlob(image, width, height, outputType, quality)
      if (blob.size <= IMAGE_TARGET_RAW_SIZE) {
        return {
          data: await readBlobAsDataUrl(blob),
          mimeType: blob.type || outputType,
        }
      }

      if (outputType === 'image/png') {
        outputType = 'image/webp'
        continue
      }

      if (quality > IMAGE_MIN_QUALITY) {
        quality = Math.max(IMAGE_MIN_QUALITY, quality - 0.12)
        continue
      }

      const nextScale = Math.min(0.9, Math.sqrt(IMAGE_TARGET_RAW_SIZE / blob.size) * 0.95)
      const nextWidth = Math.max(1, Math.floor(width * nextScale))
      const nextHeight = Math.max(1, Math.floor(height * nextScale))
      if (nextWidth === width && nextHeight === height) break
      width = nextWidth
      height = nextHeight
      quality = IMAGE_QUALITY
    }

    throw new Error('Image could not be compressed below the attachment size limit')
  } finally {
    image.close()
  }
}

function fitWithinImageLimits(width: number, height: number) {
  if (width <= IMAGE_MAX_WIDTH && height <= IMAGE_MAX_HEIGHT) return { width, height }
  if (width * IMAGE_MAX_HEIGHT >= height * IMAGE_MAX_WIDTH) {
    return { width: IMAGE_MAX_WIDTH, height: Math.max(1, Math.floor((height * IMAGE_MAX_WIDTH) / width)) }
  }
  return { width: Math.max(1, Math.floor((width * IMAGE_MAX_HEIGHT) / height)), height: IMAGE_MAX_HEIGHT }
}

function imageExtension(mimeType: string) {
  const subtype = mimeType.split('/')[1]?.split('+')[0]
  return subtype === 'jpeg' ? 'jpg' : subtype || 'png'
}

function nameWithImageExtension(name: string, mimeType: string) {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.${imageExtension(mimeType)}`
}

function encoderMimeType(mimeType: string) {
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp') return mimeType
  return 'image/webp'
}

function renderImageBlob(image: ImageBitmap, width: number, height: number, mimeType: string, quality: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image canvas is unavailable')
  context.drawImage(image, 0, 0, width, height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Image encoding failed'))
    }, mimeType, quality)
  })
}

function dataUrlToBlob(data: string, fallbackMimeType: string) {
  const comma = data.indexOf(',')
  if (!data.startsWith('data:') || comma < 0) throw new Error('Invalid image data URL')
  const metadata = data.slice(5, comma)
  const mimeType = metadata.split(';')[0] || fallbackMimeType
  const payload = data.slice(comma + 1)
  if (!metadata.split(';').includes('base64')) {
    return new Blob([decodeURIComponent(payload)], { type: mimeType })
  }
  const decoded = atob(payload)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to encode image'))
    reader.readAsDataURL(blob)
  })
}
