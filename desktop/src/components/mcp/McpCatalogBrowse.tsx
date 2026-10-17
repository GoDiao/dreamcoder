import { useEffect, useMemo, useState } from 'react'
import { mcpApi } from '../../api/mcp'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import type { McpCatalogEntry } from '../../types/mcp'

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

  if (error) return <CatalogState icon="error" title={t('settings.mcp.browse.invalid')} detail={error} />
  if (!entries) return <CatalogState icon="progress_activity" title={t('settings.mcp.browse.loading')} />

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <input
          aria-label={t('settings.mcp.browse.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.mcp.browse.search')}
          className="h-11 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
        />
        <select
          aria-label={t('settings.mcp.browse.filter')}
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          className="h-11 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)]"
        >
          <option value="">{t('settings.mcp.browse.allTags')}</option>
          {tags.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>
      {visible.length === 0 ? (
        <CatalogState icon="search_off" title={t('settings.mcp.browse.empty')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((entry) => (
            <CatalogCard
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

function CatalogCard({ entry, installed, onInstall }: { entry: McpCatalogEntry; installed: boolean; onInstall: () => void }) {
  const t = useTranslation()
  return (
    <article className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--color-text-primary)]">{entry.name}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{entry.description}</p>
        </div>
        {installed && (
          <span className="shrink-0 rounded-full bg-[var(--color-inspector-success-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--color-inspector-success)]">
            {t('settings.mcp.browse.installed')}
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {entry.tags.map((value) => (
          <span key={value} className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">
            {value}
          </span>
        ))}
      </div>
      <dl className="mt-4 space-y-2 text-xs text-[var(--color-text-tertiary)]">
        <CatalogField label={t('settings.mcp.browse.command')} value={[entry.command, ...entry.args].join(' ')} mono />
        <CatalogField label={t('settings.mcp.browse.runtime')} value={`${entry.runtime}${entry.version ? ` ${entry.version}` : ''}`} />
        {entry.env.length > 0 && (
          <CatalogField
            label={t('settings.mcp.browse.environment')}
            value={entry.env.map((variable) => variable.name).join(', ')}
          />
        )}
      </dl>
      <a
        href={entry.homepage}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex text-sm font-medium text-[var(--color-text-accent)] hover:underline"
      >
        {t('settings.mcp.browse.homepage')}
      </a>
      <div className="mt-4">
        <Button variant="secondary" onClick={onInstall} aria-label={t('settings.mcp.install.actionFor', { name: entry.name })}>
          {t('settings.mcp.install.action')}
        </Button>
      </div>
    </article>
  )
}

function CatalogField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="inline font-semibold">{label}: </dt>
      <dd className={`inline ${mono ? 'font-[var(--font-mono)]' : ''}`}>{value}</dd>
    </div>
  )
}

function CatalogState({ icon, title, detail }: { icon: string; title: string; detail?: string }) {
  return (
    <div
      role="status"
      className="py-16 text-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)]"
    >
      <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)]">{icon}</span>
      <p className="mt-3 text-sm text-[var(--color-text-secondary)]">{title}</p>
      {detail && <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{detail}</p>}
    </div>
  )
}
