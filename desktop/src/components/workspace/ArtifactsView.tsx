import { CircleAlertIcon, FolderOpenIcon, GitBranchIcon, Layers, MessageSquarePlus, Palette, RefreshCw } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { sessionsApi } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { artifactBranch, artifactDetail, artifactKey, artifactOpenable, artifactRoot, artifactTitle } from '../../lib/artifactDisplay'
import { getFileNameFromPath } from '../../lib/composerAttachments'
import { errorMessage } from '../../lib/errorMessage'
import { useArtifactStore } from '../../stores/artifactStore'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import type { ArtifactListItem, DesignSystemListItem, WorkspaceArtifactsResult } from '../../types/artifact'
import { Button } from '../shared/ui/button'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { PanelLoading, PanelMessage } from './PanelStates'

function markOf(item: ArtifactListItem, sessionId: string) {
  return item.sessions.find((mark) => mark.sessionId === sessionId)?.source ?? null
}

function sortMarkedFirst(items: ArtifactListItem[], sessionId: string) {
  const rank = (item: ArtifactListItem) => {
    const mark = markOf(item, sessionId)
    return mark === 'tool' ? 0 : mark === 'snapshot' ? 1 : 2
  }
  return [...items].sort((a, b) => rank(a) - rank(b))
}

function AddToChatButton({ title, onClick }: { title: string; onClick: () => void }) {
  const t = useTranslation()
  return (
    <HintTooltip content={t('artifacts.addToChat')}>
      <Button variant="ghost" size="icon-sm" aria-label={t('artifacts.addToChatNamed', { name: title })} onClick={onClick}>
        <MessageSquarePlus aria-hidden="true" />
      </Button>
    </HintTooltip>
  )
}

function ArtifactRow({
  item,
  sessionId,
  onOpen,
  onAddToChat,
}: {
  item: ArtifactListItem
  sessionId: string
  onOpen: (item: ArtifactListItem) => void
  onAddToChat: (item: ArtifactListItem) => void
}) {
  const t = useTranslation()
  const disabled = !artifactOpenable(item)
  const mark = markOf(item, sessionId)
  const location = item.workDir === null
    ? [t('artifacts.unbound'), getFileNameFromPath(item.origin?.projectRoot ?? '')].filter(Boolean).join(' · ')
    : getFileNameFromPath(item.workDir)
  const branch = artifactBranch(item)
  const detail = artifactDetail(t, item)
  const title = artifactTitle(item)

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="row"
        disabled={disabled}
        onClick={() => onOpen(item)}
        className="min-w-0 flex-1 gap-2 rounded-[6px] py-[7px] pr-1.5 pl-1.5 text-left text-[12px] text-[var(--color-text-primary)]"
      >
        <Layers size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate">{title}</span>
            {mark === 'tool' && <span className="shrink-0 text-[10px] text-[var(--color-brand)]">{t('artifacts.modifiedHere')}</span>}
            {mark === 'snapshot' && <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{t('artifacts.maybeModifiedHere')}</span>}
          </span>
          <span className={`block truncate text-[11px] ${item.error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}>
            {detail}
          </span>
        </span>
        {(location || branch) && (
          <span className="flex max-w-[45%] shrink-0 items-center gap-1 truncate text-[11px] text-[var(--color-text-tertiary)]">
            {branch && <GitBranchIcon size={11} aria-hidden="true" />}
            <span className="truncate">{branch ?? location}</span>
          </span>
        )}
      </Button>
      <AddToChatButton title={title} onClick={() => onAddToChat(item)} />
    </div>
  )
}

function SystemRow({ item, onAddToChat }: { item: DesignSystemListItem; onAddToChat: (item: DesignSystemListItem) => void }) {
  const t = useTranslation()
  const title = item.manifest?.name ?? item.name
  const location = item.workDir === null ? t('artifacts.unbound') : getFileNameFromPath(item.workDir)
  const detail = item.error
    ? t('artifacts.invalidManifest', { reason: item.error })
    : item.manifest
      ? t(item.manifest.source === 'bundled' ? 'artifacts.systemBundled' : 'artifacts.systemExtracted')
      : ''

  return (
    <div className="flex items-center gap-0.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] py-[7px] pr-1.5 pl-1.5 text-[12px] text-[var(--color-text-primary)]">
        <Palette size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          <span className={`block truncate text-[11px] ${item.error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}>{detail}</span>
        </span>
        {location && <span className="max-w-[45%] shrink-0 truncate text-[11px] text-[var(--color-text-tertiary)]">{location}</span>}
      </div>
      <AddToChatButton title={title} onClick={() => onAddToChat(item)} />
    </div>
  )
}

