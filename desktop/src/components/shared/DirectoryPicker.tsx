import { useState, useEffect } from 'react'
import { pickDirectory } from '../../lib/shell'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { sessionsApi, type RecentProject } from '../../api/sessions'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { ResponsivePopover } from './ResponsivePopover'
import { Button } from './ui/button'
import { ArrowUp, Check, ChevronDown, Folder, FolderOpen, FolderPlus, GitBranch } from 'lucide-react'

type Props = {
  value: string
  onChange: (path: string) => void
  variant?: 'chip' | 'workbar'
  isGitProject?: boolean
  disabled?: boolean
}

type DirEntry = { name: string; path: string; isDirectory: boolean }

let cachedProjects: RecentProject[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000
const DESKTOP_WORKTREE_MARKER = '/.claude/worktrees/'

function projectNameFromPath(filePath: string) {
  const displayRoot = filePath.includes(DESKTOP_WORKTREE_MARKER)
    ? filePath.slice(0, filePath.indexOf(DESKTOP_WORKTREE_MARKER))
    : filePath
  return displayRoot.split('/').filter(Boolean).pop() || filePath
}

export function DirectoryPicker({ value, onChange, variant = 'chip', isGitProject = false, disabled = false }: Props) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<'recent' | 'browse'>('recent')
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [browseEntries, setBrowseEntries] = useState<DirEntry[]>([])
  const [browsePath, setBrowsePath] = useState('')
  const [browseParent, setBrowseParent] = useState('')
  const [loading, setLoading] = useState(false)
  const isMobileBrowser = useMobileViewport() && !isDesktopRuntime()

  useEffect(() => {
    if (!isOpen || mode !== 'recent') return
    if (cachedProjects && Date.now() - cacheTimestamp < CACHE_TTL) {
      setProjects(cachedProjects)
      return
    }
    setLoading(true)
    sessionsApi.getRecentProjects()
      .then(({ projects: p }) => {
        cachedProjects = p
        cacheTimestamp = Date.now()
        setProjects(p)
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [isOpen, mode])

  const loadBrowseDir = async (path?: string) => {
    setLoading(true)
    try {
      const result = await filesystemApi.browse(path)
      setBrowsePath(result.currentPath)
      setBrowseParent(result.parentPath)
      setBrowseEntries(result.entries)
    } catch (error) {
      console.error('[DirectoryPicker] Failed to browse directory:', error)
    }
    setLoading(false)
  }

  const handleSelect = (path: string) => {
    onChange(path)
    setIsOpen(false)
    setMode('recent')
    cachedProjects = null
  }

  const handleChooseFolder = async () => {
    if (isDesktopRuntime()) {
      setIsOpen(false)
      try {
        const selected = await pickDirectory({
          directory: true,
          multiple: false,
          title: t('dirPicker.chooseProjectFolder'),
        })
        if (selected) onChange(selected)
      } catch (err) {
        console.error('[DirectoryPicker] Failed to open folder dialog:', err)
      }
    } else {
      setMode('browse')
      loadBrowseDir(value || undefined)
    }
  }

  const selectedProject = projects.find((p) => p.realPath === value)
  const isWorkbar = variant === 'workbar'
  const selectedLabel = selectedProject?.repoName || selectedProject?.projectName || projectNameFromPath(value)
  const showGitIcon = selectedProject?.isGit || isGitProject
  const triggerClassName = isWorkbar
    ? 'inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-ui-aux font-medium leading-none text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none'
    : 'flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface-container-low)] hover:bg-[var(--color-surface-hover)] rounded-full text-xs transition-colors border border-[var(--color-border)]'
  const emptyTriggerClassName = isWorkbar
    ? 'flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-ui-aux font-medium leading-none text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none'
    : 'flex items-center gap-2 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors'

  const dropdownTitle = mode === 'recent' ? t('dirPicker.recent') : t('dirPicker.chooseProjectFolder')
  const dropdownContent = mode === 'recent' ? (
    <>
      {!isMobileBrowser && (
        <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
          {t('dirPicker.recent')}
        </div>
      )}
      <div className={`${isMobileBrowser ? '' : 'max-h-[300px]'} overflow-y-auto`}>
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
        ) : projects.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('dirPicker.noRecent')}</div>
        ) : (
          projects.map((project) => {
            const isSelected = project.realPath === value
            return (
              <Button variant="ghost" size="row"
                key={project.projectPath}
                onClick={() => handleSelect(project.realPath)}
                className={`gap-3 px-4 ${
                  isMobileBrowser ? 'min-h-[72px] py-3.5' : 'py-3'
                } ${
                  isSelected ? 'bg-[var(--color-surface-selected)]' : ''
                }`}
              >
                {project.isGit ? (
                  <GitBranch size={20} aria-hidden="true" className="shrink-0 text-ui-muted-foreground" />
                ) : (
                  <Folder size={18} aria-hidden="true" className="shrink-0 text-ui-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                    {project.repoName || project.projectName}
                  </div>
                  <div className="truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
                    {project.realPath}
                  </div>
                </div>
                {isSelected && (
                  <Check size={18} aria-hidden="true" className="shrink-0 text-ui-muted-foreground" />
                )}
              </Button>
            )
          })
        )}
      </div>
      <div className="border-t border-[var(--color-border)]">
        <Button variant="ghost" size="row"
          onClick={handleChooseFolder}
          className="gap-3 px-4 py-3"
        >
          <FolderPlus size={18} aria-hidden="true" className="shrink-0 text-ui-muted-foreground" />
          <span className="text-sm text-[var(--color-text-secondary)]">{t('dirPicker.chooseFolder')}</span>
        </Button>
      </div>
    </>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-3 py-2">
        <Button variant="ghost" onClick={() => setMode('recent')} className="mr-2 text-xs text-[var(--color-text-accent)] hover:underline">
          {'← ' + t('dirPicker.recent')}
        </Button>
        <Button variant="ghost" onClick={() => loadBrowseDir('/')} className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">/</Button>
        {browsePath.split('/').filter(Boolean).map((seg, i, arr) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--color-text-tertiary)]">/</span>
            <Button variant="ghost"
              onClick={() => loadBrowseDir('/' + arr.slice(0, i + 1).join('/'))}
              className="text-[10px] text-[var(--color-text-accent)] hover:underline"
            >{seg}</Button>
          </span>
        ))}
      </div>

      <div className={`${isMobileBrowser ? '' : 'max-h-[240px]'} overflow-y-auto`}>
        {loading ? (
          <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
        ) : (
          <>
            {browseParent && browseParent !== browsePath && (
              <Button variant="ghost" size="row" onClick={() => loadBrowseDir(browseParent)} className="gap-2 px-3">
                <ArrowUp size={18} aria-hidden="true" className="shrink-0 text-ui-muted-foreground" />
                <span className="text-xs text-[var(--color-text-secondary)]">..</span>
              </Button>
            )}
            {browseEntries.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{t('dirPicker.noSubdirs')}</div>
            ) : browseEntries.map((entry) => (
              <div
                key={entry.path}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-hover)]"
              >
                <Button variant="ghost"
                  type="button"
                  onClick={() => loadBrowseDir(entry.path)}
                  className="h-auto min-w-0 flex-1 justify-start px-0 text-left"
                >
                  <Folder size={18} aria-hidden="true" className="shrink-0 text-ui-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]">{entry.name}</span>
                </Button>
                <Button variant="ghost" type="button" onClick={() => handleSelect(entry.path)} className="rounded px-2 py-0.5 text-[10px] font-semibold text-[var(--color-brand)] transition-colors hover:bg-[var(--color-primary-fixed)]">
                  {t('common.select')}
                </Button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2">
        <span className="truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">{browsePath}</span>
        <Button onClick={() => handleSelect(browsePath)} size="sm">
          {t('dirPicker.useThisFolder')}
        </Button>
      </div>
    </>
  )

  return (
    <div className={isWorkbar ? `relative min-w-0 ${isMobileBrowser ? 'flex-1' : 'max-w-[320px] shrink'}` : 'relative'}>
      <ResponsivePopover
        open={isOpen}
        onOpenChange={(open) => { setIsOpen(open); if (open) setMode('recent') }}
        title={dropdownTitle}
        triggerTooltip={value || t('dirPicker.selectProject')}
        contentClassName="w-[min(400px,calc(100vw-24px))] gap-0 overflow-hidden p-0"
        testId="directory-picker-menu"
        trigger={
          <Button variant="ghost" disabled={disabled} className={value ? triggerClassName : emptyTriggerClassName}>
            {value && showGitIcon ? <GitBranch size={15} aria-hidden="true" /> : <FolderOpen size={15} aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{value ? selectedLabel : t('dirPicker.selectProject')}</span>
            {value && <ChevronDown size={13} aria-hidden="true" />}
          </Button>
        }
      >
        {dropdownContent}
      </ResponsivePopover>
    </div>
  )
}
