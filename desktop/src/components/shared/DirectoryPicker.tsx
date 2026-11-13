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
  const triggerVariant = isWorkbar ? 'ghost-muted' : value ? 'outline' : 'link-muted'
  const triggerSize = isWorkbar ? 'toolbar' : value ? 'sm' : 'inline'

  const dropdownTitle = mode === 'recent' ? t('dirPicker.recent') : t('dirPicker.chooseProjectFolder')
  const dropdownContent = mode === 'recent' ? (
    <>
      {!isMobileBrowser && (
        <div className="px-4 py-2 text-3xs font-bold uppercase tracking-widest text-subtle-foreground">
          {t('dirPicker.recent')}
        </div>
      )}
      <div className={`${isMobileBrowser ? '' : 'max-h-[300px]'} overflow-y-auto`}>
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-subtle-foreground">{t('common.loading')}</div>
        ) : projects.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-subtle-foreground">{t('dirPicker.noRecent')}</div>
        ) : (
          projects.map((project) => {
            const isSelected = project.realPath === value
            return (
              <Button
                type="button"
                variant="ghost"
                size="row-lg"
                key={project.projectPath}
                onClick={() => handleSelect(project.realPath)}
                aria-current={isSelected ? 'true' : undefined}
                className={isMobileBrowser ? 'min-h-18' : undefined}
              >
                {project.isGit ? (
                  <GitBranch size={20} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                ) : (
                  <Folder size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {project.repoName || project.projectName}
                  </div>
                  <div className="truncate font-mono text-2xs text-subtle-foreground">
                    {project.realPath}
                  </div>
                </div>
                {isSelected && (
                  <Check size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                )}
              </Button>
            )
          })
        )}
      </div>
      <div className="border-t border-border">
        <Button type="button" variant="ghost-muted" size="row-lg" onClick={handleChooseFolder}>
          <FolderPlus size={18} aria-hidden="true" className="shrink-0" />
          {t('dirPicker.chooseFolder')}
        </Button>
      </div>
    </>
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <Button variant="link" size="inline" onClick={() => setMode('recent')} className="mr-2">
          {'← ' + t('dirPicker.recent')}
        </Button>
        <Button variant="link-muted" size="inline" onClick={() => loadBrowseDir('/')}>/</Button>
        {browsePath.split('/').filter(Boolean).map((seg, i, arr) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-3xs text-subtle-foreground">/</span>
            <Button variant="link" size="inline"
              onClick={() => loadBrowseDir('/' + arr.slice(0, i + 1).join('/'))}
            >{seg}</Button>
          </span>
        ))}
      </div>

      <div className={`${isMobileBrowser ? '' : 'max-h-[240px]'} overflow-y-auto`}>
        {loading ? (
          <div className="px-3 py-4 text-center text-xs text-subtle-foreground">{t('common.loading')}</div>
        ) : (
          <>
            {browseParent && browseParent !== browsePath && (
              <Button variant="ghost" size="row" onClick={() => loadBrowseDir(browseParent)}>
                <ArrowUp size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">..</span>
              </Button>
            )}
            {browseEntries.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-subtle-foreground">{t('dirPicker.noSubdirs')}</div>
            ) : browseEntries.map((entry) => (
              <div key={entry.path} className="flex w-full items-center gap-2 pr-3">
                <Button variant="ghost" size="row" onClick={() => loadBrowseDir(entry.path)} className="flex-1">
                  <Folder size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>
                </Button>
                <Button variant="secondary" size="xs" type="button" onClick={() => handleSelect(entry.path)}>
                  {t('common.select')}
                </Button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <span className="truncate font-mono text-3xs text-subtle-foreground">{browsePath}</span>
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
        size="flush"
        contentClassName="w-[min(400px,calc(100vw-24px))]"
        testId="directory-picker-menu"
        trigger={
          <Button variant={triggerVariant} size={triggerSize} disabled={disabled} className="max-w-full min-w-0">
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