function Section<T extends Pick<ArtifactListItem, 'artifactsDir' | 'name'>>({
  title,
  items,
  renderItem,
}: {
  title: string
  items: T[]
  renderItem: (item: T) => ReactNode
}) {
  if (items.length === 0) return null
  return (
    <section className="mt-3 first:mt-0">
      <h3 className="mb-1 px-1.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">{title}</h3>
      {items.map((item) => (
        <Fragment key={artifactKey(item)}>{renderItem(item)}</Fragment>
      ))}
    </section>
  )
}

export function ArtifactsView({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const writeVersion = useArtifactStore((state) => state.writeVersion)
  const openArtifact = useWorkspacePanelStore((state) => state.openArtifact)
  const addReference = useWorkspaceChatContextStore((state) => state.addReference)
  const [result, setResult] = useState<WorkspaceArtifactsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latestRequest.current
    setLoading(true)
    try {
      const next = await sessionsApi.getWorkspaceArtifacts(sessionId)
      if (request !== latestRequest.current) return
      setResult(next)
      setError(null)
    } catch (loadError) {
      if (request === latestRequest.current) setError(errorMessage(loadError))
    } finally {
      if (request === latestRequest.current) setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load, writeVersion])

  const open = (item: ArtifactListItem) => {
    openArtifact(sessionId, item, artifactRoot(item)).catch((openError: unknown) => toast.error(errorMessage(openError)))
  }

  const addFolderToChat = (dir: string, name: string) => {
    addReference(sessionId, { kind: 'file', path: dir, absolutePath: dir, name, isDirectory: true })
  }

  const addToChat = (item: ArtifactListItem) => addFolderToChat(item.dir, artifactTitle(item))

  const addSystemToChat = (item: DesignSystemListItem) => addFolderToChat(item.dir, item.manifest?.name ?? item.name)

  const renderArtifact = (item: ArtifactListItem) => (
    <ArtifactRow item={item} sessionId={sessionId} onOpen={open} onAddToChat={addToChat} />
  )

  const renderSystem = (item: DesignSystemListItem) => <SystemRow item={item} onAddToChat={addSystemToChat} />

  const renderBody = () => {
    if (!result) {
      return error
        ? <PanelMessage icon={CircleAlertIcon} tone="error" message={error} />
        : <PanelLoading label={t('common.loading')} />
    }
    const { systems } = result
    if (result.current.length === 0 && result.others.length === 0 && systems.current.length === 0 && systems.others.length === 0) {
      return <PanelMessage icon={FolderOpenIcon} message={t('artifacts.empty')} />
    }
    return (
      <div className="px-2 py-2">
        {error && <PanelMessage icon={CircleAlertIcon} tone="error" message={error} compact />}
        <Section title={t('artifacts.current')} items={sortMarkedFirst(result.current, sessionId)} renderItem={renderArtifact} />
        <Section title={t('artifacts.others')} items={sortMarkedFirst(result.others, sessionId)} renderItem={renderArtifact} />
        <Section title={t('artifacts.systems')} items={systems.current} renderItem={renderSystem} />
        <Section title={`${t('artifacts.systems')} · ${t('artifacts.others')}`} items={systems.others} renderItem={renderSystem} />
      </div>
    )
  }

  return (
    <div data-testid="artifacts-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5">
        <h2 className="text-[12px] font-medium text-[var(--color-text-primary)]">{t('artifacts.title')}</h2>
        <HintTooltip content={t('artifacts.refresh')}>
          <Button variant="ghost" size="icon-sm" aria-label={t('artifacts.refresh')} disabled={loading} onClick={() => void load()}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </HintTooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{renderBody()}</div>
    </div>
  )
}
