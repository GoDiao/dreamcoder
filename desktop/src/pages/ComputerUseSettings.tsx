import { useCallback, useEffect, useRef, useState } from 'react'
import {
  computerUseApi,
  type ComputerUseStatus,
  type InstallProgress,
  type PermissionState,
} from '../api/computerUse'
import { useTranslation } from '../i18n'
import { Button } from '../components/shared/Button'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Input } from '../components/shared/Input'
import { Switch } from '../components/shared/Switch'
import { SettingsRow } from '../components/settings/SettingsRow'
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader'

type CheckState = 'loading' | 'ready' | 'error'
type Tone = 'ok' | 'warn' | 'error' | 'neutral'

const INSTALL_POLL_MS = 1500

/** Approximate download size of the pinned cua-driver 0.34.0 package, per platform. */
const DOWNLOAD_SIZE_MB: Record<string, number> = { darwin: 76, win32: 31, linux: 35 }

function StatusDot({ tone }: { tone: Tone }) {
  const color =
    tone === 'ok'
      ? 'bg-green-500'
      : tone === 'warn'
        ? 'bg-amber-500'
        : tone === 'error'
          ? 'bg-red-400'
          : 'bg-[var(--color-text-tertiary)]'
  return <span aria-hidden className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${color}`} />
}

function StatusLine({ tone, label, detail, action }: {
  tone: Tone
  label: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--color-border-separator)] py-2.5 last:border-b-0">
      <StatusDot tone={tone} />
      <div className="min-w-[96px] text-[13px] text-[var(--color-text-primary)]">{label}</div>
      <div className="min-w-0 flex-1 text-xs leading-[1.5] text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">
        {detail}
      </div>
      {action ? <div className="flex flex-shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'error' | 'info'; children: React.ReactNode }) {
  const border =
    tone === 'error'
      ? 'border-red-400/40 bg-red-400/5'
      : tone === 'warn'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-[var(--color-border)] bg-[var(--color-surface-container-low)]'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[var(--radius-md)] border px-3 py-2.5 text-xs leading-[1.6] text-[var(--color-text-secondary)] ${border}`}>
      {children}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isInstallRunning(progress: InstallProgress | null | undefined): boolean {
  return !!progress && progress.phase !== 'done' && progress.phase !== 'failed'
}

