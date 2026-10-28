import { useEffect, useMemo, useState } from 'react'
import { Code2, ExternalLink, FolderOpen } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../shared/ui/dropdown-menu'
import { Button } from '../shared/ui/button'
import { Tooltip } from '../shared/Tooltip'
import { useTranslation } from '../../i18n'
import { useOpenTargetStore, type OpenTarget } from '../../stores/openTargetStore'

type Props = {
  path: string | null | undefined
}

function getFallbackIcon(kind: 'ide' | 'file_manager', size = 17) {
  if (kind === 'file_manager') {
    return <FolderOpen size={size} strokeWidth={1.9} />
  }
  return <Code2 size={size} strokeWidth={1.9} />
}

function TargetIcon({ target, size = 18 }: { target: OpenTarget; size?: number }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [target.iconUrl])

  if (target.iconUrl && !failed) {
    return (
      <img
        src={target.iconUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailed(true)}
        className="block shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    )
  }

  return getFallbackIcon(target.kind, Math.max(16, size - 1))
}

export function OpenProjectMenu({ path }: Props) {
  const t = useTranslation()
  const targets = useOpenTargetStore((state) => state.targets)
  const primaryTargetId = useOpenTargetStore((state) => state.primaryTargetId)
  const ensureTargets = useOpenTargetStore((state) => state.ensureTargets)
  const openTarget = useOpenTargetStore((state) => state.openTarget)
  useEffect(() => {
    if (path) void ensureTargets()
  }, [ensureTargets, path])

  const primaryTarget = useMemo(
    () => targets.find((target) => target.id === primaryTargetId) ?? targets[0] ?? null,
    [primaryTargetId, targets],
  )
  const hasMenu = targets.length > 1

  const handleOpenTarget = async (targetId: string) => {
    if (!path) return
    try {
      await openTarget(targetId, path)
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: t('openProject.openFailed') })
    }
  }

  if (!path || !primaryTarget) return null

  const buttonLabel = hasMenu
    ? t('openProject.openProject')
    : t('openProject.openIn', { target: primaryTarget.label })

  const trigger = (
    <Button variant="ghost" size="icon" aria-label={buttonLabel} onClick={hasMenu ? undefined : () => void handleOpenTarget(primaryTarget.id)}>
      <ExternalLink size={16} aria-hidden="true" />
    </Button>
  )

  if (!hasMenu) return <Tooltip content={buttonLabel}>{trigger}</Tooltip>

  return (
    <DropdownMenu>
      <Tooltip content={buttonLabel}><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger></Tooltip>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {targets.map((target) => (
          <DropdownMenuItem key={target.id} onSelect={() => void handleOpenTarget(target.id)}>
            <TargetIcon target={target} size={18} />
            <span className="min-w-0 truncate">{target.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
