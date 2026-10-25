import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, RefreshCw } from 'lucide-react'
import { Button } from '../components/shared/Button'
import { SearchField } from '../components/shared/SearchField'
import { SegmentedControl } from '../components/shared/SegmentedControl'
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useMemoryStore } from '../stores/memoryStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUIStore } from '../stores/uiStore'
import type { MemoryFile, MemoryProject } from '../types/memory'

const DEFAULT_MEMORY_PATH = 'MEMORY.md'

export function MemorySettings() {
  const t = useTranslation()
  const {
    projects,
    files,
    selectedProjectId,
    selectedFile,
    draftContent,
    isLoadingProjects,
    isLoadingFiles,
    isLoadingFile,
    isSaving,
    error,
    fetchProjects,
    selectProject,
    fetchFiles,
    openFile,
    openListedFile,
    updateDraft,
    saveFile,
  } = useMemoryStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const pendingMemoryPath = useUIStore((s) => s.pendingMemoryPath)
  const setPendingMemoryPath = useUIStore((s) => s.setPendingMemoryPath)
  const [resourceQuery, setResourceQuery] = useState('')
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<MemoryViewMode>('preview')

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  )
  const activeCwd = activeSession?.workDir || activeSession?.projectPath || undefined
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const isDirty = Boolean(selectedFile && draftContent !== selectedFile.content)
  const filteredProjects = useMemo(
    () => filterProjects(projects, resourceQuery, selectedProjectId, files),
    [files, projects, resourceQuery, selectedProjectId],
  )
  const filteredFiles = useMemo(
    () => filterFiles(files, resourceQuery),
    [files, resourceQuery],
  )
  const fileTree = useMemo(
    () => buildMemoryFileTree(filteredFiles),
    [filteredFiles],
  )
  const previewContent = stripMarkdownFrontmatter(draftContent)

  useEffect(() => {
    void fetchProjects(activeCwd)
  }, [activeCwd, fetchProjects])

  useEffect(() => {
    if (!selectedProjectId) return
    void fetchFiles(selectedProjectId)
  }, [fetchFiles, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId) return
    setExpandedProjectId(selectedProjectId)
  }, [selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId || selectedFile || isLoadingFiles || isLoadingFile) return
    if (pendingMemoryPath) return
    const firstFile = files[0]
    if (firstFile) {
      void openFile(selectedProjectId, firstFile.path)
    }
  }, [files, isLoadingFile, isLoadingFiles, openFile, pendingMemoryPath, selectedFile, selectedProjectId])

  useEffect(() => {
    if (!pendingMemoryPath || isLoadingProjects || projects.length === 0) return
    const target = resolveMemoryFileTarget(projects, pendingMemoryPath)
    if (!target) {
      setPendingMemoryPath(null)
      return
    }
    if (selectedProjectId !== target.projectId) {
      selectProject(target.projectId)
      return
    }
    if (selectedFile?.path === target.path && !isLoadingFile) {
      setPendingMemoryPath(null)
      return
    }
    void openListedFile(target.projectId, target.path).then(() => {
      setPendingMemoryPath(null)
    })
  }, [
    isLoadingFile,
    isLoadingProjects,
    openListedFile,
    pendingMemoryPath,
    projects,
    selectProject,
    selectedFile?.path,
    selectedProjectId,
    setPendingMemoryPath,
  ])

  const handleRefresh = () => {
    void fetchProjects(activeCwd)
    if (selectedProjectId) {
      void fetchFiles(selectedProjectId)
    }
  }

  const handleProjectToggle = (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null)
      return
    }
    setExpandedProjectId(projectId)
    if (projectId !== selectedProjectId) {
      selectProject(projectId)
    }
  }

  const handleFileOpen = (file: MemoryFile) => {
    if (!selectedProjectId || file.path === selectedFile?.path) return
    void openFile(selectedProjectId, file.path)
  }

  const handlePreviewLinkClick = (href: string): boolean => {
    if (!selectedProjectId || !selectedFile) return false
    const targetPath = resolveMarkdownMemoryLink(
      href,
      selectedFile.path,
      selectedProject?.memoryDir,
      files,
    )
    if (!targetPath || targetPath === selectedFile.path) return false
    void openFile(selectedProjectId, targetPath)
    return true
  }

  const toggleFolder = (path: string) => {
    setCollapsedFolders((previous) => {
      const next = new Set(previous)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const forceExpandFiles = Boolean(resourceQuery.trim())
  const selectedFileName = selectedFile?.path ? fileNameFromPath(selectedFile.path) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SettingsPageHeader
        title={t('settings.memory.title')}
        description={t('settings.memory.subtitle')}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={handleRefresh}
            loading={isLoadingProjects || isLoadingFiles}
            icon={<RefreshCw size={13} aria-hidden="true" />}
          >
            {t('settings.memory.refresh')}
          </Button>
        }
      />

      {error && (
        <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
          {error}
        </div>
      )}

      <div className="grid min-h-[440px] flex-1 grid-cols-1 border-t border-[var(--color-border-separator)] min-[760px]:grid-cols-[184px_minmax(0,1fr)]">
        <aside
          aria-label={t('settings.memory.files')}
          className="flex min-w-0 flex-col gap-px border-b border-[var(--color-border-separator)] py-3 min-[760px]:border-b-0 min-[760px]:border-r min-[760px]:pr-3"
        >
          <SearchField
            value={resourceQuery}
            onChange={setResourceQuery}
            placeholder={t('settings.memory.searchFiles')}
            aria-label={t('settings.memory.resourceSearchPlaceholder')}
            className="mb-2.5"
          />
          {projects.length === 0 && !isLoadingProjects ? (
            <p className="px-2 py-1 text-xs text-[var(--color-text-tertiary)]">{t('settings.memory.emptyProjects')}</p>
          ) : filteredProjects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--color-text-tertiary)]">{t('settings.memory.noFileMatches')}</p>
          ) : (
            filteredProjects.map((project) => {
              const isExpanded = project.id === expandedProjectId
              const isSelected = project.id === selectedProjectId
              return (
                <ProjectTreeRow
                  key={project.id}
                  project={project}
                  expanded={isExpanded}
                  fileCount={isSelected && !isLoadingFiles ? files.length : project.fileCount}
                  loading={isSelected && isLoadingFiles}
                  fileTree={isSelected ? fileTree : []}
                  activePath={selectedFile?.path ?? null}
                  dirtyPath={isDirty ? selectedFile?.path ?? null : null}
                  collapsedFolders={collapsedFolders}
                  forceExpanded={forceExpandFiles}
                  onToggle={() => handleProjectToggle(project.id)}
                  onToggleFolder={toggleFolder}
                  onFileSelect={handleFileOpen}
                  emptyText={t('settings.memory.emptyFiles')}
                />
              )
            })
          )}
        </aside>

        <section aria-label={selectedFileName ?? t('settings.memory.noFileSelected')} className="flex min-w-0 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-separator)] py-3 min-[760px]:pl-5">
            <div className="grid min-w-0 gap-px">
              <div className="flex min-w-0 items-center gap-2.5">
                <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {selectedFileName ?? t('settings.memory.noFileSelected')}
                </h3>
                {selectedFile ? (
                  <span
                    className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap text-[11px] ${
                      isDirty ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-secondary)]'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${isDirty ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-success)]'}`}
                    />
                    {isDirty ? t('settings.memory.unsaved') : t('settings.memory.saved')}
                  </span>
                ) : null}
              </div>
              <span
                className="truncate text-[11px] text-[var(--color-text-tertiary)]"
                title={selectedProject && selectedFile ? `${selectedProject.memoryDir}/${selectedFile.path}` : undefined}
              >
                {selectedProject
                  ? [
                      projectDisplayName(selectedProject.label),
                      selectedFile ? `memory/${selectedFile.path}` : null,
                      selectedFile ? formatBytes(selectedFile.bytes) : null,
                      selectedFile?.updatedAt ? formatDate(selectedFile.updatedAt) : null,
                    ].filter(Boolean).join(' · ')
                  : t('settings.memory.selectProject')}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SegmentedControl<MemoryViewMode>
                label={t('settings.memory.viewMode')}
                value={viewMode}
                onChange={setViewMode}
                disabled={!selectedFile}
                options={[
                  { value: 'preview', label: t('settings.memory.preview') },
                  { value: 'edit', label: t('settings.memory.edit') },
                ]}
              />
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={!selectedFile || !isDirty || isSaving}
                onClick={() => selectedFile && updateDraft(selectedFile.content)}
              >
                {t('settings.memory.revert')}
              </Button>
              <Button
                type="button"
                size="xs"
                disabled={!selectedFile || !isDirty}
                loading={isSaving}
                onClick={() => void saveFile()}
              >
                {t('common.save')}
              </Button>
            </div>
          </header>

          {selectedFile ? (
            <div className="flex min-h-0 flex-1 py-4 min-[760px]:pl-5">
              {viewMode === 'edit' ? (
                <textarea
                  aria-label={t('settings.memory.editor')}
                  value={draftContent}
                  onChange={(event) => updateDraft(event.target.value)}
                  spellCheck={false}
                  className="min-h-[360px] w-full flex-1 resize-none border-0 bg-transparent p-0 font-mono text-[13px] leading-[1.8] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus-visible:outline-none"
                />
              ) : (
                <div className="min-w-0 max-w-[62ch] flex-1">
                  <MarkdownRenderer
                    content={previewContent || ' '}
                    variant="document"
                    onLinkClick={handlePreviewLinkClick}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-xs text-[var(--color-text-tertiary)]">
              {isLoadingFile ? t('common.loading') : t('settings.memory.selectFile')}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

type MemoryViewMode = 'preview' | 'edit'

function ProjectTreeRow({
  project,
  expanded,
  fileCount,
  loading,
  fileTree,
  activePath,
  dirtyPath,
  collapsedFolders,
  forceExpanded,
  onToggle,
  onToggleFolder,
  onFileSelect,
  emptyText,
}: {
  project: MemoryProject
  expanded: boolean
  fileCount: number
  loading: boolean
  fileTree: MemoryTreeNode[]
  activePath: string | null
  dirtyPath: string | null
  collapsedFolders: Set<string>
  forceExpanded: boolean
  onToggle: () => void
  onToggleFolder: (path: string) => void
  onFileSelect: (file: MemoryFile) => void
  emptyText: string
}) {
  const t = useTranslation()
  const display = projectDisplayName(project.label)
  return (
    <div>
      <button
        type="button"
        data-testid="memory-project-row"
        onClick={onToggle}
        title={project.label}
        aria-expanded={expanded}
        aria-label={t('settings.memory.toggleFolder', { name: display })}
        className={ROW_CLASS}
      >
        {expanded
          ? <ChevronDown size={14} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          : <ChevronRight size={14} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{display}</span>
        {!project.exists ? (
          <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{t('settings.memory.missing')}</span>
        ) : (
          <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{fileCount}</span>
        )}
      </button>

      {expanded ? (
        loading ? (
          <p className="py-1 pl-7 pr-2 text-xs text-[var(--color-text-tertiary)]">{t('common.loading')}</p>
        ) : fileTree.length === 0 ? (
          <p className="py-1 pl-7 pr-2 text-xs text-[var(--color-text-tertiary)]">{emptyText}</p>
        ) : (
          fileTree.map((node) => (
            <MemoryTreeRow
              key={node.id}
              node={node}
              depth={1}
              activePath={activePath}
              dirtyPath={dirtyPath}
              collapsedFolders={collapsedFolders}
              forceExpanded={forceExpanded}
              onToggleFolder={onToggleFolder}
              onFileSelect={onFileSelect}
            />
          ))
        )
      ) : null}
    </div>
  )
}

const ROW_CLASS =
  'flex w-full min-w-0 items-center gap-1.5 rounded-[7px] px-2 py-[5px] text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]'

function rowIndent(depth: number): number {
  return 8 + depth * 18
}

function FileRow({
  file,
  active,
  dirty,
  onSelect,
  depth,
}: {
  file: MemoryFile
  active: boolean
  dirty: boolean
  onSelect: () => void
  depth: number
}) {
  const t = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      style={{ paddingLeft: `${rowIndent(depth)}px` }}
      className={`${ROW_CLASS} text-xs ${
        active
          ? 'bg-[var(--color-surface-selected)] !text-[var(--color-text-primary)] hover:bg-[var(--color-surface-selected)]'
          : '!text-[var(--color-text-secondary)]'
      }`}
    >
      <FileText size={14} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{file.title}</span>
      {dirty ? (
        <span
          data-testid="memory-dirty-dot"
          role="img"
          aria-label={t('settings.memory.unsaved')}
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)]"
        />
      ) : null}
    </button>
  )
}

function MemoryTreeRow({
  node,
  depth,
  activePath,
  dirtyPath,
  collapsedFolders,
  forceExpanded,
  onToggleFolder,
  onFileSelect,
}: {
  node: MemoryTreeNode
  depth: number
  activePath: string | null
  dirtyPath: string | null
  collapsedFolders: Set<string>
  forceExpanded: boolean
  onToggleFolder: (path: string) => void
  onFileSelect: (file: MemoryFile) => void
}) {
  const t = useTranslation()
  if (node.kind === 'file') {
    return (
      <FileRow
        file={node.file}
        active={node.file.path === activePath}
        dirty={node.file.path === dirtyPath}
        depth={depth}
        onSelect={() => onFileSelect(node.file)}
      />
    )
  }

  const isCollapsed = !forceExpanded && collapsedFolders.has(node.path)
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleFolder(node.path)}
        aria-expanded={!isCollapsed}
        aria-label={t('settings.memory.toggleFolder', { name: node.name })}
        className={`${ROW_CLASS} text-xs !text-[var(--color-text-secondary)]`}
        style={{ paddingLeft: `${rowIndent(depth)}px` }}
      >
        {isCollapsed
          ? <ChevronRight size={14} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          : <ChevronDown size={14} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{node.fileCount}</span>
      </button>
      {!isCollapsed
        ? node.children.map((child) => (
            <MemoryTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              dirtyPath={dirtyPath}
              collapsedFolders={collapsedFolders}
              forceExpanded={forceExpanded}
              onToggleFolder={onToggleFolder}
              onFileSelect={onFileSelect}
            />
          ))
        : null}
    </div>
  )
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/').trim()
}

function filterProjects(
  projects: MemoryProject[],
  query: string,
  selectedProjectId: string | null,
  selectedProjectFiles: MemoryFile[],
): MemoryProject[] {
  const normalized = normalizeSearch(query)
  if (!normalized) return projects
  return projects.filter((project) =>
    normalizeSearch(`${project.label} ${project.memoryDir} ${project.id}`).includes(normalized) ||
    (project.id === selectedProjectId && selectedProjectFiles.some((file) =>
      normalizeSearch(`${file.title} ${file.path} ${file.description ?? ''} ${file.type ?? ''}`).includes(normalized),
    )),
  )
}

function filterFiles(files: MemoryFile[], query: string): MemoryFile[] {
  const normalized = normalizeSearch(query)
  if (!normalized) return files
  return files.filter((file) =>
    normalizeSearch(`${file.title} ${file.path} ${file.description ?? ''} ${file.type ?? ''}`).includes(normalized),
  )
}

function projectDisplayName(label: string): string {
  const normalized = label.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  return parts[0] ?? label
}

function stripMarkdownFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end < 0) return content
  const after = content.indexOf('\n', end + 4)
  return after < 0 ? '' : content.slice(after + 1).trimStart()
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function resolveMemoryFileTarget(projects: MemoryProject[], absolutePath: string): { projectId: string; path: string } | null {
  const target = normalizeFsPath(absolutePath)
  for (const project of projects) {
    const memoryDir = normalizeFsPath(project.memoryDir)
    if (!memoryDir) continue
    if (target === memoryDir) {
      return { projectId: project.id, path: DEFAULT_MEMORY_PATH }
    }
    if (target.startsWith(`${memoryDir}/`)) {
      return {
        projectId: project.id,
        path: target.slice(memoryDir.length + 1),
      }
    }
  }
  return null
}

function resolveMarkdownMemoryLink(
  href: string,
  currentPath: string,
  projectMemoryDir: string | undefined,
  files: MemoryFile[],
): string | null {
  const rawHref = safeDecodeUriComponent(href.trim())
  if (!rawHref || rawHref.startsWith('#')) return null

  let target = rawHref
  try {
    const url = new URL(rawHref)
    if (url.protocol !== 'file:') return null
    target = url.pathname
  } catch {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawHref)) return null
  }

  target = stripMarkdownLinkSuffix(target)
  if (!target || !target.endsWith('.md')) return null

  const absoluteTarget = normalizeFsPath(target)
  const memoryDir = projectMemoryDir ? normalizeFsPath(projectMemoryDir) : ''
  if (memoryDir) {
    if (absoluteTarget === memoryDir) return DEFAULT_MEMORY_PATH
    if (absoluteTarget.startsWith(`${memoryDir}/`)) {
      return findMemoryFileByPath(files, absoluteTarget.slice(memoryDir.length + 1))
    }
  }

  if (target.startsWith('/')) return null

  const currentParts = currentPath.split('/').filter(Boolean)
  const baseParts = currentParts.slice(0, -1)
  const resolvedParts: string[] = []
  for (const part of [...baseParts, ...target.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') {
      resolvedParts.pop()
      continue
    }
    resolvedParts.push(part)
  }

  return findMemoryFileByPath(files, resolvedParts.join('/'))
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripMarkdownLinkSuffix(value: string): string {
  return value.split('#')[0]?.split('?')[0]?.trim() ?? ''
}

function findMemoryFileByPath(files: MemoryFile[], path: string): string | null {
  const normalized = normalizeFsPath(path)
  return files.find((file) => normalizeFsPath(file.path) === normalized)?.path ?? null
}

type MemoryTreeNode =
  | {
      kind: 'folder'
      id: string
      name: string
      path: string
      fileCount: number
      children: MemoryTreeNode[]
    }
  | {
      kind: 'file'
      id: string
      name: string
      path: string
      file: MemoryFile
    }

type MutableFolderNode = Extract<MemoryTreeNode, { kind: 'folder' }>

function buildMemoryFileTree(files: MemoryFile[]): MemoryTreeNode[] {
  const root: MutableFolderNode = {
    kind: 'folder',
    id: '__root__',
    name: '__root__',
    path: '',
    fileCount: 0,
    children: [],
  }

  const folders = new Map<string, MutableFolderNode>([['', root]])
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let parent = root
    parts.slice(0, -1).forEach((part, index) => {
      const folderPath = parts.slice(0, index + 1).join('/')
      let folder = folders.get(folderPath)
      if (!folder) {
        folder = {
          kind: 'folder',
          id: `folder:${folderPath}`,
          name: part,
          path: folderPath,
          fileCount: 0,
          children: [],
        }
        folders.set(folderPath, folder)
        parent.children.push(folder)
      }
      folder.fileCount += 1
      parent = folder
    })
    parent.children.push({
      kind: 'file',
      id: `file:${file.path}`,
      name: parts[parts.length - 1] ?? file.name,
      path: file.path,
      file,
    })
  }

  sortMemoryTree(root.children)
  return root.children
}

function sortMemoryTree(nodes: MemoryTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    const aIndex = a.kind === 'file' ? a.file.isIndex : false
    const bIndex = b.kind === 'file' ? b.file.isIndex : false
    if (aIndex !== bIndex) return aIndex ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const node of nodes) {
    if (node.kind === 'folder') sortMemoryTree(node.children)
  }
}

function fileNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
