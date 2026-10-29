import { ImageIcon, MaximizeIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ImageGalleryModal } from './ImageGalleryModal'
import { getBaseUrl } from '../../api/client'

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export function extractImagePaths(text: string): string[] {
  const regex = /(?:^|[\s`"'(])(\/?(?:[A-Za-z]:[\\/]|\/)[^\s`"')<>]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))/gim
  const paths: string[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const p = match[1]!.trim()
    if (!seen.has(p) && IMAGE_EXTENSIONS.test(p)) {
      seen.add(p)
      paths.push(p)
    }
  }

  return paths
}

function fileUrl(filePath: string): string {
  return `${getBaseUrl()}/api/filesystem/file?path=${encodeURIComponent(filePath)}`
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

type Props = {
  text: string
}

export function InlineImageGallery({ text }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const imagePaths = useMemo(() => extractImagePaths(text), [text])

  const images = useMemo(
    () => imagePaths.map((p) => ({ src: fileUrl(p), name: fileName(p) })),
    [imagePaths],
  )

  if (images.length === 0) return null

  return (
    <>
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-outline)]">
          <ImageIcon aria-hidden="true" size={12} />
          {images.length === 1 ? '1 image' : `${images.length} images`}
        </div>
        <div className={`grid gap-2 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {images.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => setActiveIndex(i)}
              className="group relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-left shadow-sm transition-all hover:shadow-md hover:border-[var(--color-brand)]/40"
            >
              <img
                src={img.src}
                alt={img.name}
                loading="lazy"
                className="w-full object-cover"
                style={{ maxHeight: images.length === 1 ? 400 : 240 }}
                onError={(e) => {
                  (e.target as HTMLImageElement).closest('button')!.style.display = 'none'
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
                <span className="rounded-full bg-white/90 p-2 text-[var(--color-text-primary)] shadow-lg" aria-hidden="true"><MaximizeIcon size={20} /></span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2 pt-6">
                <span className="text-[10px] font-medium text-white/90 drop-shadow-sm">
                  {img.name}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {activeIndex !== null && activeIndex >= 0 && (
        <ImageGalleryModal
          open={activeIndex !== null}
          images={images}
          activeIndex={activeIndex}
          onClose={() => setActiveIndex(null)}
          onSelect={setActiveIndex}
        />
      )}
    </>
  )
}
