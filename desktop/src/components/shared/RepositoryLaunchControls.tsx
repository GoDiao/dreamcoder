import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Check,
  ChevronDown,
  GitBranch,
  GitFork,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import {
  sessionsApi,
  type RepositoryBranchInfo,
  type RepositoryContextResult,
} from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { DirectoryPicker } from './DirectoryPicker'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { ResponsivePopover } from './ResponsivePopover'
import { Command, CommandInput, CommandItem, CommandList } from './ui/command'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'
import { Switch } from './ui/switch'
import { PICKER_TRIGGER_CLASS } from '../controls/controlStyles'

/** A launch failure reported by the server, shown next to the project controls. */
export type RepositoryLaunchError = {
  kind: 'branch' | 'dirty' | 'other'
  message: string
}

type Props = {
  workDir: string
  onWorkDirChange: (path: string) => void
  branch: string | null
  onBranchChange: (branch: string | null) => void
  useWorktree: boolean
  onUseWorktreeChange: (enabled: boolean) => void
  onLaunchReadyChange?: (ready: boolean) => void
  disabled?: boolean
  placement?: 'standalone' | 'composer'
  launchError?: RepositoryLaunchError | null
  onLaunchErrorDismiss?: () => void
  /** Where composer-placed notices render (below the controls row); inline when absent. */
  noticeSlot?: HTMLElement | null
}

type NoticeAction = { label: string; onClick: () => void }

type LaunchNotice = {
  key: string
  icon: LucideIcon
  tone: 'warning' | 'neutral'
  title?: string
  body: string
  actions: NoticeAction[]
}

