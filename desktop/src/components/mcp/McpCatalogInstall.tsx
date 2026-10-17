import { useRef, useState } from 'react'
import { Button } from '../shared/Button'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { Input } from '../shared/Input'
import { useTranslation } from '../../i18n'
import { catalogScopeIsShadowed, prepareCatalogInstall } from '../../lib/mcpCatalogInstall'
import type { McpCatalogEntry, McpServerRecord, McpUpsertPayload, McpWritableScope } from '../../types/mcp'

type Props = {
  entry: McpCatalogEntry
  servers: McpServerRecord[]
  onCancel: () => void
  onManual: () => void
  onConfirm: (name: string, payload: McpUpsertPayload, cwd?: string) => Promise<void>
}

const SCOPES: McpWritableScope[] = ['local', 'project', 'user']

export function McpCatalogInstall({ entry, servers, onCancel, onManual, onConfirm }: Props) {
  const t = useTranslation()
  const [name, setName] = useState(entry.id)
  const [scope, setScope] = useState<McpWritableScope | null>(null)
  const [projectPath, setProjectPath] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const inFlight = useRef(false)
  const needsProject = scope === 'local' || scope === 'project'
  const targetCwd = needsProject ? projectPath.trim() : undefined
  const prepared = prepareCatalogInstall(entry, values)
  // The preview is built from markers, never from entered values.
  const preview = prepareCatalogInstall(entry, Object.fromEntries(
    entry.env.map((variable) => [variable.name,
      variable.source !== 'optional' || values[variable.name]?.trim() || entry.args.some((arg) => arg.includes(`{env:${variable.name}}`))
        ? `[${variable.name}]`
        : '',
    ]),
  ))
  const validName = /^[a-zA-Z0-9_-]+$/.test(name.trim())
  const duplicate = scope !== null && servers.some((server) => (
    server.name === name.trim() && server.scope === scope &&
    (!needsProject || server.projectPath === targetCwd)
  ))
  // The existing list and status APIs resolve the effective config by name.
  // Do not offer a lower-priority install that those APIs would immediately hide.
  const shadowed = scope !== null && servers.some((server) => (
    server.name === name.trim() && catalogScopeIsShadowed(scope, server.scope) &&
    (!needsProject || server.projectPath === targetCwd)
  ))
  const canConfirm = prepared.ok && validName && scope !== null &&
    (!needsProject || !!targetCwd) && !duplicate && !shadowed
  const metadataError = !preview.ok
  const targetHint = scope === 'user'
    ? t('settings.mcp.targetProject.globalHint')
    : scope === 'project'
      ? t('settings.mcp.targetProject.projectSelected', { path: projectPath || '…' })
      : t('settings.mcp.targetProject.localSelected', { path: projectPath || '…' })

  const confirm = async () => {
    if (inFlight.current || !canConfirm || !prepared.ok || !scope) return
    inFlight.current = true
    setPending(true)
    setFailure(null)
    try {
      await onConfirm(name.trim(), { scope, config: prepared.config }, targetCwd)
    } catch (error) {
      let message = error instanceof Error ? error.message : t('settings.mcp.toast.saveFailed')
      for (const value of Object.values(values).filter(Boolean).sort((a, b) => b.length - a.length)) {
        message = message.split(value).join('[redacted]')
        const escaped = JSON.stringify(value).slice(1, -1)
        if (escaped !== value) message = message.split(escaped).join('[redacted]')
      }
      setFailure(message)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="max-w-5xl min-w-0 space-y-5">
      <Button variant="ghost" onClick={onCancel} disabled={pending}>
        {t('settings.mcp.form.back')}
      </Button>
      <div>
        <h2 className="text-3xl font-semibold text-[var(--color-text-primary)]">
          {t('settings.mcp.install.title', { name: entry.name })}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">{entry.description}</p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('settings.mcp.install.confirmation')}</p>
      </div>

      {metadataError ? (
        <div className="space-y-4 rounded-xl border border-[var(--color-border)] p-5">
          <p role="alert">{t(`settings.mcp.install.error.${preview.error.code}`, { name: preview.error.name ?? '' })}</p>
          <Button onClick={onManual}>{t('settings.mcp.install.manual')}</Button>
        </div>
      ) : (
        <>
          <fieldset disabled={pending} className="space-y-5">
            <Input
              label={t('settings.mcp.form.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={!validName ? t('settings.mcp.install.invalidName') : undefined}
              autoFocus
            />
            <section aria-label={t('settings.mcp.form.scope')}>
              <h3 className="mb-2 text-sm font-semibold">{t('settings.mcp.form.scope')}</h3>
              <p className="mb-3 text-xs text-[var(--color-text-secondary)]">{t('settings.mcp.install.chooseScope')}</p>
              <div className="grid gap-2 md:grid-cols-3">
                {SCOPES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={scope === choice}
                    onClick={() => setScope(choice)}
                    className={`rounded-lg border p-3 text-left ${scope === choice
                      ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-selected)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)]'}`}
                  >
                    <span className="block text-sm font-semibold">{t(`settings.mcp.scope.${choice}`)}</span>
                    <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{t(`settings.mcp.scopeDesc.${choice}`)}</span>
                  </button>
                ))}
              </div>
            </section>

            {scope && (
              <section className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
                {needsProject && (
                  <DirectoryPicker value={projectPath} onChange={(path) => {
                    if (!inFlight.current) setProjectPath(path)
                  }} />
                )}
                <p className="text-sm text-[var(--color-text-secondary)]">{targetHint}</p>
                {scope === 'project' && <p className="text-sm text-[var(--color-warning)]">{t('settings.mcp.install.sharedValues')}</p>}
              </section>
            )}

            {entry.env.length > 0 && (
              <section className="space-y-4">
                <h3 className="text-sm font-semibold">{t('settings.mcp.browse.environment')}</h3>
                <p className="text-xs text-[var(--color-text-secondary)]">{t('settings.mcp.install.environmentHint')}</p>
                {entry.env.map((variable) => {
                  const required = variable.source !== 'optional' || entry.args.some((arg) => arg.includes(`{env:${variable.name}}`))
                  return (
                    <div key={variable.name} className="space-y-1">
                      <Input
                        label={variable.name}
                        type="password"
                        value={values[variable.name] ?? ''}
                        onChange={(event) => setValues((current) => ({ ...current, [variable.name]: event.target.value }))}
                        required={required}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={`catalog-env-${variable.name}`}
                      />
                      <p id={`catalog-env-${variable.name}`} className="text-xs text-[var(--color-text-secondary)]">
                        {variable.description} {!required && t('settings.mcp.install.optional')}
                      </p>
                    </div>
                  )
                })}
              </section>
            )}
          </fieldset>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h3 className="mb-2 text-sm font-semibold">{t('settings.mcp.install.preview')}</h3>
            <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
              {entry.command} · {entry.version ?? t('settings.mcp.install.unpinned')}
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.config, null, 2)}</pre>
            <p className="mt-3 text-xs text-[var(--color-text-secondary)]">{t('settings.mcp.install.previewHint')}</p>
          </section>

          {!prepared.ok && <p role="status" className="text-sm text-[var(--color-warning)]">{t(`settings.mcp.install.error.${prepared.error.code}`, { name: prepared.error.name ?? '' })}</p>}
          {duplicate && <p role="alert" className="text-sm text-[var(--color-error)]">{t('settings.mcp.install.duplicate')}</p>}
          {shadowed && <p role="alert" className="text-sm text-[var(--color-error)]">{t('settings.mcp.install.shadowed')}</p>}
          {failure && <div role="alert" className="space-y-1 text-sm text-[var(--color-error)]"><p>{failure}</p><p>{t('settings.mcp.install.retryHint')}</p></div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={pending}>{t('settings.mcp.form.cancel')}</Button>
            <Button onClick={() => void confirm()} disabled={!canConfirm} loading={pending}>
              {pending ? t('settings.mcp.install.pending') : t('settings.mcp.install.confirm')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
