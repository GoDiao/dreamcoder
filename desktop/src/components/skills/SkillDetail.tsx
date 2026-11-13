import { ArrowLeftIcon, BracesIcon, ChevronDownIcon, ChevronRightIcon, FileCodeIcon, FileIcon, FileTextIcon, FolderIcon, FolderOpenIcon, LayersIcon, NotepadTextIcon, SlidersHorizontalIcon, TerminalIcon, type LucideIcon } from 'lucide-react'
import { Button } from '../shared/ui/button'
import { DetailStat, MetaPill } from '../settings/SettingsSummary'
import { LoadingBlock } from '../shared/LoadingBlock'
import { useMemo, useState } from 'react'
import { useSkillStore } from '../../stores/skillStore'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { CodeViewer } from '../chat/CodeViewer'
import type { FileTreeNode, SkillFrontmatter } from '../../types/skill'
import { useUIStore } from '../../stores/uiStore'

const META_PRIORITY = [
  'description',
  'when_to_use',
  'argument-hint',
  'model',
  'effort',
  'allowed-tools',
  'paths',
  'agent',
  'context',
  'version',
  'user-invocable',
] as const

export function SkillDetail() {
  const { selectedSkill, selectedSkillReturnTab, isDetailLoading, clearSelection } = useSkillStore()
  const t = useTranslation()
  const [selectedFile, setSelectedFile] = useState<string>('SKILL.md')

  const normalizedSelection = useMemo(() => {
    if (!selectedSkill) return 'SKILL.md'
    return selectedSkill.files.some((file) => file.path === selectedFile)
      ? selectedFile
      : selectedSkill.files[0]?.path || 'SKILL.md'
  }, [selectedFile, selectedSkill])

  const handleBack = () => {
    const returnTab = selectedSkillReturnTab
    clearSelection()
    if (returnTab === 'plugins') {
      useUIStore.getState().openSettings('plugins')
    }
  }

  if (isDetailLoading) {
    return (
      <LoadingBlock />
    )
  }

  if (!selectedSkill) return null

  const { meta, tree, files } = selectedSkill
  const currentFile = files.find((f) => f.path === normalizedSelection) || files[0]
  const frontmatter = currentFile?.frontmatter
  const metaEntries = getMetaEntries(frontmatter)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 min-w-0">
      <div>
        <Button type="button" variant="ghost-muted" size="sm" onClick={handleBack}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          {t('settings.skills.back')}
        </Button>
      </div>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-2xs font-semibold uppercase tracking-widest text-subtle-foreground mb-2">
              {t('settings.skills.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-xl font-semibold leading-tight text-foreground break-all">
                {meta.displayName || meta.name}
              </h3>
              <MetaPill>{t(`settings.skills.source.${meta.source}`)}</MetaPill>
              {meta.version && <MetaPill>v{meta.version}</MetaPill>}
              {meta.userInvocable && <MetaPill>{t('settings.skills.slashCommand')}</MetaPill>}
            </div>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
              {meta.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-subtle-foreground">
              <span>{t('settings.skills.tokenEstimate', { count: String(Math.ceil(meta.contentLength / 4)) })}</span>
              <span>
                {files.length} {t('settings.skills.files')}
              </span>
              <span>{currentFile?.isEntry ? t('settings.skills.entryFile') : currentFile?.path}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <DetailStat
              label={t('settings.skills.summary.totalFiles')}
              value={String(files.length)}
              icon={FolderOpenIcon}
            />
            <DetailStat
              label={t('settings.skills.summary.tokens')}
              value={t('settings.skills.tokenEstimateShort', { count: String(Math.ceil(meta.contentLength / 4)) })}
              icon={NotepadTextIcon}
            />
            <DetailStat
              label={t('settings.skills.summary.source')}
              value={t(`settings.skills.source.${meta.source}`)}
              icon={LayersIcon}
            />
            <DetailStat
              label={t('settings.skills.summary.entry')}
              value={files.some((file) => file.isEntry) ? 'SKILL.md' : '—'}
              icon={FileTextIcon}
            />
          </div>
        </div>
      </section>

      {metaEntries.length > 0 && (
        <section className="rounded-2xl border border-border bg-background px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <SlidersHorizontalIcon className="shrink-0 text-subtle-foreground" aria-hidden="true" size={18} />
            <h4 className="text-sm font-semibold text-foreground">
              {t('settings.skills.metaTitle')}
            </h4>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {metaEntries.map(([key, value]) => (
              <div
                key={key}
                className="rounded-xl border border-border bg-card px-3 py-3 min-w-0"
              >
                <div className="text-2xs font-semibold uppercase tracking-widest text-subtle-foreground">
                  {formatMetaKey(key)}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground break-words">
                  {formatMetaValue(value)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-1 min-h-0 min-w-0 overflow-hidden rounded-2xl border border-border bg-background">
        <aside className="hidden w-[250px] flex-shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
          <div className="border-b border-border px-4 py-3">
            <div className="text-2xs font-semibold uppercase tracking-widest text-subtle-foreground">
              {t('settings.skills.filesPanel')}
            </div>
            <p className="mt-1 text-xs leading-5 text-subtle-foreground">
              {t('settings.skills.filesPanelHint')}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <TreeView
              nodes={tree}
              selectedPath={normalizedSelection}
              onSelect={setSelectedFile}
              depth={0}
            />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground break-all">
                  {currentFile?.path}
                </span>
                {currentFile?.isEntry && <MetaPill>{t('settings.skills.entryFile')}</MetaPill>}
              </div>
              <div className="mt-1 text-2xs text-subtle-foreground">
                {t('settings.skills.readingMode', {
                  mode:
                    currentFile?.language === 'markdown'
                      ? t('settings.skills.docMode')
                      : t('settings.skills.codeMode'),
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-background px-2.5 py-1 text-3xs font-semibold uppercase tracking-widest text-subtle-foreground border border-border">
                {currentFile?.language}
              </span>
            </div>
          </div>

          <div className="lg:hidden border-b border-border bg-background px-3 py-2 overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              {files.map((file) => {
                const active = file.path === normalizedSelection
                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'border-primary bg-primary-surface text-foreground'
                        : 'border-border text-muted-foreground hover:bg-hover'
                    }`}
                  >
                    {file.path}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-popover">
            {currentFile && (
              <div className={currentFile.language === 'markdown' ? 'px-6 py-5 lg:px-8' : 'p-4'}>
                {currentFile.language === 'markdown' ? (
                  <MarkdownRenderer
                    content={currentFile.body ?? currentFile.content}
                    variant="document"
                    className="mx-auto max-w-[72ch]"
                  />
                ) : (
                  <CodeViewer
                    code={currentFile.content}
                    language={currentFile.language}
                    maxLines={9999}
                    showLineNumbers
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function TreeView({
  nodes,
  selectedPath,
  onSelect,
  depth,
}: {
  nodes: FileTreeNode[]
  selectedPath: string
  onSelect: (path: string) => void
  depth: number
}) {
  return nodes.map((node) => (
    <TreeItem
      key={node.path}
      node={node}
      selectedPath={selectedPath}
      onSelect={onSelect}
      depth={depth}
    />
  ))
}

function TreeItem({
  node,
  selectedPath,
  onSelect,
  depth,
}: {
  node: FileTreeNode
  selectedPath: string
  onSelect: (path: string) => void
  depth: number
}) {
  const [expanded, setExpanded] = useState(true)
  const isSelected = node.path === selectedPath
  const isDir = node.type === 'directory'

  const ExpandIcon = expanded ? ChevronDownIcon : ChevronRightIcon
  const Icon = isDir ? (expanded ? FolderOpenIcon : FolderIcon) : fileIcon(node.name)

  return (
    <div>
      <button
        onClick={() => (isDir ? setExpanded(!expanded) : onSelect(node.path))}
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isSelected
            ? 'bg-selected text-foreground font-medium'
            : 'text-muted-foreground hover:bg-hover'
        }`}
        style={{ marginLeft: `${depth * 12}px`, width: `calc(100% - ${depth * 12}px)` }}
      >
        {isDir ? (
          <ExpandIcon className="shrink-0 text-subtle-foreground" aria-hidden="true" size={12} />
        ) : (
          <span style={{ width: 12 }} />
        )}
        <Icon className="shrink-0 text-subtle-foreground" aria-hidden="true" size={14} />
        <span className="truncate">{node.name}</span>
      </button>

      {isDir && expanded && node.children && (
        <TreeView
          nodes={node.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </div>
  )
}

function getMetaEntries(frontmatter?: SkillFrontmatter): Array<[string, unknown]> {
  if (!frontmatter) return []

  const entries = Object.entries(frontmatter).filter(([, value]) => {
    if (value == null) return false
    if (typeof value === 'string') return value.trim().length > 0
    if (Array.isArray(value)) return value.length > 0
    return true
  })

  entries.sort((a, b) => {
    const aIndex = META_PRIORITY.indexOf(a[0] as (typeof META_PRIORITY)[number])
    const bIndex = META_PRIORITY.indexOf(b[0] as (typeof META_PRIORITY)[number])
    const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex
    const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex
    return normalizedA - normalizedB || a[0].localeCompare(b[0])
  })

  return entries
}

function formatMetaKey(key: string) {
  return key.replace(/[-_]/g, ' ')
}

function formatMetaValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ')
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value)
  }
  return String(value)
}

function fileIcon(filename: string): LucideIcon {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
      return FileTextIcon
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rs':
    case 'go':
      return FileCodeIcon
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return BracesIcon
    case 'sh':
    case 'bash':
      return TerminalIcon
    default:
      return FileIcon
  }
}