function LaunchNoticeView({ notice }: { notice: LaunchNotice }) {
  const Icon = notice.icon
  return (
    <div
      role={notice.tone === 'warning' ? 'alert' : 'status'}
      data-testid={`repo-launch-notice-${notice.key}`}
      className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2.5"
    >
      <Icon
        size={15}
        aria-hidden="true"
        className={`mt-0.5 shrink-0 ${notice.tone === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-tertiary)]'}`}
      />
      <div className="min-w-0 flex-1">
        {notice.title && (
          <div className="text-ui-body font-medium text-[var(--color-text-primary)]">{notice.title}</div>
        )}
        <p className={`text-ui-aux text-[var(--color-text-secondary)] [overflow-wrap:anywhere] ${notice.title ? 'mt-0.5' : ''}`}>
          {notice.body}
        </p>
        {notice.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {notice.actions.map((action) => (
              <Button key={action.label} size="xs" variant="outline" onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function stateMessage(context: RepositoryContextResult | null, error: string | null) {
  if (error) return error
  if (!context) return null
  if (context.state === 'not_git_repo') return null
  if (context.state === 'missing_workdir') return 'missing'
  if (context.state === 'error') return context.error || 'error'
  return null
}

export function RepositoryLaunchControls({
  workDir,
  onWorkDirChange,
  branch,
  onBranchChange,
  useWorktree,
  onUseWorktreeChange,
  onLaunchReadyChange,
  disabled = false,
  placement = 'standalone',
  launchError = null,
  onLaunchErrorDismiss,
  noticeSlot,
}: Props) {
  const t = useTranslation()
  const isMobileBrowser = useMobileViewport() && !isDesktopRuntime()
  const isComposerPlacement = placement === 'composer' && !isMobileBrowser
  const [context, setContext] = useState<RepositoryContextResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branchFilter, setBranchFilter] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!workDir) {
      setContext(null)
      setError(null)
      setLoading(false)
      onBranchChange(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    sessionsApi.getRepositoryContext(workDir)
      .then((result) => {
        if (cancelled) return
        setContext(result)
      })
      .catch((err) => {
        if (cancelled) return
        setContext(null)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workDir, onBranchChange, reloadToken])

  useEffect(() => {
    if (context?.state !== 'ok') {
      if (context && branch !== null) onBranchChange(null)
      return
    }

    const branchExists = branch && context.branches.some((candidate) => candidate.name === branch)
    if (branchExists) return

    const fallbackBranch = [
      context.currentBranch,
      context.defaultBranch,
      context.branches[0]?.name,
    ].find((name) => name && context.branches.some((candidate) => candidate.name === name))

    onBranchChange(fallbackBranch || null)
  }, [branch, context, onBranchChange])

  const selectedBranch = useMemo(() => {
    if (context?.state !== 'ok') return null
    return context.branches.find((candidate) => candidate.name === branch) ?? null
  }, [branch, context])

  const filteredBranches = useMemo(() => {
    if (context?.state !== 'ok') return []
    const query = branchFilter.trim().toLowerCase()
    if (!query) return context.branches
    return context.branches.filter((candidate) => (
      candidate.name.toLowerCase().includes(query) ||
      candidate.remoteRef?.toLowerCase().includes(query) ||
      candidate.worktreePath?.toLowerCase().includes(query)
    ))
  }, [branchFilter, context])

  const warningMessage = useMemo(() => {
    if (context?.state !== 'ok' || !selectedBranch || useWorktree) return null
    if (selectedBranch.name !== context.currentBranch && context.dirty) {
      return t('repoLaunch.dirtyWarning')
    }
    if (selectedBranch.name !== context.currentBranch && selectedBranch.checkedOut) {
      return t('repoLaunch.checkedOutWarning')
    }
    return null
  }, [context, selectedBranch, t, useWorktree])

  const selectBranch = (candidate: RepositoryBranchInfo) => {
    onBranchChange(candidate.name)
    setBranchMenuOpen(false)
    setBranchFilter('')
    onLaunchErrorDismiss?.()
  }

  const toggleWorktree = (enabled: boolean) => {
    onUseWorktreeChange(enabled)
    onLaunchErrorDismiss?.()
  }

  const switchToWorktree = () => {
    onUseWorktreeChange(true)
    onLaunchErrorDismiss?.()
  }

  const reopenBranchMenu = () => {
    setReloadToken((token) => token + 1)
    setBranchFilter('')
    setBranchMenuOpen(true)
  }

  const message = stateMessage(context, error)
  const isGitReady = context?.state === 'ok'
  const isDirtyWarning = !!warningMessage && context?.state === 'ok' && context.dirty && selectedBranch?.name !== context.currentBranch

  const notices: LaunchNotice[] = []
  if (launchError) {
    notices.push(
      launchError.kind === 'branch'
        ? {
            key: 'launch-branch',
            icon: GitBranch,
            tone: 'warning',
            title: t('repoLaunch.notice.branchTitle'),
            body: launchError.message,
            actions: isGitReady ? [{ label: t('repoLaunch.notice.pickBranch'), onClick: reopenBranchMenu }] : [],
          }
        : launchError.kind === 'dirty'
          ? {
              key: 'launch-dirty',
              icon: TriangleAlert,
              tone: 'warning',
              title: t('repoLaunch.notice.dirtyTitle'),
              body: launchError.message,
              actions: isGitReady && !useWorktree ? [{ label: t('repoLaunch.notice.useWorktree'), onClick: switchToWorktree }] : [],
            }
          : {
              key: 'launch-other',
              icon: AlertCircle,
              tone: 'warning',
              body: launchError.message,
              actions: [],
            },
    )
  } else if (warningMessage) {
    notices.push({
      key: isDirtyWarning ? 'dirty' : 'checked-out',
      icon: isDirtyWarning ? TriangleAlert : GitBranch,
      tone: 'warning',
      title: isDirtyWarning ? t('repoLaunch.notice.dirtyTitle') : undefined,
      body: warningMessage,
      actions: [{ label: t('repoLaunch.notice.useWorktree'), onClick: switchToWorktree }],
    })
  }
  if (message && workDir) {
    notices.push({
      key: message === 'missing' ? 'missing' : 'context-error',
      icon: AlertCircle,
      tone: 'neutral',
      body: message === 'missing' ? t('repoLaunch.missingWorkdir') : message,
      actions: message === 'missing'
        ? []
        : [{ label: t('repoLaunch.notice.retry'), onClick: () => setReloadToken((token) => token + 1) }],
    })
  }
  const noticeList = notices.length > 0 ? (
    <div className="flex flex-col gap-1.5">
      {notices.map((notice) => <LaunchNoticeView key={notice.key} notice={notice} />)}
    </div>
  ) : null
  const isLaunchReady = !workDir || (
    !loading &&
    (!!context || !!error) &&
    (
      context?.state !== 'ok' ||
      context.branches.length === 0 ||
      !!selectedBranch
    )
  )

  useEffect(() => {
    onLaunchReadyChange?.(isLaunchReady)
  }, [isLaunchReady, onLaunchReadyChange])

  const branchLabel = selectedBranch?.name || t('repoLaunch.noBranch')
  const branchTriggerLabel = useWorktree ? `${branchLabel} · ${t('repoLaunch.newWorktree')}` : branchLabel
  const BranchTriggerIcon = useWorktree ? GitFork : GitBranch
  const worktreeToggle = (
    <div className={`flex items-center gap-3 border-t border-[var(--color-border)] px-4 ${isMobileBrowser ? 'min-h-[56px] py-3' : 'py-2.5'}`}>
      <GitFork size={16} className="shrink-0 text-[var(--color-text-secondary)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {t('repoLaunch.newWorktree')}
        </span>
        <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
          {t('repoLaunch.newWorktreeHint')}
        </span>
      </span>
      <Switch checked={useWorktree} onCheckedChange={toggleWorktree} aria-label={t('repoLaunch.newWorktree')} />
    </div>
  )
  const workbarButtonClassName = isComposerPlacement
    ? `group ${PICKER_TRIGGER_CLASS}`
    : 'group inline-flex h-9 min-w-0 items-center gap-1.5 rounded-[7px] border border-transparent px-2.5 text-[13px] font-medium leading-none text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-lowest)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className={`flex min-w-0 flex-col ${isMobileBrowser ? 'gap-0' : isComposerPlacement ? 'gap-0' : 'gap-2'}`}>
      <div className={`flex min-w-0 items-center justify-start gap-x-1.5 gap-y-1 overflow-hidden ${
        placement === 'composer'
          ? `${isMobileBrowser ? 'flex-wrap' : 'flex-nowrap'} gap-x-0.5 bg-transparent`
          : isMobileBrowser
            ? 'min-h-[52px] flex-wrap rounded-none border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] px-3 py-2 shadow-none'
          : 'min-h-[48px] flex-nowrap rounded-b-xl border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]'
      }`}>
        <DirectoryPicker value={workDir} onChange={onWorkDirChange} variant="workbar" isGitProject={isGitReady} disabled={disabled} />

        {loading && workDir && !isMobileBrowser && (
          <div className={`inline-flex items-center gap-1.5 rounded-[7px] text-[var(--color-text-secondary)] ${isComposerPlacement ? 'h-7 px-1.5 text-ui-aux' : 'h-9 px-2.5 text-[13px]'}`}>
            <Spinner aria-hidden="true" className="size-3.5 shrink-0" />
            <span>{t('common.loading')}</span>
          </div>
        )}

        {isGitReady && (
          <>
            {!isComposerPlacement && (
              <span className="hidden h-4 w-px shrink-0 bg-[var(--color-border-separator)] opacity-70 sm:block" aria-hidden="true" />
            )}
            <ResponsivePopover
              open={branchMenuOpen}
              onOpenChange={(open) => { setBranchMenuOpen(open); if (open) setBranchFilter('') }}
              title={t('repoLaunch.selectBranch')}
              triggerTooltip={branchTriggerLabel}
              contentClassName="w-[min(390px,calc(100vw-24px))] gap-0 overflow-hidden p-0"
              trigger={
                <Button
                  variant="ghost"
                  disabled={disabled || loading || context.branches.length === 0}
                  aria-label={`${t('repoLaunch.selectBranch')}: ${branchTriggerLabel}`}
                  className={`${workbarButtonClassName} ${isMobileBrowser ? 'max-w-[160px] shrink-0' : isComposerPlacement ? 'max-w-[200px] shrink' : 'max-w-[260px] shrink'}`}
                >
                  <BranchTriggerIcon size={isComposerPlacement ? 14 : 17} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{branchLabel}</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </Button>
              }
            >
              <Command label={t('repoLaunch.selectBranch')} defaultValue={selectedBranch?.name} shouldFilter={false} loop>
                <CommandInput value={branchFilter} onValueChange={setBranchFilter} placeholder={t('repoLaunch.searchBranch')} />
                <CommandList aria-label={t('repoLaunch.selectBranch')}>
                  {filteredBranches.length === 0 && <p role="status" className="p-4 text-sm text-ui-muted-foreground">{t('repoLaunch.noBranchMatch')}</p>}
                  {filteredBranches.map((candidate) => (
                    <CommandItem key={candidate.name} value={candidate.name} onSelect={() => selectBranch(candidate)} className="min-h-11 gap-3 px-3 py-2">
                      <GitBranch aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{candidate.name}</span>
                        <span className="block truncate text-xs text-ui-muted-foreground">
                          {candidate.current ? t('repoLaunch.currentBranch') : candidate.checkedOut ? t('repoLaunch.checkedOut') : candidate.remote && !candidate.local ? candidate.remoteRef || t('repoLaunch.remoteBranch') : t('repoLaunch.localBranch')}
                        </span>
                      </span>
                      {candidate.name === selectedBranch?.name && <Check aria-hidden="true" />}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
              {worktreeToggle}
            </ResponsivePopover>

          </>
        )}
      </div>

      {noticeList && (
        isComposerPlacement && noticeSlot
          ? createPortal(noticeList, noticeSlot)
          : <div className={isComposerPlacement ? 'pt-1.5' : 'px-1'}>{noticeList}</div>
      )}

    </div>
  )
}
