import { useState } from 'react'
import { ImageGalleryModal } from './ImageGalleryModal'
import { useTranslation } from '../../i18n'

export type ToolResultImage = { src: string }

/**
 * Pull image blocks out of a tool result's content. Accepts both shapes:
 * MCP `{ type: 'image', data, mimeType }` and Anthropic
 * `{ type: 'image', source: { type: 'base64', media_type, data } }`.
 * Also looks inside a `{ content: [...] }` wrapper. Never throws.
 */
export function extractToolResultImages(content: unknown): ToolResultImage[] {
  const blocks = Array.isArray(content)
    ? content
    : content && typeof content === 'object' && Array.isArray((content as { content?: unknown }).content)
      ? (content as { content: unknown[] }).content
      : []
  const images: ToolResultImage[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type !== 'image') continue
    const source = record.source && typeof record.source === 'object' ? (record.source as Record<string, unknown>) : null
    const data = source ? source.data : record.data
    const mimeType = source ? source.media_type : record.mimeType
    if (source && source.type !== 'base64') continue
    if (typeof data !== 'string' || !data) continue
    if (typeof mimeType !== 'string' || !/^image\/[\w.+-]+$/.test(mimeType)) continue
    images.push({ src: `data:${mimeType};base64,${data}` })
  }
  return images
}

export function ToolResultImages({ images }: { images: ToolResultImage[] }) {
  const t = useTranslation()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  if (images.length === 0) return null

  const named = images.map((image, index) => ({ src: image.src, name: t('toolResult.image', { index: index + 1 }) }))

  return (
    <>
      <div className="space-y-1.5" data-testid="tool-result-images">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-outline)]">
          {t('toolResult.images', { count: images.length })}
        </div>
        <div className="flex flex-wrap gap-2">
          {named.map((image, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={image.name}
              className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-brand)]/40"
            >
              <img src={image.src} alt={image.name} loading="lazy" className="h-28 max-w-[240px] object-contain" />
            </button>
          ))}
        </div>
      </div>
      {activeIndex !== null && (
        <ImageGalleryModal
          open
          images={named}
          activeIndex={activeIndex}
          onClose={() => setActiveIndex(null)}
          onSelect={setActiveIndex}
        />
      )}
    </>
  )
}
