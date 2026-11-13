import { GitBranchIcon, Layers } from 'lucide-react'
import { useState } from 'react'
import { artifactThumbnailUrl } from '../../api/artifacts'
import { CardButton } from '../shared/CardButton'
import { artifactProjectName } from '../../lib/artifactProject'
import { useTranslation } from '../../i18n'
import { artifactBranch, artifactDetail, artifactOpenable, artifactTitle } from '../../lib/artifactDisplay'
import type { ArtifactListItem } from '../../types/artifact'

export function ArtifactCard({ item, layout, onOpen }: { item: ArtifactListItem; layout: 'grid' | 'list'; onOpen: (item: ArtifactListItem) => void }) {
  const t = useTranslation()
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const disabled = !artifactOpenable(item)
  const project = item.workDir === null
    ? [t('artifacts.unbound'), artifactProjectName(item)].filter(Boolean).join(' · ')
    : artifactProjectName(item)
  const branch = artifactBranch(item)
  const detail = artifactDetail(t, item)
  const opened = item.lastOpenedAt
    ? t('artifactsPage.lastOpened', { time: new Date(item.lastOpenedAt).toLocaleString() })
    : t('artifactsPage.neverOpened')
  const title = artifactTitle(item)

  return (
    <CardButton
      disabled={disabled}
      onClick={() => onOpen(item)}
      data-testid="artifact-card"
      className={`group border border-border ${
        layout === 'grid' ? 'flex flex-col overflow-hidden' : 'flex items-center gap-3 px-3 py-2'
      }`}
    >
      <span className={`flex items-center justify-center overflow-hidden bg-muted text-subtle-foreground ${layout === 'grid' ? 'h-28 w-full' : 'size-9 shrink-0 rounded-md'}`}>
        {item.id && item.thumbnailMtimeMs !== null && !thumbnailFailed ? (
          <img
            src={artifactThumbnailUrl(item.id, item.thumbnailMtimeMs)}
            alt=""
            loading="lazy"
            onError={() => setThumbnailFailed(true)}
            className="size-full object-cover object-top"
          />
        ) : (
          <Layers aria-hidden="true" size={layout === 'grid' ? 28 : 16} strokeWidth={1.6} />
        )}
      </span>
      <span className={`flex min-w-0 flex-col gap-0.5 ${layout === 'grid' ? 'p-3' : 'flex-1'}`}>
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className={`truncate text-xs ${item.error ? 'text-destructive' : 'text-muted-foreground'}`}>{detail}</span>
        <span className="flex items-center gap-1 truncate text-2xs text-subtle-foreground">
          {branch && <GitBranchIcon size={11} aria-hidden="true" className="shrink-0" />}
          <span className="truncate">{[project, branch].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="truncate text-2xs text-subtle-foreground">{opened}</span>
      </span>
    </CardButton>
  )
}
