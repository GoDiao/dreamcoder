import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader'
import { SettingsListRow, SettingsSection, SettingsSummary } from '../components/settings/SettingsSummary'
import { diagnosticsApi, type DiagnosticEvent, type DiagnosticsStatus } from '../api/diagnostics'
import { Button } from '../components/shared/ui/button'
import { useCopyAndNotify } from '../hooks/useCopyAndNotify'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useUIStore } from '../stores/uiStore'
import { DoctorPanel } from '../components/doctor/DoctorPanel'

export function DiagnosticsSettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const copyAndNotify = useCopyAndNotify()
  const [status, setStatus] = useState<DiagnosticsStatus | null>(null)
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [nextStatus, eventResult] = await Promise.all([
        diagnosticsApi.getStatus(),
        diagnosticsApi.getEvents(100),
      ])
      setStatus(nextStatus)
      setEvents(eventResult.events)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.loadFailed'),
      })
    } finally {
      setIsLoading(false)
    }
  }, [addToast, t])

  useEffect(() => {
    void load()
  }, [load])

  const recentErrorSummary = useMemo(() => {
    return events
      .filter((event) => event.severity === 'error' || event.severity === 'warn')
      .slice(0, 20)
      .map(formatEventForCopy)
      .join('\n')
  }, [events])

  const handleOpenDir = async () => {
    try {
      await diagnosticsApi.openLogDir()
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.openFailed'),
      })
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const { bundle } = await diagnosticsApi.exportBundle()
      setLastExportPath(bundle.path)
      addToast({
        type: 'success',
        message: t('settings.diagnostics.exported', { file: bundle.fileName }),
      })
      await load()
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.exportFailed'),
      })
    } finally {
      setIsExporting(false)
    }
  }

  const handleCopySummary = async () => {
    const text = recentErrorSummary || t('settings.diagnostics.noRecentErrors')
    await copyAndNotify(text, t('settings.diagnostics.summaryCopied'))
  }

  const handleClear = async () => {
    if (!window.confirm(t('settings.diagnostics.confirmClear'))) return
    setIsClearing(true)
    try {
      await diagnosticsApi.clear()
      setEvents([])
      setStatus(await diagnosticsApi.getStatus())
      setLastExportPath(null)
      addToast({ type: 'success', message: t('settings.diagnostics.cleared') })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.clearFailed'),
      })
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <div className="min-w-0">
      <SettingsPageHeader
        title={t('settings.diagnostics.title')}
        description={t('settings.diagnostics.description')}
        actions={
          <Button variant="outline" size="xs" onClick={load} loading={isLoading}>
            <RefreshCw data-icon="inline-start" size={13} aria-hidden="true" />
            {t('settings.diagnostics.refresh')}
          </Button>
        }
      />

      <SettingsSummary
        items={[
          { label: t('settings.diagnostics.totalSize'), value: status ? formatBytes(status.totalBytes) : '-' },
          { label: t('settings.diagnostics.events'), value: status ? String(status.eventCount) : '-' },
          { label: t('settings.diagnostics.recentErrors'), value: status ? String(status.recentErrorCount) : '-' },
          {
            label: t('settings.diagnostics.retention'),
            value: status ? t('settings.diagnostics.retentionValue', { days: String(status.retentionDays), size: formatBytes(status.maxBytes) }) : '-',
          },
        ]}
      />

      <div className="mb-5">
        <DoctorPanel />
      </div>

      <SettingsListRow
        title={t('settings.diagnostics.logDirectory')}
        description={<span className="break-all font-mono">{status?.logDir ?? '-'}</span>}
        actions={
          <Button variant="outline" size="xs" onClick={handleOpenDir}>
            {t('settings.diagnostics.openDirectory')}
          </Button>
        }
      />
      <div className="mt-[18px] flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="xs" onClick={handleExport} loading={isExporting}>
          {t('settings.diagnostics.exportBundle')}
        </Button>
        <Button variant="outline" size="xs" onClick={handleCopySummary}>
          {t('settings.diagnostics.copySummary')}
        </Button>
        <Button variant="outline" size="xs" onClick={handleClear} loading={isClearing} className="text-[var(--color-error)] hover:text-[var(--color-error)]">
          {t('settings.diagnostics.clearLogs')}
        </Button>
        {lastExportPath && (
          <span className="text-xs text-[var(--color-text-tertiary)] font-mono break-all">
            {lastExportPath}
          </span>
        )}
      </div>

      <SettingsSection title={t('settings.diagnostics.recentEvents')}>
        <p className="-mt-1.5 mb-1 text-xs leading-[1.5] text-[var(--color-text-tertiary)]">{t('settings.diagnostics.privacyNote')}</p>
        {events.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-tertiary)]">
            {isLoading ? t('common.loading') : t('settings.diagnostics.noEvents')}
          </div>
        ) : (
          <div>
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                detailsLabel={t('settings.diagnostics.eventDetails')}
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

function EventRow({
  event,
  detailsLabel,
}: {
  event: DiagnosticEvent
  detailsLabel: string
}) {
  const severityClass =
    event.severity === 'error'
      ? 'text-[var(--color-error)]'
      : event.severity === 'warn'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-text-tertiary)]'
  const detailsText = formatDetails(event.details)

  return (
    <div className="grid grid-cols-[120px_64px_1fr] items-start gap-3 border-b border-[var(--color-border-separator)] py-2.5">
      <div className="text-xs text-[var(--color-text-tertiary)] font-mono">
        {new Date(event.timestamp).toLocaleString()}
      </div>
      <div className={`text-xs font-medium ${severityClass}`}>{event.severity}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{event.type}</span>
          {event.sessionId && (
            <span className="text-[11px] text-[var(--color-text-tertiary)] font-mono truncate">{event.sessionId}</span>
          )}
        </div>
        <div className="mt-px text-xs leading-[1.5] text-[var(--color-text-secondary)] break-words">{event.summary}</div>
        {detailsText && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--color-text-tertiary)] select-none">
              {detailsLabel}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
              {detailsText}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

function formatDetails(details: unknown): string {
  if (details === null || details === undefined) return ''
  if (typeof details === 'string') return details
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

function formatEventForCopy(event: DiagnosticEvent): string {
  const header = `[${event.timestamp}] ${event.severity.toUpperCase()} ${event.type}${event.sessionId ? ` session=${event.sessionId}` : ''}`
  const details = formatDetails(event.details)
  if (!details) return `${header}: ${event.summary}`
  return `${header}: ${event.summary}\nDetails:\n${details}`
}
