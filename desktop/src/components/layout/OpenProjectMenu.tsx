import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Code2, ExternalLink, FolderOpen } from 'lucide-react'
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
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!path) {
      setOpen(false)
      return
    }
    void ensureTargets()
  }, [ensureTargets, path])

  useEffect(() => {
    if (!open) return

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

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
    } finally {
      setOpen(false)
    }
  }

  if (!path || !primaryTarget) return null

  const buttonLabel = hasMenu
    ? t('openProject.openProject')
    : t('openProject.openIn', { target: primaryTarget.label })

  const rect = buttonRef.current?.getBoundingClientRect()

  return (
    <div className="relative flex items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label={buttonLabel}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        title={buttonLabel}
        onClick={() => {
          if (hasMenu) {
            setOpen((value) => !value)
            return
          }
          void handleOpenTarget(primaryTarget.id)
        }}
        className={`inline-flex h-[29px] w-[29px] items-center justify-center rounded-[7px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
          open
            ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <ExternalLink size={16} strokeWidth={1.9} aria-hidden="true" />
      </button>

      {open && hasMenu && rect ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="motion-menu fixed z-50 min-w-[200px] overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
          data-state="open"
          style={{ top: rect.bottom + 6, right: Math.max(12, window.innerWidth - rect.right) }}
        >
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="menuitem"
              onClick={() => void handleOpenTarget(target.id)}
              className="flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-ui-nav text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]"
            >
              <span className="flex h-5 w-5 items-center justify-center text-[var(--color-text-secondary)]">
                <TargetIcon target={target} size={18} />
              </span>
              <span className="min-w-0 truncate">{target.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
