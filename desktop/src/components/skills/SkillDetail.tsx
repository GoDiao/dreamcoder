import { ArrowLeftIcon, CodeIcon, EyeIcon, FileWarningIcon, ScrollTextIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../shared/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../shared/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '../shared/ui/toggle-group'
import { CodeBlock, CodeBlockContent, CodeBlockLine } from '../shared/ui/code-block'
import { LoadingBlock } from '../shared/LoadingBlock'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { PanelMessage } from '../workspace/PanelStates'
import { SkillFileTree } from './SkillFileTree'
import { useSkillStore } from '../../stores/skillStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { useHighlightedCode } from '../../hooks/useHighlightedCode'
import { filesystemApi } from '../../api/filesystem'
import type { SkillFile, SkillFrontmatter } from '../../types/skill'

const META_PRIORITY = [
  'when_to_use',
  'argument-hint',
  'model',
  'effort',
  'allowed-tools',
  'paths',
  'agent',
  'context',
] as const

const SHOWN_ELSEWHERE = new Set(['name', 'description', 'version', 'user-invocable'])

type ViewMode = 'preview' | 'source'

type Fact = { label: string; value: string; mono?: boolean }

export function SkillDetail() {
  const selectedSkill = useSkillStore((state) => state.selectedSkill)
  const returnTab = useSkillStore((state) => state.selectedSkillReturnTab)
  const isDetailLoading = useSkillStore((state) => state.isDetailLoading)
  const clearSelection = useSkillStore((state) => state.clearSelection)
  const t = useTranslation()
  const [selectedFile, setSelectedFile] = useState('SKILL.md')
  const [viewMode, setViewMode] = useState<ViewMode>('preview')

  const currentFile = useMemo(() => {
    if (!selectedSkill) return undefined
    return selectedSkill.files.find((file) => file.path === selectedFile) ?? selectedSkill.files[0]
  }, [selectedFile, selectedSkill])

  if (isDetailLoading) return <LoadingBlock />
  if (!selectedSkill) return null

  const { meta, tree, files, skillRoot } = selectedSkill
  const entryFile = files.find((file) => file.isEntry)
  const sourceLabel = t(`settings.skills.source.${meta.source}`)
  const tokens = new Intl.NumberFormat().format(Math.ceil(meta.contentLength / 4))
  const byline = [sourceLabel, meta.pluginName, meta.version && `v${meta.version}`].filter(Boolean).join(' · ')
  const sections: Fact[] = [
    { label: t('settings.skills.detail.description'), value: meta.description },
    ...getMetaEntries(entryFile?.frontmatter).map(([key, value]) => ({ label: formatMetaKey(key), value: formatMetaValue(value) })),
  ]
  const facts: Fact[] = [
    { label: t('settings.skills.detail.source'), value: sourceLabel },
    ...(meta.pluginName ? [{ label: t('settings.skills.detail.plugin'), value: meta.pluginName }] : []),
    ...(meta.userInvocable ? [{ label: t('settings.skills.detail.command'), value: `/${meta.name}`, mono: true }] : []),
    ...(meta.version ? [{ label: t('settings.skills.detail.version'), value: meta.version }] : []),
    { label: t('settings.skills.detail.size'), value: t('settings.skills.detail.sizeValue', { tokens }) },
    { label: t('settings.skills.detail.location'), value: skillRoot, mono: true },
  ]

  const handleBack = () => {
    clearSelection()
    if (returnTab === 'plugins') useUIStore.getState().openSettings('plugins')
  }

  return (
    <div className="absolute inset-0 flex min-w-0 flex-col">
      <div>
        <Button type="button" variant="ghost-muted" size="sm" onClick={handleBack}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          {t(returnTab === 'plugins' ? 'settings.skills.detail.backToPlugins' : 'settings.skills.detail.backToSkills')}
        </Button>
      </div>

      <header className="mt-4 flex min-w-0 items-center gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <ScrollTextIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-foreground">{meta.displayName || meta.name}</h3>
          <p className="truncate text-sm text-muted-foreground">{byline}</p>
        </div>
      </header>

      <Tabs defaultValue="overview" className="mt-5 min-h-0 flex-1 gap-0">
        <TabsList variant="line">
          <TabsTrigger value="overview">{t('settings.skills.detail.overview')}</TabsTrigger>
          <TabsTrigger value="contents">{t('settings.skills.detail.contents', { count: String(files.length) })}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="@container min-h-0 overflow-y-auto pt-6">
          <div className="grid gap-8 @2xl:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-6 @2xl:col-span-2">
              {sections.map(({ label, value }) => (
                <section key={label} className="min-w-0">
                  <h4 className="text-xs text-muted-foreground first-letter:uppercase">{label}</h4>
                  <p className="mt-2 text-sm leading-6 whitespace-pre-wrap text-foreground wrap-break-word">{value}</p>
                </section>
              ))}
            </div>
            <dl className="flex min-w-0 flex-col gap-4 self-start rounded-xl bg-muted p-4">
              {facts.map(({ label, value, mono }) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className={`mt-1 text-foreground break-all ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </TabsContent>

        <TabsContent value="contents" className="@container flex min-h-0 pt-5">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border @lg:flex-row">
            <div className="flex h-40 shrink-0 flex-col border-b border-border p-1.5 @lg:h-auto @lg:w-56 @lg:border-r @lg:border-b-0">
              <SkillFileTree
                key={skillRoot}
                tree={tree}
                entryPath={entryFile?.path}
                selectedPath={currentFile?.path ?? selectedFile}
                label={t('settings.skills.detail.filesLabel')}
                onSelect={setSelectedFile}
              />
            </div>
            {currentFile && <SkillFileView file={currentFile} skillRoot={skillRoot} viewMode={viewMode} onViewModeChange={setViewMode} />}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SkillFileView({
  file,
  skillRoot,
  viewMode,
  onViewModeChange,
}: {
  file: SkillFile
  skillRoot: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
}) {
  const t = useTranslation()
  const isMarkdown = file.kind === 'text' && file.language === 'markdown'
  const showPreview = isMarkdown && viewMode === 'preview'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">/{file.path}</span>
        {isMarkdown && (
          <ToggleGroup
            type="single"
            variant="segmented"
            size="segmented"
            value={viewMode}
            onValueChange={(next) => { if (next === 'preview' || next === 'source') onViewModeChange(next) }}
            aria-label={t('settings.skills.detail.viewMode')}
          >
            <ToggleGroupItem value="preview" aria-label={t('settings.skills.detail.preview')}>
              <EyeIcon aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem value="source" aria-label={t('settings.skills.detail.sourceCode')}>
              <CodeIcon aria-hidden="true" />
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      <SkillFileBody file={file} skillRoot={skillRoot} showPreview={showPreview} />
    </div>
  )
}

function SkillFileBody({ file, skillRoot, showPreview }: { file: SkillFile; skillRoot: string; showPreview: boolean }) {
  const t = useTranslation()
  if (file.kind === 'image') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <img src={filesystemApi.fileUrl(`${skillRoot}/${file.path}`)} alt={file.path} className="max-h-full max-w-full object-contain" />
      </div>
    )
  }
  if (file.kind !== 'text') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <PanelMessage icon={FileWarningIcon} message={t(file.kind === 'too_large' ? 'workspace.previewState.tooLarge' : 'workspace.previewState.binary')} />
      </div>
    )
  }
  if (showPreview) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <MarkdownRenderer content={file.body ?? file.content} variant="document" className="mx-auto max-w-[72ch]" />
      </div>
    )
  }
  return <SkillCode code={file.content} language={file.language} />
}

function SkillCode({ code, language }: { code: string; language: string }) {
  const t = useTranslation()
  const lines = useHighlightedCode(code, language || 'text')
  return (
    <CodeBlock variant="plain" size="sm" className="min-h-0 flex-1">
      <CodeBlockContent lineNumbers wrap className="flex-1" aria-label={language || t('codeViewer.code')}>
        {lines.map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function getMetaEntries(frontmatter?: SkillFrontmatter): Array<[string, unknown]> {
  if (!frontmatter) return []

  const entries = Object.entries(frontmatter).filter(([key, value]) => {
    if (SHOWN_ELSEWHERE.has(key) || value == null) return false
    if (typeof value === 'string') return value.trim().length > 0
    if (Array.isArray(value)) return value.length > 0
    return true
  })

  const rank = (key: string) => {
    const index = META_PRIORITY.indexOf(key as (typeof META_PRIORITY)[number])
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
}

function formatMetaKey(key: string) {
  return key.replace(/[-_]/g, ' ')
}

function formatMetaValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}
