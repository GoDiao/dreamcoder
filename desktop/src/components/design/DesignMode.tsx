import { ArrowLeft, Globe, PencilRuler, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '../../i18n'
import { normalizeCloneAddress } from '../../lib/cloneAddress'
import { getFileNameFromPath } from '../../lib/composerAttachments'
import { errorMessage } from '../../lib/errorMessage'
import { DESIGN_CATEGORY_LABELS, DESIGN_PLATFORM_LABELS, filterDesignTemplates, localizedText } from '../../lib/designTemplates'
import { startDesignSession, type DesignStart } from '../../lib/startDesignSession'
import { useArtifactViewStore } from '../../stores/artifactViewStore'
import { useDesignSystemStore } from '../../stores/designSystemStore'
import { useDesignTemplateStore } from '../../stores/designTemplateStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { DesignTemplate, DesignTemplateCategory } from '../../types/design'
import { CardButton } from '../shared/CardButton'
import { FormSelect } from '../shared/FormSelect'
import { LoadingBlock } from '../shared/LoadingBlock'
import { SearchField } from '../shared/SearchField'
import { SegmentedControl } from '../shared/SegmentedControl'
import { Button } from '../shared/ui/button'
import { Input } from '../shared/ui/input'
import { DesignSystemLibrary } from './DesignSystemLibrary'
import { DesignTemplatePreview } from './DesignTemplatePreview'
import { SystemSwatches } from './SystemSwatches'
import { TemplateThumbnail } from './TemplateThumbnail'

type CategoryFilter = DesignTemplateCategory | 'all'
type Library = 'templates' | 'systems'

export function DesignMode() {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const close = useArtifactViewStore((state) => state.closeDesign)
  const sessions = useSessionStore((state) => state.sessions)
  const templates = useDesignTemplateStore((state) => state.items)
  const loading = useDesignTemplateStore((state) => state.loading)
  const error = useDesignTemplateStore((state) => state.error)
  const load = useDesignTemplateStore((state) => state.load)
  const systems = useDesignSystemStore((state) => state.items)
  const systemsLoading = useDesignSystemStore((state) => state.loading)
  const systemsError = useDesignSystemStore((state) => state.error)
  const loadSystems = useDesignSystemStore((state) => state.load)
  const [library, setLibrary] = useState<Library>('templates')
  const [systemId, setSystemId] = useState<string | null>(null)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [templateQuery, setTemplateQuery] = useState('')
  const [chosenProject, setChosenProject] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<DesignTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [cloneInput, setCloneInput] = useState('')
  const [cloneInvalid, setCloneInvalid] = useState(false)

  useEffect(() => {
    void load()
    void loadSystems()
  }, [load, loadSystems])

  const projects = useMemo(() => {
    const seen = new Set<string>()
    for (const session of sessions) {
      const path = session.projectRoot ?? session.workDir
      if (path && session.workDirExists) seen.add(path)
    }
    return [...seen]
  }, [sessions])
  const project = chosenProject !== null && projects.includes(chosenProject) ? chosenProject : projects[0] ?? null
  const system = systems.find((candidate) => candidate.id === systemId) ?? null
  const visible = useMemo(
    () => filterDesignTemplates(templates, category === 'all' ? null : category, templateQuery),
    [templates, category, templateQuery],
  )

  const run = async (options: DesignStart) => {
    if (!project || busy) return
    setBusy(true)
    try {
      await startDesignSession(project, options)
      close()
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const start = (template?: DesignTemplate) =>
    run({
      template: template && { id: template.id, title: localizedText(template.title, locale) },
      designSystemId: system && (template === undefined || template.acceptsDesignSystem) ? system.id : undefined,
    })

  const startClone = async () => {
    const cloneAddress = normalizeCloneAddress(cloneInput)
    setCloneInvalid(cloneAddress === null)
    if (cloneAddress !== null) await run({ cloneAddress })
  }

  if (previewing) {
    return (
      <DesignTemplatePreview
        templateId={previewing.id}
        title={localizedText(previewing.title, locale)}
        busy={busy || !project}
        onBack={() => setPreviewing(null)}
        onUse={() => void start(previewing)}
      />
    )
  }

  return (
    <div data-testid="design-mode" className="flex-1 overflow-y-auto">
      <div className="window-drag-region flex select-none items-center gap-3 px-10 pb-5 pt-8">
        <Button variant="ghost" size="sm" onClick={close} aria-label={t('artifactsPage.back')}>
          <ArrowLeft aria-hidden="true" />
          {t('artifactsPage.back')}
        </Button>
        <h1 className="min-w-0 flex-1 text-2xl font-bold text-foreground">{t('design.title')}</h1>
      </div>
      <div className="px-10 pb-8">
        {projects.length === 0 ? (
          <p role="status" className="py-16 text-center text-sm text-subtle-foreground">{t('design.noProject')}</p>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="w-64">
                <FormSelect
                  value={project ?? ''}
                  options={projects.map((path) => ({ value: path, label: getFileNameFromPath(path) }))}
                  onChange={setChosenProject}
                  label={t('design.project')}
                />
              </div>
              <SegmentedControl
                value={library}
                label={t('design.tabs')}
                options={[
                  { value: 'templates', label: t('design.tab.templates') },
                  { value: 'systems', label: t('design.tab.systems') },
                ]}
                onChange={setLibrary}
              />
              {library === 'templates' && (
                <>
                  <SearchField
                    value={templateQuery}
                    onChange={setTemplateQuery}
                    aria-label={t('design.templateSearch')}
                    placeholder={t('design.templateSearch')}
                    className="w-64"
                  />
                  <SegmentedControl
                    value={category}
                    label={t('design.filter')}
                    options={[
                      { value: 'all', label: t('design.category.all') },
                      ...(['web', 'prototype'] as const).map((value) => ({ value, label: t(DESIGN_CATEGORY_LABELS[value]) })),
                    ]}
                    onChange={setCategory}
                  />
                </>
              )}
            </div>
            {system && (
              <div data-testid="design-system-chip" className="mb-4 flex w-fit max-w-full items-center gap-2 rounded-lg border border-border bg-background py-1 pr-1 pl-2">
                <span className="w-16 shrink-0 overflow-hidden rounded-sm">
                  <SystemSwatches colors={system.swatches} />
                </span>
                <span className="min-w-0 truncate text-sm text-foreground">{t('design.systemChip', { name: localizedText(system.name, locale) })}</span>
                <Button variant="ghost" size="icon-xs" aria-label={t('design.systemClear')} onClick={() => setSystemId(null)}>
                  <X aria-hidden="true" />
                </Button>
              </div>
            )}
            {library === 'systems' ? (
              <DesignSystemLibrary systems={systems} loading={systemsLoading} error={systemsError} selectedId={systemId} onSelect={setSystemId} />
            ) : (
              <>
                {error && <p role="alert" className="mb-4 text-sm text-destructive">{t('design.loadFailed', { reason: error })}</p>}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                  <CardButton
                    disabled={busy}
                    onClick={() => void start()}
                    data-testid="design-scratch"
                    className="flex min-h-48 flex-col items-start justify-between gap-3 border border-dashed border-border p-4"
                  >
                    <PencilRuler aria-hidden="true" size={28} strokeWidth={1.6} className="text-subtle-foreground" />
                    <span className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-foreground">{t('design.scratchTitle')}</span>
                      <span className="text-xs text-muted-foreground">{t('design.scratchHint')}</span>
                    </span>
                  </CardButton>
                  <form
                    data-testid="design-clone"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void startClone()
                    }}
                    className="flex min-h-48 flex-col justify-between gap-3 rounded-lg border border-dashed border-border bg-background p-4"
                  >
                    <Globe aria-hidden="true" size={28} strokeWidth={1.6} className="text-subtle-foreground" />
                    <span className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-foreground">{t('design.cloneTitle')}</span>
                      <span className="text-xs text-muted-foreground">{t('design.cloneHint')}</span>
                    </span>
                    <Input
                      value={cloneInput}
                      onChange={(event) => {
                        setCloneInput(event.target.value)
                        setCloneInvalid(false)
                      }}
                      aria-label={t('design.cloneAddress')}
                      aria-invalid={cloneInvalid}
                      placeholder="example.com"
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                    {cloneInvalid && <span role="alert" className="text-xs text-destructive">{t('design.cloneInvalid')}</span>}
                    <Button type="submit" size="sm" disabled={busy || cloneInput.trim() === ''}>{t('design.cloneStart')}</Button>
                  </form>
                  {visible.map((template) => (
                    <div key={template.id} data-testid="design-template-card" className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
                      <TemplateThumbnail templateId={template.id} />
                      <div className="flex flex-1 flex-col gap-1 p-3">
                        <span className="text-sm font-medium text-foreground">{localizedText(template.title, locale)}</span>
                        <span className="text-xs text-subtle-foreground">
                          {[t(DESIGN_CATEGORY_LABELS[template.category]), template.platform && t(DESIGN_PLATFORM_LABELS[template.platform])].filter(Boolean).join(' · ')}
                        </span>
                        <span className="text-xs text-muted-foreground">{localizedText(template.description, locale)}</span>
                        {system && !template.acceptsDesignSystem && (
                          <span className="text-xs text-subtle-foreground">{t('design.systemFixedLook')}</span>
                        )}
                        <div className="mt-auto flex gap-2 pt-2">
                          <Button variant="outline" size="sm" onClick={() => setPreviewing(template)}>{t('design.preview')}</Button>
                          <Button size="sm" disabled={busy} onClick={() => void start(template)}>{t('design.useTemplate')}</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {loading && templates.length === 0 && <LoadingBlock className="py-16" spinnerClassName="size-6" />}
                {!loading && !error && visible.length === 0 && (
                  <p role="status" className="py-8 text-center text-sm text-subtle-foreground">
                    {t(templateQuery.trim() === '' ? 'design.empty' : 'design.templateNoMatch')}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
