import { FolderOpen, ListChecks, Pin, PinOff, RefreshCw, RotateCcw, X } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/ui/button'
import { SegmentedControl } from '../shared/SegmentedControl'
import { SettingsGroup, SettingsRow } from '../settings/SettingsRow'
import { useTranslation } from '../../i18n'

export type SidebarProjectOrganization = 'project' | 'recentProject' | 'time'
export type SidebarProjectSortBy = 'createdAt' | 'updatedAt'

export type ManagedProject = {
  key: string
  title: string
  subtitle: string | null
  pinned: boolean
  hidden: boolean
  canOpen: boolean
}

type ProjectManagementDialogProps = {
  open: boolean
  onClose: () => void
  organization: SidebarProjectOrganization
  sortBy: SidebarProjectSortBy
  onSetOrganization: (organization: SidebarProjectOrganization) => void
  onSetSortBy: (sortBy: SidebarProjectSortBy) => void
  projects: ManagedProject[]
  hiddenProjectCount: number
  onTogglePinned: (projectKey: string) => void
  onToggleHidden: (projectKey: string) => void
  onOpenInFinder: (projectKey: string) => void
  onRestoreAllHidden: () => void
  onRefresh: () => void
  isRefreshing: boolean
  isBatchMode: boolean
  onToggleBatchMode: () => void
}

/** "More → Projects & sessions": organization, sorting, pin / hide per project, refresh and batch entry. */
export function ProjectManagementDialog({
  open,
  onClose,
  organization,
  sortBy,
  onSetOrganization,
  onSetSortBy,
  projects,
  hiddenProjectCount,
  onTogglePinned,
  onToggleHidden,
  onOpenInFinder,
  onRestoreAllHidden,
  onRefresh,
  isRefreshing,
  isBatchMode,
  onToggleBatchMode,
}: ProjectManagementDialogProps) {
  const t = useTranslation()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('sidebar.projectManagement')}
      width={560}
      footer={(
        <>
          <Button
            size="xs"
            variant="outline"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw data-icon="inline-start" size={14} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {t('sidebar.refreshSessions')}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={onToggleBatchMode}
          >
            <ListChecks data-icon="inline-start" size={14} aria-hidden="true" />
            {isBatchMode ? t('sidebar.batchExit') : t('sidebar.batchManage')}
          </Button>
          <Button size="xs" onClick={onClose}>
            {t('sidebar.manageDone')}
          </Button>
        </>
      )}
    >
      <div data-testid="project-management-dialog">
        <SettingsGroup title={t('sidebar.organizeSidebar')}>
          <SettingsRow
            title={t('sidebar.organizationMode')}
            control={(
              <SegmentedControl<SidebarProjectOrganization>
                label={t('sidebar.organizationMode')}
                value={organization}
                onChange={onSetOrganization}
                options={[
                  { value: 'project', label: t('sidebar.organizeByProject') },
                  { value: 'recentProject', label: t('sidebar.organizeByRecentProject') },
                  { value: 'time', label: t('sidebar.organizeByTime') },
                ]}
              />
            )}
          />
          <SettingsRow
            title={t('sidebar.sortCondition')}
            control={(
              <SegmentedControl<SidebarProjectSortBy>
                label={t('sidebar.sortCondition')}
                value={sortBy}
                onChange={onSetSortBy}
                options={[
                  { value: 'createdAt', label: t('sidebar.sortByCreatedAt') },
                  { value: 'updatedAt', label: t('sidebar.sortByUpdatedAt') },
                ]}
              />
            )}
          />
        </SettingsGroup>

        <SettingsGroup title={t('sidebar.projects')}>
          {projects.length === 0 && (
            <p className="py-2.5 text-xs text-[var(--color-text-tertiary)]">{t('sidebar.noSessions')}</p>
          )}
          {projects.map((project) => (
            <SettingsRow
              key={project.key}
              title={(
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{project.title}</span>
                  {project.pinned && (
                    <Pin size={12} className="flex-shrink-0 text-[var(--color-text-tertiary)]" aria-label={t('sidebar.pinnedBadge')} />
                  )}
                  {project.hidden && (
                    <span className="flex-shrink-0 rounded-[4px] bg-[var(--color-surface-container-high)] px-1.5 text-ui-aux text-[var(--color-text-tertiary)]">
                      {t('sidebar.hiddenBadge')}
                    </span>
                  )}
                </span>
              )}
              description={project.subtitle ?? undefined}
              control={(
                <div className="flex items-center gap-1" data-testid={`project-management-row-${project.title}`}>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-pressed={project.pinned}
                    onClick={() => onTogglePinned(project.key)}
                  >
                    {project.pinned
                      ? <PinOff data-icon="inline-start" size={14} aria-hidden="true" />
                      : <Pin data-icon="inline-start" size={14} aria-hidden="true" />}
                    {t(project.pinned ? 'sidebar.unpinProject' : 'sidebar.pinProject')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!project.canOpen}
                    onClick={() => onOpenInFinder(project.key)}
                    aria-label={t('sidebar.openInFinder')}
                    title={t('sidebar.openInFinder')}
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onToggleHidden(project.key)}
                  >
                    {project.hidden
                      ? <RotateCcw data-icon="inline-start" size={14} aria-hidden="true" />
                      : <X data-icon="inline-start" size={14} aria-hidden="true" />}
                    {t(project.hidden ? 'sidebar.restoreProjectToSidebar' : 'sidebar.hideProjectFromSidebar')}
                  </Button>
                </div>
              )}
            />
          ))}
          {hiddenProjectCount > 0 && (
            <div className="pt-2.5">
              <Button
                size="xs"
                variant="outline"
                onClick={onRestoreAllHidden}
              >
                <RotateCcw data-icon="inline-start" size={14} aria-hidden="true" />
                {t('sidebar.restoreHiddenProjects', { count: hiddenProjectCount })}
              </Button>
            </div>
          )}
        </SettingsGroup>
      </div>
    </Modal>
  )
}
