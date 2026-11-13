import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import { DESIGN_SYSTEM_SOURCE_LABELS, designSystemCategories, filterDesignSystems } from '../../lib/designSystems'
import { localizedText } from '../../lib/designTemplates'
import { useSettingsStore } from '../../stores/settingsStore'
import type { DesignSystem } from '../../types/design'
import { FormSelect } from '../shared/FormSelect'
import { LoadingBlock } from '../shared/LoadingBlock'
import { SearchField } from '../shared/SearchField'
import { Button } from '../shared/ui/button'
import { SystemSwatches } from './SystemSwatches'

const ALL_CATEGORIES = '__all__'

type Props = {
  systems: DesignSystem[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function DesignSystemLibrary({ systems, loading, error, selectedId, onSelect }: Props) {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [query, setQuery] = useState('')
  const categories = useMemo(() => designSystemCategories(systems), [systems])
  const visible = useMemo(
    () => filterDesignSystems(systems, category === ALL_CATEGORIES ? null : category, query),
    [systems, category, query],
  )

  return (
    <div data-testid="design-system-library">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchField
          value={query}
          onChange={setQuery}
          aria-label={t('design.systemSearch')}
          placeholder={t('design.systemSearch')}
          className="w-64"
        />
        <div className="w-56">
          <FormSelect
            value={category}
            label={t('design.systemCategory')}
            options={[{ value: ALL_CATEGORIES, label: t('design.systemCategoryAll') }, ...categories.map((value) => ({ value, label: value }))]}
            onChange={setCategory}
          />
        </div>
      </div>
      <p className="mb-4 text-xs text-subtle-foreground">{t('design.systemNote')}</p>
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{t('design.systemsLoadFailed', { reason: error })}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {visible.map((system) => {
          const selected = system.id === selectedId
          return (
            <div
              key={system.id}
              data-testid="design-system-card"
              className={`flex flex-col overflow-hidden rounded-lg border bg-background ${selected ? 'border-primary' : 'border-border'}`}
            >
              <SystemSwatches colors={system.swatches} />
              <div className="flex flex-1 flex-col gap-1 p-3">
                <span className="text-sm font-medium text-foreground">{localizedText(system.name, locale)}</span>
                <span className="text-xs text-subtle-foreground">
                  {[system.category, t(DESIGN_SYSTEM_SOURCE_LABELS[system.origin])].join(' · ')}
                </span>
                <span className="line-clamp-3 text-xs text-muted-foreground">{localizedText(system.description, locale)}</span>
                <div className="mt-auto pt-2">
                  <Button
                    size="sm"
                    variant={selected ? 'secondary' : 'outline'}
                    aria-pressed={selected}
                    onClick={() => onSelect(selected ? null : system.id)}
                  >
                    {selected && <Check aria-hidden="true" />}
                    {selected ? t('design.systemSelected') : t('design.systemUse')}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {loading && systems.length === 0 && <LoadingBlock className="py-16" spinnerClassName="size-6" />}
      {!loading && !error && visible.length === 0 && (
        <p role="status" className="py-8 text-center text-sm text-subtle-foreground">{t('design.systemsEmpty')}</p>
      )}
    </div>
  )
}
