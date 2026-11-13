import { LayoutGrid, List, Palette, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../i18n'
import { ArtifactCard } from '../components/artifacts/ArtifactCard'
import { ArtifactViewer } from '../components/artifacts/ArtifactViewer'
import { DesignMode } from '../components/design/DesignMode'
import { FormSelect } from '../components/shared/FormSelect'
import { LoadingBlock } from '../components/shared/LoadingBlock'
import { SearchField } from '../components/shared/SearchField'
import { Tooltip as HintTooltip } from '../components/shared/Tooltip'
import { Button } from '../components/shared/ui/button'
import { ToggleGroup, ToggleGroupItem } from '../components/shared/ui/toggle-group'
import { artifactKey, artifactTitle } from '../lib/artifactDisplay'
import { artifactProjectKey, artifactProjectName, sortArtifacts } from '../lib/artifactProject'
import { matchesQuery } from '../lib/textMatch'
import { useArtifactListStore } from '../stores/artifactListStore'
import { useArtifactStore } from '../stores/artifactStore'
import { useArtifactViewStore } from '../stores/artifactViewStore'
import type { ArtifactListItem } from '../types/artifact'

const LAYOUT_KEY = 'dreamcoder-artifacts-layout'
const ALL_PROJECTS = 'all'
const UNBOUND_PROJECT = 'unbound'

type Layout = 'grid' | 'list'

const LAYOUTS = [
  { value: 'grid', icon: LayoutGrid, label: 'artifactsPage.layoutGrid' },
  { value: 'list', icon: List, label: 'artifactsPage.layoutList' },
] as const

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function writeLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch (error) {
    console.warn('[artifacts] Failed to save the layout', error)
  }
}

export function ArtifactsPage() {
  const t = useTranslation()
  const items = useArtifactListStore((state) => state.items)
  const loading = useArtifactListStore((state) => state.loading)
  const error = useArtifactListStore((state) => state.error)
  const load = useArtifactListStore((state) => state.load)
  const writeVersion = useArtifactStore((state) => state.writeVersion)
  const viewing = useArtifactViewStore((state) => state.viewing)
  const designing = useArtifactViewStore((state) => state.designing)
  const openViewer = useArtifactViewStore((state) => state.open)
  const openDesign = useArtifactViewStore((state) => state.openDesign)
  const [query, setQuery] = useState('')
  const [project, setProject] = useState(ALL_PROJECTS)
  const [layout, setLayout] = useState<Layout>(readLayout)

  useEffect(() => {
    void load()
  }, [load, writeVersion, viewing])

  const projects = useMemo(() => {
    const keys = new Map<string, string>()
    for (const item of items) {
      const key = artifactProjectKey(item)
      if (key && !keys.has(key)) keys.set(key, artifactProjectName(item))
    }
    return [...keys].map(([value, label]) => ({ value, label }))
  }, [items])

  const visible = useMemo(() => {
    return sortArtifacts(items).filter((item) => {
      if (project !== ALL_PROJECTS) {
        const key = artifactProjectKey(item)
        if (project === UNBOUND_PROJECT ? item.workDir !== null : key !== project) return false
      }
      return matchesQuery([item.manifest?.title ?? '', item.name, artifactProjectName(item)], query)
    })
  }, [items, project, query])

  const open = (item: ArtifactListItem) => {
    if (!item.id) return
    openViewer({ id: item.id, name: item.name, title: artifactTitle(item) })
  }

  if (viewing) return <ArtifactViewer viewing={viewing} />
  if (designing) return <DesignMode />

  const projectOptions = [
    { value: ALL_PROJECTS, label: t('artifactsPage.allProjects') },
    ...projects,
    { value: UNBOUND_PROJECT, label: t('artifacts.unbound') },
  ]

  return (
    <div data-testid="artifacts-page" className="flex-1 overflow-y-auto">
      <div className="window-drag-region flex select-none items-center justify-between gap-4 px-10 pb-4 pt-8">
        <h1 className="text-2xl font-bold text-foreground">{t('artifacts.title')}</h1>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          value={layout}
          aria-label={t('artifactsPage.layout')}
          onValueChange={(next) => {
            if (next !== 'grid' && next !== 'list') return
            setLayout(next)
            writeLayout(next)
          }}
        >
          {LAYOUTS.map(({ value, icon: Icon, label }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={t(label)}
            >
              <Icon aria-hidden="true" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="px-10 pb-8">
        <p className="mb-2 text-xs text-subtle-foreground">{t('artifactsPage.makeNew')}</p>
        <div className="mb-6 flex items-center gap-6">
          <button
            type="button"
            onClick={openDesign}
            data-testid="design-entry"
            className="group flex w-36 flex-col gap-2 text-left focus-visible:outline-none"
          >
            <span className="flex h-24 items-center justify-center rounded-lg border border-border bg-primary/15 text-primary transition-colors group-hover:bg-primary/20 group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <Palette aria-hidden="true" size={40} strokeWidth={1.5} />
            </span>
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              {t('design.entry')}
              <span aria-hidden="true" className="rounded-full border border-primary px-1.5 text-3xs font-normal text-primary">
                {t('artifactsPage.badgeNew')}
              </span>
            </span>
          </button>
          <p className="text-sm text-subtle-foreground">{t('artifactsPage.moreSoon')}</p>
        </div>
        <div className="mb-5 flex items-center gap-3">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t('artifactsPage.search')}
            aria-label={t('artifactsPage.search')}
            className="max-w-sm flex-1"
          />
          <div className="w-52">
            <FormSelect value={project} options={projectOptions} onChange={setProject} label={t('artifactsPage.filterProject')} />
          </div>
          <HintTooltip content={t('artifacts.refresh')}>
            <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={t('artifacts.refresh')} disabled={loading} onClick={() => void load()}>
              <RefreshCw aria-hidden="true" />
            </Button>
          </HintTooltip>
        </div>
        {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
        {items.length === 0 && loading ? (
          <LoadingBlock className="py-16" spinnerClassName="size-6" />
        ) : visible.length === 0 ? (
          <p role="status" className="py-16 text-center text-sm text-subtle-foreground">
            {items.length === 0 ? t('artifacts.empty') : t('artifactsPage.noMatches')}
          </p>
        ) : (
          <div className={layout === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4' : 'flex flex-col gap-2'}>
            {visible.map((item) => (
              <ArtifactCard key={artifactKey(item)} item={item} layout={layout} onOpen={open} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
