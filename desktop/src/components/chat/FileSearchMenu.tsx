import { ChevronRightIcon, FileTextIcon, FolderIcon, FolderOpenIcon, LoaderCircleIcon } from 'lucide-react'
import { Kbd } from '../shared/ui/kbd'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { forwardRef, useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react'
import { ApiError } from '../../api/client'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
  relativePath?: string
}

export type FileSearchMenuHandle = {
  handleKeyDown: (e: KeyboardEvent) => void
}

type Props = {
  cwd: string
  filter?: string
  compact?: boolean
  onSelect: (path: string, relativePath: string, isDirectory: boolean) => void
  onNavigate?: (relativePath: string) => void
}

export const FileSearchMenu = forwardRef<FileSearchMenuHandle, Props>(({ cwd, filter = '', compact = false, onSelect, onNavigate }, ref) => {
  const t = useTranslation()
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const [currentPath, setCurrentPath] = useState(cwd)
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [rootPath, setRootPath] = useState(cwd)
  const listRef = useRef<HTMLDivElement>(null)
  const currentPathRef = useRef(cwd)
  const rootPathRef = useRef(cwd)

  const getErrorState = (error: unknown): { errorKey: TranslationKey | null; errorMessage: string | null } => {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        return { errorKey: 'fileSearch.accessDenied', errorMessage: null }
      }

      const apiMessage =
        typeof error.body === 'string'
          ? error.body
          : typeof error.body === 'object' &&
              error.body !== null &&
              'error' in error.body &&
              typeof error.body.error === 'string'
            ? error.body.error
            : null

      if (apiMessage) {
        return { errorKey: null, errorMessage: apiMessage }
      }
    }

    return { errorKey: 'fileSearch.loadFailed', errorMessage: null }
  }

  const getRelativePath = useCallback((entry: DirEntry) => {
    const basePath = (cwd || rootPath).replace(/\/+$/, '')
    if (entry.path.startsWith(`${basePath}/`)) return entry.path.slice(basePath.length + 1)
    if (entry.relativePath) return entry.relativePath
    return entry.name
  }, [cwd, rootPath])

  const getDisplayPath = useCallback((entry: DirEntry) => {
    const relativePath = getRelativePath(entry).replace(/\\/g, '/')
    if (!entry.isDirectory) return relativePath
    return `${relativePath.replace(/\/+$/, '')}/`
  }, [getRelativePath])

  const selectEntry = useCallback((entry: DirEntry) => {
    onSelect(entry.path, getRelativePath(entry), entry.isDirectory)
  }, [getRelativePath, onSelect])

  const parseFilter = (rawFilter: string): { navigateTo: string; searchQuery: string } => {
    const trimmed = rawFilter.trim()
    const basePath = (cwd || rootPathRef.current).replace(/\/+$/, '')
    if (!trimmed) return { navigateTo: basePath, searchQuery: '' }
    if (trimmed.endsWith('/')) {
      if (!basePath) return { navigateTo: '', searchQuery: trimmed.replace(/\/+$/, '') }
      return { navigateTo: `${basePath}/${trimmed.replace(/\/+$/, '')}`, searchQuery: '' }
    }
    return { navigateTo: basePath, searchQuery: trimmed }
  }

  const loadDir = useCallback(async (dirPath: string, searchQuery: string) => {
    setLoading(true)
    setErrorMessage(null)
    setErrorKey(null)
    if (dirPath !== currentPathRef.current) {
      setCurrentPath(dirPath)
      currentPathRef.current = dirPath
    }
    try {
      if (searchQuery) {
        setIsSearchMode(true)
        const result = await filesystemApi.search(searchQuery, dirPath)
        setCurrentPath(result.currentPath)
        currentPathRef.current = result.currentPath
        if (!cwd) {
          setRootPath(result.currentPath)
          rootPathRef.current = result.currentPath
        }
        setEntries(result.entries)
      } else {
        setIsSearchMode(false)
        const result = await filesystemApi.browse(dirPath, { includeFiles: true })
        setCurrentPath(result.currentPath)
        currentPathRef.current = result.currentPath
        if (!cwd) {
          setRootPath(result.currentPath)
          rootPathRef.current = result.currentPath
        }
        setEntries(result.entries)
      }
      setSelectedIndex(0)
    } catch (error) {
      setEntries([])
      const nextError = getErrorState(error)
      setErrorKey(nextError.errorKey)
      setErrorMessage(nextError.errorMessage)
    }
    setLoading(false)
  }, [cwd])

  const navigateEntry = useCallback((entry: DirEntry) => {
    if (!entry.isDirectory) return
    const relativePath = `${getRelativePath(entry).replace(/\/+$/, '')}/`
    void loadDir(entry.path, '')
    onNavigate?.(relativePath)
  }, [getRelativePath, loadDir, onNavigate])

  useEffect(() => {
    currentPathRef.current = cwd
    rootPathRef.current = cwd
    setRootPath(cwd)
    setCurrentPath(cwd)
  }, [cwd])

  useEffect(() => {
    const { navigateTo, searchQuery } = parseFilter(filter)
    void loadDir(navigateTo, searchQuery)
  }, [cwd, filter, loadDir])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const selected = entries[selectedIndex]
      if (selected) {
        selectEntry(selected)
      }
      return
    }
    if (e.key === 'ArrowRight') {
      const selected = entries[selectedIndex]
      if (selected?.isDirectory) {
        e.preventDefault()
        navigateEntry(selected)
      }
      return
    }
  }, [entries, selectedIndex, selectEntry, navigateEntry])

  useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLButtonElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const breadcrumbs: string[] = []
  if (currentPath !== cwd && currentPath.startsWith(cwd)) {
    const rel = currentPath.slice(cwd.length).replace(/^\//, '')
    if (rel) breadcrumbs.push(...rel.split('/'))
  }

  const renderEntry = (entry: DirEntry, index: number) => {
    const relativePath = getRelativePath(entry)
    const displayPath = getDisplayPath(entry)
    const parentPath = relativePath.split('/').slice(0, -1).join('/')
    const selected = selectedIndex === index
    const EntryIcon = entry.isDirectory ? FolderIcon : FileTextIcon
    return (
      <div
        key={entry.path}
        data-index={index}
        className={`group flex items-stretch px-1.5 py-0.5 ${
          selected ? 'bg-hover' : ''
        }`}
        onMouseEnter={() => setSelectedIndex(index)}
      >
        <button
          type="button"
          onClick={() => selectEntry(entry)}
          className={`flex min-w-0 flex-1 items-center rounded-lg px-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            isSearchMode ? 'gap-2.5 py-2' : 'gap-3 py-2'
          }`}
          role="option"
          aria-selected={selected}
        >
          <EntryIcon className={`shrink-0 ${entry.isDirectory ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" size={17} />
          <span className="min-w-0 flex-1">
            {isSearchMode ? (
              <HintTooltip content={displayPath}><span
                className="block truncate font-mono text-sm text-foreground"
              >
                {displayPath}
              </span></HintTooltip>
            ) : (
              <>
                <span className="block truncate text-sm font-medium text-foreground">{entry.name}</span>
                <span className="block truncate font-mono text-2xs text-subtle-foreground">
                  {parentPath || (entry.isDirectory ? t('fileSearch.directory') : t('fileSearch.currentDirectory'))}
                </span>
              </>
            )}
          </span>
          {!isSearchMode ? (
            <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide text-subtle-foreground">
              {entry.isDirectory ? t('fileSearch.folderTag') : t('fileSearch.fileTag')}
            </span>
          ) : null}
        </button>
        {entry.isDirectory ? (
          <HintTooltip content={t('fileSearch.openFolder')}><button
            type="button"
            aria-label={t('fileSearch.openFolder')}
            onClick={(event) => {
              event.stopPropagation()
              navigateEntry(entry)
            }}
            className="my-1 flex w-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground opacity-70 transition hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover:opacity-100"
          >
            <ChevronRightIcon aria-hidden="true" size={16} />
          </button></HintTooltip>
        ) : null}
      </div>
    )
  }

  return (
    <div
      id="file-search-menu"
      className={`w-full overflow-hidden bg-popover ${
        compact ? 'min-w-0' : ''
      }`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-2xs">
        <FolderOpenIcon className="shrink-0 text-subtle-foreground" aria-hidden="true" size={14} />
        <span className="text-subtle-foreground font-mono">{cwd.split('/').pop() || cwd}</span>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-subtle-foreground">/</span>
            <span className="text-foreground font-mono">{seg}</span>
          </span>
        ))}
        {isSearchMode && filter ? (
          <span className="ml-auto truncate font-mono text-2xs text-subtle-foreground">@{filter}</span>
        ) : null}
        {loading && (
          <LoaderCircleIcon className="shrink-0 text-subtle-foreground animate-spin ml-1" aria-hidden="true" size={12} />
        )}
      </div>

      <div ref={listRef} className="max-h-[300px] overflow-y-auto py-1">
        {loading && entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-subtle-foreground">{t('fileSearch.searching')}</div>
        ) : (errorKey || errorMessage) ? (
          <div className="px-4 py-6 text-center text-xs text-destructive">
            {errorKey ? t(errorKey) : errorMessage}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-subtle-foreground">
            {filter ? t('fileSearch.noMatch') : t('fileSearch.noFiles')}
          </div>
        ) : entries.map(renderEntry)}
      </div>

      {!compact ? (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-3xs text-subtle-foreground">
          <Kbd>↑↓</Kbd>
          <span>{t('fileSearch.navigate')}</span>
          <Kbd className="ml-2">Enter</Kbd>
          <span>{t('fileSearch.select')}</span>
          <Kbd className="ml-2">→</Kbd>
          <span>{t('fileSearch.open')}</span>
          <Kbd className="ml-2">Esc</Kbd>
          <span>{t('fileSearch.close')}</span>
        </div>
      ) : null}
    </div>
  )
})

FileSearchMenu.displayName = 'FileSearchMenu'
