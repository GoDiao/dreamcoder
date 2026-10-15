import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import { openExternalUrl } from '../../lib/externalUrl'
import { filterMcpCatalog, hasInstalledCatalogName, InvalidMcpCatalogError, loadMcpCatalog, type RegistryEntry } from '../../lib/mcpCatalog'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; entries: RegistryEntry[] }
  | { status: 'error'; error: unknown }

export function McpCatalog({ installedNames, installedStatus }: {
  installedNames: ReadonlySet<string>
  installedStatus: 'loading' | 'ready' | 'error'
}) {
  const t = useTranslation()
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void loadMcpCatalog().then(
      (catalog) => { if (!cancelled) setState({ status: 'ready', entries: catalog.servers }) },
      (error: unknown) => { if (!cancelled) setState({ status: 'error', error }) },
    )
    return () => { cancelled = true }
  }, [attempt])

  const tags = useMemo(() => state.status === 'ready'
    ? [...new Set(state.entries.flatMap((entry) => entry.tags))].sort()
    : [], [state])

  if (state.status === 'loading') {
    return <p role="status" className="py-12 text-center text-[var(--color-text-secondary)]">{t('settings.mcp.catalog.loading')}</p>
  }
  if (state.status === 'error') {
    const invalid = state.error instanceof InvalidMcpCatalogError ? state.error : null
    return (
      <div role="alert" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-6">
        <p className="font-semibold text-[var(--color-error)]">{t(invalid ? 'settings.mcp.catalog.invalid' : 'settings.mcp.catalog.failed')}</p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('settings.mcp.catalog.errorHint')}</p>
        {invalid && (
          <ul className="my-3 list-inside list-disc break-words text-sm text-[var(--color-text-secondary)]">
            {invalid.issues.map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}
          </ul>
        )}
        <Button variant="secondary" className="mt-3" onClick={() => setAttempt((value) => value + 1)}>{t('common.retry')}</Button>
      </div>
    )
  }

  const entries = filterMcpCatalog(state.entries, query, tag)
  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--color-text-secondary)]">{t('settings.mcp.catalog.description')}</p>
      {installedStatus !== 'ready' && (
        <p role="status" className="text-sm text-[var(--color-text-tertiary)]">
          {t(installedStatus === 'loading' ? 'settings.mcp.catalog.checkingInstalled' : 'settings.mcp.catalog.installedUnavailable')}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <Input aria-label={t('settings.mcp.catalog.search')} placeholder={t('settings.mcp.catalog.search')} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label={t('settings.mcp.catalog.filterTag')} value={tag} onChange={(event) => setTag(event.target.value)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
          <option value="">{t('settings.mcp.catalog.allTags')}</option>
          {tags.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <p role="status" className="text-sm text-[var(--color-text-tertiary)]">{t('settings.mcp.catalog.count', { count: entries.length, total: state.entries.length })}</p>
      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center">
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{t('settings.mcp.catalog.empty')}</p>
          <Button variant="secondary" onClick={() => { setQuery(''); setTag('') }}>{t('settings.mcp.catalog.clearFilters')}</Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {entries.map((entry) => (
            <article key={entry.id} aria-labelledby={`mcp-catalog-${entry.id}`} className="min-w-0 space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id={`mcp-catalog-${entry.id}`} className="text-lg font-semibold text-[var(--color-text-primary)]">{entry.name}</h3>
                {installedStatus === 'ready' && hasInstalledCatalogName(entry, installedNames) && (
                  <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">{t('settings.mcp.catalog.installed')}</span>
                )}
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">{entry.description}</p>
              <div className="flex flex-wrap gap-2">{entry.tags.map((value) => <span key={value} className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-xs text-[var(--color-text-tertiary)]">{value}</span>)}</div>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="font-semibold text-[var(--color-text-secondary)]">{t('settings.mcp.catalog.command')}</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-[var(--color-text-primary)]">{[entry.command, ...entry.args].join(' ')}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--color-text-secondary)]">{t('settings.mcp.catalog.runtime')}</dt>
                  <dd className="text-[var(--color-text-primary)]">{t(`settings.mcp.catalog.runtime.${entry.runtime}`)}</dd>
                  <dd className="text-xs text-[var(--color-text-tertiary)]">{entry.version ? t('settings.mcp.catalog.version', { version: entry.version }) : t('settings.mcp.catalog.unpinned')}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--color-text-secondary)]">{t('settings.mcp.form.environmentVariables')}</dt>
                  <dd className="text-xs text-[var(--color-text-secondary)]">
                    {entry.env.length === 0 ? t('settings.mcp.catalog.noEnv') : (
                      <ul className="mt-1 space-y-2">{entry.env.map((env) => <li key={env.name}>
                        <code className="break-all">{env.name}</code> · {t(`settings.mcp.catalog.env.${env.source}`)}
                        {env.description && <p className="mt-1">{env.description}</p>}
                      </li>)}</ul>
                    )}
                  </dd>
                </div>
              </dl>
              {entry.notes && <p className="text-xs text-[var(--color-text-tertiary)]">{entry.notes}</p>}
              <a href={entry.homepage} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openExternalUrl(entry.homepage) }} className="inline-block text-sm text-[var(--color-text-accent)] hover:underline" aria-label={t('settings.mcp.catalog.homepageFor', { name: entry.name })}>{t('settings.mcp.catalog.homepage')}</a>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
