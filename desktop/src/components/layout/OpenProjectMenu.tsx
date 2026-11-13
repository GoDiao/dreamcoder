import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Code2, FolderOpen } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../shared/ui/dropdown-menu'
import { Button } from '../shared/ui/button'
import { ButtonGroup } from '../shared/ui/button-group'
import { Tooltip } from '../shared/Tooltip'
import { useTranslation } from '../../i18n'
import { useOpenTargetStore, type OpenTarget } from '../../stores/openTargetStore'

type Props = {
  path: string | null | undefined
  subject?: 'project' | 'file'
}

function getFallbackIcon(kind: 'ide' | 'file_manager', size = 17) {
  if (kind === 'file_manager') {
    return <FolderOpen size={size} strokeWidth={1.9} />
  }
  return <Code2 size={size} strokeWidth={1.9} />
}

export function TargetIcon({ target, size = 18 }: { target: OpenTarget; size?: number }) {
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

  return getFallbackIcon(target.kind, size)
}

export function useOpenTargets(active: boolean) {
  const targets = useOpenTargetStore((state) => state.targets)
  const primaryTargetId = useOpenTargetStore((state) => state.primaryTargetId)
  const ensureTargets = useOpenTargetStore((state) => state.ensureTargets)
  const openTarget = useOpenTargetStore((state) => state.openTarget)
  useEffect(() => {
    if (active) void ensureTargets()
  }, [active, ensureTargets])

  const primaryTarget = useMemo(
    () => targets.find((target) => target.id === primaryTargetId) ?? targets[0] ?? null,
    [primaryTargetId, targets],
  )
  const open = async (targetId: string, path: string, failureMessage: string) => {
    try {
      await openTarget(targetId, path)
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: failureMessage })
    }
  }
  return { targets, primaryTarget, open }
}

export function OpenProjectMenu({ path, subject = 'project' }: Props) {
  const t = useTranslation()
  const { targets, primaryTarget, open } = useOpenTargets(Boolean(path))

  if (!path || !primaryTarget) return null

  const compact = subject === 'file'
  const iconSize = compact ? 14 : 16
  const primaryLabel = t('openProject.openIn', { target: primaryTarget.label })
  const menuLabel = t(compact ? 'openProject.openFile' : 'openProject.openProject')
  const failureMessage = t(compact ? 'openProject.openFileFailed' : 'openProject.openFailed')
  const handleOpenTarget = (targetId: string) => void open(targetId, path, failureMessage)

  return (
    <ButtonGroup>
      <Tooltip content={primaryLabel}>
        <Button variant="outline" size={compact ? 'icon-xs' : 'icon-sm'} aria-label={primaryLabel} onClick={() => handleOpenTarget(primaryTarget.id)}>
          <TargetIcon target={primaryTarget} size={iconSize} />
        </Button>
      </Tooltip>
      {targets.length > 1 && (
        <DropdownMenu>
          <Tooltip content={menuLabel}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size={compact ? 'icon-xs' : 'icon-sm'} aria-label={menuLabel}>
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-44">
            {targets.map((target) => (
              <DropdownMenuItem key={target.id} onSelect={() => handleOpenTarget(target.id)}>
                <TargetIcon target={target} size={16} />
                <span className="min-w-0 truncate">{target.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </ButtonGroup>
  )
}
