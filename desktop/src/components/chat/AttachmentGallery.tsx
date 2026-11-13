import { FileTextIcon, FolderIcon, MessageSquareIcon, XIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ImageGalleryModal } from './ImageGalleryModal'

export type AttachmentPreview = {
  id?: string
  type: 'image' | 'file'
  name: string
  path?: string
  data?: string
  previewUrl?: string
  isDirectory?: boolean
  lineStart?: number
  lineEnd?: number
  note?: string
  quote?: string
}

type Props = {
  attachments: AttachmentPreview[]
  variant?: 'composer' | 'message'
  onRemove?: (id: string) => void
}

export function AttachmentGallery({ attachments, variant = 'message', onRemove }: Props) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)

  const images = useMemo(
    () =>
      attachments
        .filter((attachment) => attachment.type === 'image' && (attachment.previewUrl || attachment.data))
        .map((attachment) => ({
          src: attachment.previewUrl || attachment.data || '',
          name: attachment.name,
        })),
    [attachments],
  )

  if (attachments.length === 0) return null

  const isComposer = variant === 'composer'

  return (
    <>
      <div className={isComposer ? 'flex flex-wrap items-center gap-2' : 'flex flex-wrap justify-end gap-2'}>
        {attachments.map((attachment, index) => {
          if (attachment.type === 'image' && (attachment.previewUrl || attachment.data)) {
            const src = attachment.previewUrl || attachment.data || ''
            return (
              <div
                key={attachment.id || `${attachment.name}-${index}`}
                className={isComposer ? 'group relative' : ''}
              >
                <button
                  type="button"
                  onClick={() => setActiveImageIndex(images.findIndex((image) => image.src === src))}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  <img
                    src={src}
                    alt={attachment.name}
                    className="h-16 w-16 object-cover"
                  />
                </button>
                {onRemove && attachment.id && (
                  <button
                    type="button"
                    onClick={() => onRemove(attachment.id!)}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-3xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          }

          const lineLabel = attachment.lineStart
            ? `:L${attachment.lineStart}${attachment.lineEnd && attachment.lineEnd !== attachment.lineStart ? `-L${attachment.lineEnd}` : ''}`
            : ''
          const quotePreview = attachment.quote?.trim().replace(/\s+/g, ' ')
          const hasQuotePreview = !!quotePreview

          const AttachmentIcon = hasQuotePreview ? MessageSquareIcon : attachment.isDirectory ? FolderIcon : FileTextIcon
          return (
            <div
              key={attachment.id || `${attachment.name}-${index}`}
              className={[
                'group/file inline-flex max-w-full min-w-0 border border-border',
                'bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                hasQuotePreview
                  ? 'items-start gap-2 rounded-lg px-2.5 py-2'
                  : 'h-9 items-center gap-2 rounded-full px-3',
              ].join(' ')}
            >
              <AttachmentIcon className={`shrink-0 text-subtle-foreground ${hasQuotePreview ? 'mt-0.5' : ''}`} aria-hidden="true" size={17} />
              <span className="min-w-0">
                <span className="block min-w-0 max-w-[260px] truncate text-sm font-medium leading-5 text-foreground">
                  {attachment.name}{lineLabel}
                </span>
                {hasQuotePreview && (
                  <span className="mt-0.5 block max-w-[320px] truncate font-mono text-2xs leading-4 text-subtle-foreground">
                    {quotePreview}
                  </span>
                )}
              </span>
              {onRemove && attachment.id && (
                <button
                  type="button"
                  onClick={() => onRemove(attachment.id!)}
                  className={`${hasQuotePreview ? 'mt-0.5' : 'ml-0.5'} flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-subtle-foreground transition-colors hover:text-foreground`}
                  aria-label={`Remove ${attachment.name}`}
                >
                  <XIcon aria-hidden="true" size={17} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {activeImageIndex !== null && activeImageIndex >= 0 && (
        <ImageGalleryModal
          open={activeImageIndex !== null}
          images={images}
          activeIndex={activeImageIndex}
          onClose={() => setActiveImageIndex(null)}
          onSelect={setActiveImageIndex}
        />
      )}
    </>
  )
}