export function ComputerUseSettings() {
  const t = useTranslation()
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [checkState, setCheckState] = useState<CheckState>('loading')
  const [checkError, setCheckError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'install' | 'upgrade' | 'cleanup' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Turn Computer Use on once the install that the switch started succeeds.
  const enableAfterInstallRef = useRef(false)
  const [permissionHint, setPermissionHint] = useState(false)
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [pathDraft, setPathDraft] = useState('')

  const fetchStatus = useCallback(async (quiet = false) => {
    if (!quiet) setCheckState('loading')
    try {
      const next = await computerUseApi.getStatus()
      setStatus(next)
      setCheckError(null)
      setCheckState('ready')
      return next
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error))
      setCheckState('error')
      return null
    }
  }, [])

  useEffect(() => {
    void fetchStatus().then(next => {
      if (next) setPathDraft(next.driverPath ?? '')
    })
  }, [fetchStatus])

  const installRunning = status?.state === 'installing' || isInstallRunning(status?.install)

  // Poll while an install runs; enable afterwards when the switch asked for it.
  useEffect(() => {
    if (!installRunning) return
    const timer = setInterval(async () => {
      const next = await fetchStatus(true)
      if (!next || isInstallRunning(next.install)) return
      if (next.install?.phase === 'done' && enableAfterInstallRef.current) {
        enableAfterInstallRef.current = false
        try {
          await computerUseApi.updateConfig({ enabled: true })
        } finally {
          await fetchStatus(true)
        }
      } else {
        enableAfterInstallRef.current = false
      }
    }, INSTALL_POLL_MS)
    return () => clearInterval(timer)
  }, [installRunning, fetchStatus])

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      await fetchStatus(true)
    }
  }

  const startInstall = (enableAfter: boolean) => {
    setConfirm(null)
    enableAfterInstallRef.current = enableAfter
    void runAction(() => computerUseApi.install())
  }

  const toggleEnabled = (value: boolean) => {
    if (!status) return
    if (value && (status.state === 'not_installed' || status.state === 'missing_executable')) {
      if (status.state === 'missing_executable') {
        setShowAdvanced(true)
        setActionError(t('settings.computerUse.missingExecutable', { path: status.driverPath ?? '' }))
        return
      }
      setConfirm('install')
      return
    }
    void runAction(() => computerUseApi.updateConfig({ enabled: value }))
  }

  const grantPermissions = () =>
    runAction(async () => {
      const result = await computerUseApi.grantPermissions()
      const permissions = result.permissions
      setPermissionHint(
        !permissions ||
          permissions.accessibility !== 'granted' ||
          permissions.screenRecording !== 'granted',
      )
    })

  const runDoctor = async () => {
    setDoctorRunning(true)
    try {
      const result = await computerUseApi.doctor()
      setDoctorOutput(result.output || t('settings.computerUse.doctorEmpty'))
    } catch (error) {
      setDoctorOutput(error instanceof Error ? error.message : String(error))
    } finally {
      setDoctorRunning(false)
    }
  }

  const choosePath = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, directory: false, title: t('settings.computerUse.pathDialogTitle') })
      const selectedPath = Array.isArray(selected) ? selected[0] : selected
      if (typeof selectedPath === 'string' && selectedPath.trim()) setPathDraft(selectedPath)
    } catch {
      setActionError(t('settings.computerUse.pathDialogFailed'))
    }
  }

  const savePath = (value: string) => runAction(() => computerUseApi.updateConfig({ driverPath: value.trim() || null }))

  if (checkState === 'loading' && !status) {
    return (
      <div className="min-w-0 space-y-6">
        <SettingsPageHeader title={t('settings.computerUse.title')} description={t('settings.computerUse.description')} />
        <div className="text-[13px] text-[var(--color-text-secondary)]">{t('settings.computerUse.checking')}</div>
      </div>
    )
  }

  if (checkState === 'error' && !status) {
    return (
      <div className="min-w-0 space-y-4">
        <SettingsPageHeader title={t('settings.computerUse.title')} description={t('settings.computerUse.description')} />
        <Notice tone="error">
          <div className="font-medium text-[var(--color-text-primary)]">{t('settings.computerUse.checkFailed')}</div>
          <div className="mt-1 [overflow-wrap:anywhere]">{checkError}</div>
        </Notice>
        <Button size="xs" variant="secondary" onClick={() => void fetchStatus()}>
          {t('settings.computerUse.recheck')}
        </Button>
      </div>
    )
  }

  if (!status) return null

  if (!status.platformSupported) {
    return (
      <div className="min-w-0 space-y-4">
        <SettingsPageHeader title={t('settings.computerUse.title')} description={t('settings.computerUse.description')} />
        <SettingsRow
          title={t('settings.computerUse.enableRow')}
          control={<Switch checked={false} disabled onChange={() => {}} label={t('settings.computerUse.enableRow')} />}
        />
        <Notice tone="info">{t('settings.computerUse.unsupported', { platform: status.platform })}</Notice>
      </div>
    )
  }

  const controlsDisabled = busy || installRunning
  const isMac = status.platform === 'darwin'
  const install = status.install
  const installFailed = install?.phase === 'failed'

  const driverLine = (() => {
    if (installRunning) {
      return {
        tone: 'neutral' as Tone,
        detail: t('settings.computerUse.installing', {
          phase: t(`settings.computerUse.phase.${install?.phase ?? 'downloading'}`),
        }),
      }
    }
    switch (status.state) {
      case 'installed':
        return {
          tone: 'ok' as Tone,
          detail: [
            t('settings.computerUse.installedVersion', { version: status.version ?? '?' }),
            status.source ? t(`settings.computerUse.source.${status.source}`) : null,
          ].filter(Boolean).join(' · '),
        }
      case 'outdated':
        return {
          tone: 'warn' as Tone,
          detail: status.version
            ? t('settings.computerUse.outdated', { version: status.version, verified: status.verifiedVersion })
            : t('settings.computerUse.versionUnreadable'),
        }
      case 'missing_executable':
        return { tone: 'error' as Tone, detail: t('settings.computerUse.missingExecutable', { path: status.driverPath ?? '' }) }
      default:
        return { tone: 'neutral' as Tone, detail: t('settings.computerUse.notInstalled') }
    }
  })()

  const permissionLine = (key: 'accessibility' | 'screenRecording', state: PermissionState) => {
    const tone: Tone = state === 'granted' ? 'ok' : state === 'denied' ? 'error' : 'warn'
    const detail =
      state === 'granted'
        ? t('settings.computerUse.permissionGranted')
        : state === 'denied'
          ? t('settings.computerUse.permissionDenied')
          : t('settings.computerUse.permissionUnknown')
    return (
      <StatusLine
        key={key}
        tone={tone}
        label={t(`settings.computerUse.${key}`)}
        detail={detail}
        action={state !== 'granted' ? (
          <Button size="xs" variant="secondary" onClick={() => void grantPermissions()} disabled={controlsDisabled}>
            {t('settings.computerUse.grant')}
          </Button>
        ) : undefined}
      />
    )
  }

  const hasDriver = status.state === 'installed' || status.state === 'outdated'

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <SettingsPageHeader
          className="!mb-2"
          title={t('settings.computerUse.title')}
          description={t('settings.computerUse.description')}
        />
        <SettingsRow
          title={t('settings.computerUse.enableRow')}
          description={t('settings.computerUse.enableRowDescription')}
          control={(
            <Switch
              checked={status.enabled}
              disabled={controlsDisabled}
              onChange={toggleEnabled}
              label={t('settings.computerUse.enableRow')}
            />
          )}
        />
      </div>

      <section aria-label={t('settings.computerUse.statusSection')}>
        <StatusLine
          tone={driverLine.tone}
          label="cua-driver"
          detail={driverLine.detail}
          action={!installRunning && (status.state === 'not_installed' || status.state === 'outdated') ? (
            <Button
              size="xs"
              onClick={() => setConfirm(status.state === 'outdated' ? 'upgrade' : 'install')}
              disabled={controlsDisabled}
            >
              {status.state === 'outdated'
                ? t('settings.computerUse.installVersion', { version: status.verifiedVersion })
                : t('settings.computerUse.install')}
            </Button>
          ) : undefined}
        />
        {status.newerThanVerified && status.state === 'installed' ? (
          <div className="pb-2 pl-5 text-xs text-[var(--color-text-tertiary)]">
            {t('settings.computerUse.newerThanVerified', { verified: status.verifiedVersion })}
          </div>
        ) : null}
        {isMac && hasDriver && status.permissions ? (
          <>
            {permissionLine('accessibility', status.permissions.accessibility)}
            {permissionLine('screenRecording', status.permissions.screenRecording)}
          </>
        ) : null}
        {hasDriver ? (
          <StatusLine
            tone={status.telemetry === 'disabled' ? 'ok' : status.telemetry === 'enabled' ? 'warn' : 'neutral'}
            label={t('settings.computerUse.telemetry')}
            detail={t(`settings.computerUse.telemetryState.${status.telemetry}`)}
            action={status.telemetry === 'enabled' ? (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => void runAction(() => computerUseApi.disableTelemetry())}
                disabled={controlsDisabled}
              >
                {t('settings.computerUse.disableTelemetry')}
              </Button>
            ) : undefined}
          />
        ) : null}
      </section>

      {installRunning && install?.output.length ? (
        <pre className="max-h-40 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] p-3 text-[11px] leading-[1.5] text-[var(--color-text-secondary)] whitespace-pre-wrap [overflow-wrap:anywhere]">
          {install.output.join('\n')}
        </pre>
      ) : null}

      {installFailed && !installRunning ? (
        <Notice tone="error">
          <div className="font-medium text-[var(--color-text-primary)]">{t('settings.computerUse.installFailed')}</div>
          <div className="mt-1 [overflow-wrap:anywhere]">{install?.error}</div>
          {install?.output.length ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] [overflow-wrap:anywhere]">{install.output.join('\n')}</pre>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" onClick={() => setConfirm(status.state === 'outdated' ? 'upgrade' : 'install')} disabled={controlsDisabled}>
              {t('settings.computerUse.retry')}
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setShowAdvanced(true)}>
              {t('settings.computerUse.useExistingPath')}
            </Button>
          </div>
        </Notice>
      ) : null}

      {actionError ? <Notice tone="error">{actionError}</Notice> : null}

      {permissionHint && isMac ? (
        <Notice tone="warn">
          <div>{t('settings.computerUse.stillNotGranted')}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" variant="secondary" onClick={() => void computerUseApi.openSettings('Privacy_Accessibility')}>
              {t('settings.computerUse.openAccessibility')}
            </Button>
            <Button size="xs" variant="secondary" onClick={() => void computerUseApi.openSettings('Privacy_ScreenCapture')}>
              {t('settings.computerUse.openScreenRecording')}
            </Button>
          </div>
        </Notice>
      ) : null}

      {status.conflicts.reservedName ? (
        <Notice tone="warn">{t('settings.computerUse.conflictReserved')}</Notice>
      ) : null}
      {status.conflicts.duplicates.length > 0 ? (
        <Notice tone="warn">
          {t('settings.computerUse.conflictDuplicate', { names: status.conflicts.duplicates.join(', ') })}
        </Notice>
      ) : null}

      {status.enabled && hasDriver && !installRunning ? (
        <Notice tone="info">{t('settings.computerUse.newSessionHint')}</Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="secondary" onClick={() => void fetchStatus()} disabled={installRunning} loading={checkState === 'loading'}>
          {t('settings.computerUse.recheck')}
        </Button>
        <Button size="xs" variant="secondary" onClick={() => setShowAdvanced(v => !v)} aria-expanded={showAdvanced}>
          {t('settings.computerUse.advanced')}
        </Button>
        {hasDriver ? (
          <Button size="xs" variant="secondary" onClick={() => void runDoctor()} loading={doctorRunning} disabled={doctorRunning}>
            {t('settings.computerUse.doctor')}
          </Button>
        ) : null}
      </div>

      {showAdvanced ? (
        <SettingsRow
          title={t('settings.computerUse.customPath')}
          description={t('settings.computerUse.customPathDescription')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input
                value={pathDraft}
                onChange={event => setPathDraft(event.target.value)}
                placeholder={status.path ?? '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'}
                aria-label={t('settings.computerUse.customPath')}
              />
            </div>
            <Button size="xs" variant="secondary" onClick={() => void choosePath()} disabled={controlsDisabled}>
              {t('settings.computerUse.browse')}
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => void savePath(pathDraft)}
              disabled={controlsDisabled || pathDraft.trim() === (status.driverPath ?? '')}
            >
              {t('common.save')}
            </Button>
            {status.driverPath ? (
              <Button size="xs" variant="secondary" onClick={() => { setPathDraft(''); void savePath('') }} disabled={controlsDisabled}>
                {t('settings.computerUse.clearPath')}
              </Button>
            ) : null}
          </div>
        </SettingsRow>
      ) : null}

      {doctorOutput !== null ? (
        <section aria-label={t('settings.computerUse.doctor')}>
          <pre className="max-h-72 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] p-3 text-[11px] leading-[1.5] text-[var(--color-text-secondary)] whitespace-pre-wrap [overflow-wrap:anywhere]">
            {doctorOutput}
          </pre>
        </section>
      ) : null}

      {status.legacyRuntime.present ? (
        <SettingsRow
          title={t('settings.computerUse.legacyRuntime')}
          description={t('settings.computerUse.legacyRuntimeDescription', {
            size: formatBytes(status.legacyRuntime.bytes),
            path: status.legacyRuntime.path,
          })}
          control={(
            <Button size="xs" variant="secondary" onClick={() => setConfirm('cleanup')} disabled={controlsDisabled}>
              {t('settings.computerUse.legacyRuntimeCleanup')}
            </Button>
          )}
        />
      ) : null}

      <p className="text-xs leading-[1.6] text-[var(--color-text-tertiary)]">{t('settings.computerUse.footer')}</p>

      <ConfirmDialog
        open={confirm === 'install' || confirm === 'upgrade'}
        onClose={() => setConfirm(null)}
        onConfirm={() => startInstall(confirm === 'install' && !status.enabled)}
        title={confirm === 'upgrade'
          ? t('settings.computerUse.installVersion', { version: status.verifiedVersion })
          : t('settings.computerUse.confirmInstallTitle')}
        body={(
          <div className="space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            <p>
              {isMac
                ? t('settings.computerUse.confirmInstallMac', { size: DOWNLOAD_SIZE_MB.darwin ?? 76 })
                : t('settings.computerUse.confirmInstallOther', { size: DOWNLOAD_SIZE_MB[status.platform] ?? 35 })}
            </p>
            {confirm === 'upgrade' ? <p>{t('settings.computerUse.confirmUpgrade')}</p> : null}
            <p>{t('settings.computerUse.confirmTelemetry')}</p>
          </div>
        )}
        confirmLabel={t('settings.computerUse.install')}
        cancelLabel={t('common.cancel')}
        confirmVariant="primary"
      />
      <ConfirmDialog
        open={confirm === 'cleanup'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          void runAction(() => computerUseApi.cleanupLegacyRuntime())
        }}
        title={t('settings.computerUse.legacyRuntimeCleanup')}
        body={t('settings.computerUse.legacyRuntimeConfirm', { path: status.legacyRuntime.path })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </div>
  )
}
