import { Button } from '../shared/ui/button'
import { useTranslation } from '../../i18n'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Modal } from '../shared/Modal'

type GalleryImage = {
  src: string
  name: string
}

type Props = {
  open: boolean
  images: GalleryImage[]
  activeIndex: number
  onClose: () => void
  onSelect: (index: number) => void
}

export function ImageGalleryModal({ open, images, activeIndex, onClose, onSelect }: Props) {
  const t = useTranslation()
  const activeImage = images[activeIndex]

  useEffect(() => {
    if (!open || images.length <= 1) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onSelect((activeIndex - 1 + images.length) % images.length)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onSelect((activeIndex + 1) % images.length)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, images.length, onSelect, open])

  if (!activeImage) return null

  return (
    <Modal open={open} onClose={onClose} title={activeImage.name} width={960}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-subtle-foreground">
            {activeIndex + 1} / {images.length}
          </div>
          {images.length > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-pill"
                onClick={() => onSelect((activeIndex - 1 + images.length) % images.length)}
                aria-label={t('chat.previousImage')}
              >
                <ChevronLeftIcon aria-hidden="true" size={18} />
              </Button>
              <Button variant="outline" size="icon-pill"
                onClick={() => onSelect((activeIndex + 1) % images.length)}
                aria-label={t('chat.nextImage')}
              >
                <ChevronRightIcon aria-hidden="true" size={18} />
              </Button>
            </div>
          )}
        </div>

        <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-2xl bg-muted">
          <img src={activeImage.src} alt={activeImage.name} className="max-h-[70vh] w-full object-contain" />
        </div>

        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {images.map((image, index) => (
              <button
                type="button"
                key={`${image.name}-${index}`}
                onClick={() => onSelect(index)}
                aria-pressed={index === activeIndex}
                className={`size-16 shrink-0 overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  index === activeIndex
                    ? 'border-primary ring-1 ring-primary'
                    : 'border-border'
                }`}
              >
                <img src={image.src} alt={image.name} className="h-16 w-16 object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
