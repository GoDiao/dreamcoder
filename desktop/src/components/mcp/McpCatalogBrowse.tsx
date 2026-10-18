import { useEffect, useMemo, useState } from 'react'
import { mcpApi } from '../../api/mcp'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import type { McpCatalogEntry } from '../../types/mcp'
import { SearchField } from '../shared/SearchField'
import { SettingsSelect } from '../settings/SettingsSelect'

export function McpCatalogBrowse({ installedNames, onInstall }: {
  installedNames: string[]
  onInstall: (entry: McpCatalogEntry) => void
}) {
  const t = useTranslation()
  const [entries, setEntries] = useState<McpCatalogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')

  useEffect(() => {
    let cancelled = false

    void mcpApi.catalog()
      .then(({ catalog }) => {
        if (!cancelled) setEntries(catalog.servers)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('settings.mcp.browse.invalid'))
      })

    return () => { cancelled = true }
  }, [t])

  const tags = useMemo(
    () => Array.from(new Set(entries?.flatMap((entry) => entry.tags) ?? [])).sort(),
    [entries],
  )
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return (entries ?? []).filter((entry) => {
      const searchContent = [entry.name, entry.description, entry.command, ...entry.tags].join(' ').toLowerCase()
      return (!normalized || searchContent.includes(normalized)) && (!tag || entry.tags.includes(tag))
    })
  }, [entries, query, tag])
  const installed = new Set(installedNames.map((name) => name.toLowerCase()))

  if (error) return <CatalogState title={t('settings.mcp.browse.invalid')} detail={error} />
  if (!entries) return <CatalogState title={t('settings.mcp.browse.loading')} />

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <SearchField
          value={query}
          onChange={setQuery}
          aria-label={t('settings.mcp.browse.search')}
          placeholder={t('settings.mcp.browse.search')}
          className="min-w-[160px] flex-1"
        />
        <SettingsSelect<string>
          label={t('settings.mcp.browse.filter')}
          value={tag}
          onChange={setTag}
          options={[
            { value: '', label: t('settings.mcp.browse.allTags') },
            ...tags.map((value) => ({ value, label: value })),
          ]}
        />
      </div>
      {visible.length === 0 ? (
        <CatalogState title={t('settings.mcp.browse.empty')} />
      ) : (
        <div className="border-t border-[var(--color-border-separator)]">
          {visible.map((entry) => (
            <CatalogEntry
              key={entry.id}
              entry={entry}
              installed={installed.has(entry.id) || installed.has(entry.name.toLowerCase())}
              onInstall={() => onInstall(entry)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogEntry({ entry, installed, onInstall }: { entry: McpCatalogEntry; installed: boolean; onInstall: () => void }) {
  const t = useTranslation()
  return (
    <article className="border-b border-[var(--color-border-separator)] px-3 py-3.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{entry.name}</h3>
        {installed && (
          <span className="text-xs text-[var(--color-success)]">
            {t('settings.mcp.browse.installed')}
          </span>
        )}
        <a
          href={entry.homepage}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs font-medium text-[var(--color-text-accent)] hover:underline"
        >
          {t('settings.mcp.browse.homepage')}
        </a>
      </div>
      <p className="mt-1 text-xs leading-[1.6] text-[var(--color-text-secondary)]">{entry.description}</p>
      {entry.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-[5px]">
          {entry.tags.map((value) => (
            <span key={value} className="rounded-full bg-[var(--color-surface-hover)] px-2 py-px text-[11px] text-[var(--color-text-secondary)]">
              {value}
            </span>
          ))}
        </div>
      )}
      <dl className="mt-2 space-y-0.5 text-[11px] text-[var(--color-text-tertiary)]">
        <CatalogField label={t('settings.mcp.browse.command')} value={[entry.command, ...entry.args].join(' ')} mono />
        <CatalogField label={t('settings.mcp.browse.runtime')} value={`${entry.runtime}${entry.version ? ` ${entry.version}` : ''}`} />
        {entry.env.length > 0 && (
          <CatalogField
            label={t('settings.mcp.browse.environment')}
            value={entry.env.map((variable) => variable.name).join(', ')}
          />
        )}
      </dl>
      <div className="mt-3">
        <Button variant="secondary" size="xs" onClick={onInstall} aria-label={t('settings.mcp.install.actionFor', { name: entry.name })}>
          {t('settings.mcp.install.action')}
        </Button>
      </div>
    </article>
  )
}

function CatalogField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="inline font-medium">{label}: </dt>
      <dd className={`inline ${mono ? 'font-[var(--font-mono)]' : ''}`}>{value}</dd>
    </div>
  )
}

function CatalogState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="status" className="py-10 text-center">
      <p className="text-[13px] text-[var(--color-text-secondary)]">{title}</p>
      {detail && <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{detail}</p>}
    </div>
  )
}
