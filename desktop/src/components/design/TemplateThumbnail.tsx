import { LayoutTemplate } from 'lucide-react'
import { useState } from 'react'
import { designTemplateThumbnailUrl } from '../../api/design'

export function TemplateThumbnail({ templateId, className = 'h-32 w-full' }: { templateId: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`flex items-center justify-center overflow-hidden bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)] ${className}`}>
      {failed ? (
        <LayoutTemplate aria-hidden="true" size={28} strokeWidth={1.6} />
      ) : (
        <img
          src={designTemplateThumbnailUrl(templateId)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover object-top"
        />
      )}
    </span>
  )
}
