import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { computerUseApi, type ComputerUseStatus, type SetupResult, type InstalledApp, type AuthorizedApp, type ComputerUseMode } from '../api/computerUse'
import { useTranslation } from '../i18n'

type CheckState = 'loading' | 'ready' | 'error'
const PYTHON_DOWNLOAD_URLS: Record<string, string> = {
  darwin: 'https://www.python.org/downloads/macos/',
  win32: 'https://www.python.org/downloads/windows/',
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">help</span>
  }
  return ok ? (
    <span className="material-symbols-outlined text-[18px] text-green-500" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
  ) : (
    <span className="material-symbols-outlined text-[18px] text-red-400" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[var(--color-border-separator)] py-2.5">
      <StatusIcon ok={ok} />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">{label}</div>
        <div className="mt-px text-xs leading-[1.5] text-[var(--color-text-secondary)]">{detail}</div>
      </div>
    </div>
  )
}

async function openSystemSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
  await computerUseApi.openSettings(pane)
}

import { openExternalUrl } from '../lib/externalUrl'
import { Button } from '../components/shared/Button'
import { Switch } from '../components/shared/Switch'
import { SearchField } from '../components/shared/SearchField'
import { SettingsRow } from '../components/settings/SettingsRow'
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader'

export function ComputerUseSettings() {
  const t = useTranslation()
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [checkState, setCheckState] = useState<CheckState>('loading')
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null)

  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [authorizedBundleIds, setAuthorizedBundleIds] = useState<Set<string>>(new Set())
  const [authorizedApps, setAuthorizedApps] = useState<AuthorizedApp[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appsSaved, setAppsSaved] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [computerUseEnabled, setComputerUseEnabled] = useState(true)
  const [computerUseMode, setComputerUseMode] = useState<ComputerUseMode>('vision')
  const [clipboardAccess, setClipboardAccess] = useState(true)
  const [systemKeys, setSystemKeys] = useState(true)
  const [pythonPathDraft, setPythonPathDraft] = useState('')
  const [pythonPathSaved, setPythonPathSaved] = useState('')
  const [pythonPathSaving, setPythonPathSaving] = useState(false)
  const [pythonPathMessage, setPythonPathMessage] = useState<string | null>(null)
  const configMutationSeqRef = useRef(0)
  const modeLocallySetRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    setCheckState('loading')
    try {
      const s = await computerUseApi.getStatus()
      setStatus(s)
      setCheckState('ready')
    } catch {
      setCheckState('error')
    }
  }, [])

  const applyConfig = useCallback((
    configResult: Awaited<ReturnType<typeof computerUseApi.getAuthorizedApps>>,
    requestSeq = configMutationSeqRef.current,
  ) => {
    if (requestSeq !== configMutationSeqRef.current) return
    setComputerUseEnabled(configResult.enabled)
    if (!modeLocallySetRef.current) {
      setComputerUseMode(configResult.mode ?? 'vision')
    }
    setAuthorizedApps(configResult.authorizedApps)
    setAuthorizedBundleIds(new Set(configResult.authorizedApps.map(a => a.bundleId)))
    setClipboardAccess(configResult.grantFlags.clipboardRead)
    setSystemKeys(configResult.grantFlags.systemKeyCombos)
    setPythonPathDraft(configResult.pythonPath ?? '')
    setPythonPathSaved(configResult.pythonPath ?? '')
  }, [])

  const fetchConfig = useCallback(async () => {
    const requestSeq = configMutationSeqRef.current
    try {
      applyConfig(await computerUseApi.getAuthorizedApps(), requestSeq)
    } catch {
    }
  }, [applyConfig])

  const fetchApps = useCallback(async () => {
    const requestSeq = configMutationSeqRef.current
    setAppsLoading(true)
    try {
      const [appsResult, configResult] = await Promise.all([
        computerUseApi.getInstalledApps(),
        computerUseApi.getAuthorizedApps(),
      ])
      setInstalledApps(appsResult.apps)
      applyConfig(configResult, requestSeq)
    } catch {
    } finally {
      setAppsLoading(false)
    }
  }, [applyConfig])

  useEffect(() => {
    fetchStatus()
    fetchConfig()
  }, [fetchStatus, fetchConfig])

  const envReady = status?.venv.created && status?.dependencies.installed
  useEffect(() => {
    if (envReady) fetchApps()
  }, [envReady, fetchApps])

  const handleSetup = async () => {
    setSetupRunning(true)
    setSetupResult(null)
    try {
      const result = await computerUseApi.runSetup()
      setSetupResult(result)
      await fetchStatus()
      if (result.success) await fetchApps()
    } catch {
      setSetupResult({ success: false, steps: [{ name: 'error', ok: false, message: 'Request failed' }] })
    } finally {
      setSetupRunning(false)
    }
  }

  const toggleApp = (app: InstalledApp) => {
    configMutationSeqRef.current += 1
    const newSet = new Set(authorizedBundleIds)
    let newAuthorized = [...authorizedApps]
    if (newSet.has(app.bundleId)) {
      newSet.delete(app.bundleId)
      newAuthorized = newAuthorized.filter(a => a.bundleId !== app.bundleId)
    } else {
      newSet.add(app.bundleId)
      newAuthorized.push({
        bundleId: app.bundleId,
        displayName: app.displayName,
        authorizedAt: new Date().toISOString(),
      })
    }
    setAuthorizedBundleIds(newSet)
    setAuthorizedApps(newAuthorized)

    computerUseApi.setAuthorizedApps({
      mode: computerUseMode,
      authorizedApps: newAuthorized,
      grantFlags: { clipboardRead: clipboardAccess, clipboardWrite: clipboardAccess, systemKeyCombos: systemKeys },
    }).then(() => {
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
    })
  }

  const toggleFlag = (flag: 'clipboard' | 'systemKeys', value: boolean) => {
    configMutationSeqRef.current += 1
    if (flag === 'clipboard') setClipboardAccess(value)
    else setSystemKeys(value)

    computerUseApi.setAuthorizedApps({
      mode: computerUseMode,
      authorizedApps,
      grantFlags: {
        clipboardRead: flag === 'clipboard' ? value : clipboardAccess,
        clipboardWrite: flag === 'clipboard' ? value : clipboardAccess,
        systemKeyCombos: flag === 'systemKeys' ? value : systemKeys,
      },
    })
  }

  const toggleComputerUseEnabled = (value: boolean) => {
    configMutationSeqRef.current += 1
    setComputerUseEnabled(value)
    computerUseApi.setAuthorizedApps({ enabled: value }).then(() => {
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
    })
  }

  const setMode = (mode: ComputerUseMode) => {
    configMutationSeqRef.current += 1
    modeLocallySetRef.current = true
    setComputerUseMode(mode)
    computerUseApi.setAuthorizedApps({ mode }).then(() => {
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
    })
  }

  const savePythonPath = async (value = pythonPathDraft) => {
    configMutationSeqRef.current += 1
    const normalized = value.trim()
    setPythonPathSaving(true)
    setPythonPathMessage(null)
    try {
      await computerUseApi.setAuthorizedApps({ pythonPath: normalized || null })
      setPythonPathDraft(normalized)
      setPythonPathSaved(normalized)
      setPythonPathMessage(t('settings.computerUse.pythonPathSaved'))
      await fetchStatus()
    } catch {
      setPythonPathMessage(t('settings.computerUse.pythonPathSaveFailed'))
    } finally {
      setPythonPathSaving(false)
    }
  }

  const choosePythonPath = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        directory: false,
        title: t('settings.computerUse.pythonPathDialogTitle'),
      })
      const selectedPath = Array.isArray(selected) ? selected[0] : selected
      if (typeof selectedPath === 'string' && selectedPath.trim()) {
        setPythonPathDraft(selectedPath)
        await savePythonPath(selectedPath)
      }
    } catch {
      setPythonPathMessage(t('settings.computerUse.pythonPathDialogFailed'))
    }
  }

  const allReady =
    status?.supported &&
    status.python.installed &&
    status.venv.created &&
    status.dependencies.installed

  const accessibilityNeedsAttention = status?.permissions.accessibility === false
  const screenRecordingNeedsAttention = status?.permissions.screenRecording === false
  const screenRecordingReady = status ? status.permissions.screenRecording !== false : null
  const pythonDownloadUrl = status
    ? PYTHON_DOWNLOAD_URLS[status.platform] ?? 'https://www.python.org/downloads/'
    : 'https://www.python.org/downloads/'
  const pythonPathDirty = pythonPathDraft.trim() !== pythonPathSaved
  const pythonDetail = status?.python.installed
    ? `${t('settings.computerUse.pythonFound')} — ${status.python.version} (${status.python.path})`
    : status?.python.source === 'custom'
      ? `${t('settings.computerUse.pythonCustomInvalid')} — ${status.python.path}${status.python.error ? `: ${status.python.error}` : ''}`
      : t('settings.computerUse.pythonNotFound')

  const filteredApps = useMemo(() => {
    if (!searchQuery) return installedApps
    const q = searchQuery.toLowerCase()
    return installedApps.filter(
      a => a.displayName.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q)
    )
  }, [installedApps, searchQuery])

  const sortedApps = useMemo(() => {
    return [...filteredApps].sort((a, b) => {
      const aAuth = authorizedBundleIds.has(a.bundleId) ? 0 : 1
      const bAuth = authorizedBundleIds.has(b.bundleId) ? 0 : 1
      if (aAuth !== bAuth) return aAuth - bAuth
      return a.displayName.localeCompare(b.displayName)
    })
  }, [filteredApps, authorizedBundleIds])

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
          description={computerUseEnabled ? undefined : t('settings.computerUse.disabledHint')}
          control={
            <Switch
              label={t('settings.computerUse.enabledToggle')}
              checked={computerUseEnabled}
              onChange={(checked) => toggleComputerUseEnabled(checked)}
            />
          }
        />
      </div>

      {computerUseEnabled && (
        <section className="space-y-2.5">
          <div>
            <h3 className="text-[13px] font-medium text-[var(--color-text-secondary)]">
              {t('settings.computerUse.modeLabel')}
            </h3>
            <p className="mt-px text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
              {t('settings.computerUse.modeDescription')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMode('vision')}
              aria-pressed={computerUseMode === 'vision'}
              className={`text-left px-3 py-2.5 rounded-[8px] border transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                computerUseMode === 'vision'
                  ? 'bg-[var(--color-surface-selected)] border-[var(--color-text-secondary)]'
                  : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">Vision</span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-[1.5]">
                {t('settings.computerUse.modeVisionDesc')}
              </p>
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                {t('settings.computerUse.modeVisionRequirement')}
              </p>
            </button>
            <button
              onClick={() => setMode('uia_tree')}
              aria-pressed={computerUseMode === 'uia_tree'}
              className={`text-left px-3 py-2.5 rounded-[8px] border transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                computerUseMode === 'uia_tree'
                  ? 'bg-[var(--color-surface-selected)] border-[var(--color-text-secondary)]'
                  : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">account_tree</span>
                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">UIA Tree</span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-[1.5]">
                {t('settings.computerUse.modeUiaDesc')}
              </p>
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                {t('settings.computerUse.modeUiaRequirement')}
              </p>
            </button>
          </div>
        </section>
      )}

      {checkState === 'loading' ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common.loading')}
        </div>
      ) : checkState === 'error' ? (
        <div className="py-8 text-center text-sm text-red-400">
          Failed to check status.
          <button onClick={fetchStatus} className="ml-2 underline">{t('common.retry')}</button>
        </div>
      ) : status ? (
        <>
          {!status.supported && (
            <div className="px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-600">
              {t('settings.computerUse.notSupported')}
            </div>
          )}

          <div>
            <StatusRow
              label={t('settings.computerUse.python')}
              ok={status.python.installed}
              detail={pythonDetail}
            />
            <StatusRow
              label={t('settings.computerUse.venv')}
              ok={status.venv.created}
              detail={status.venv.created ? `${t('settings.computerUse.venvReady')} — ${status.venv.path}` : t('settings.computerUse.venvNotReady')}
            />
            <StatusRow
              label={t('settings.computerUse.deps')}
              ok={status.dependencies.installed}
              detail={status.dependencies.installed ? t('settings.computerUse.depsReady') : t('settings.computerUse.depsNotReady')}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="computer-use-python-path" className="block text-xs text-[var(--color-text-secondary)]">
              {t('settings.computerUse.pythonPathLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="computer-use-python-path"
                type="text"
                value={pythonPathDraft}
                onChange={e => {
                  setPythonPathDraft(e.target.value)
                  setPythonPathMessage(null)
                }}
                placeholder={t('settings.computerUse.pythonPathPlaceholder')}
                className="h-8 min-w-[220px] flex-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 font-mono text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-[border-color,box-shadow] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
              />
              <Button size="xs" variant="secondary" onClick={choosePythonPath} disabled={pythonPathSaving}>
                {t('settings.computerUse.pythonPathBrowse')}
              </Button>
              <Button size="xs" variant="secondary" onClick={() => savePythonPath()} disabled={pythonPathSaving || !pythonPathDirty}>
                {t('settings.computerUse.pythonPathSave')}
              </Button>
              {pythonPathSaved && (
                <Button size="xs" variant="secondary" onClick={() => savePythonPath('')} disabled={pythonPathSaving}>
                  {t('settings.computerUse.pythonPathAuto')}
                </Button>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {pythonPathMessage ?? t('settings.computerUse.pythonPathHint')}
            </p>
          </div>

          {envReady && status.platform === 'darwin' && (
            <>
              <StatusRow
                label={t('settings.computerUse.accessibility')}
                ok={status.permissions.accessibility}
                detail={
                  status.permissions.accessibility === null ? t('settings.computerUse.permUnknown')
                    : status.permissions.accessibility ? t('settings.computerUse.permGranted')
                      : t('settings.computerUse.permDenied')
                }
              />
              <StatusRow
                label={t('settings.computerUse.screenRecording')}
                ok={screenRecordingReady}
                detail={
                  status.permissions.screenRecording === true ? t('settings.computerUse.permGranted')
                    : status.permissions.screenRecording === false ? t('settings.computerUse.permDenied')
                      : t('settings.computerUse.permScreenRecordingUnknownSoft')
                }
              />
              {(accessibilityNeedsAttention || screenRecordingNeedsAttention) && (
                <div className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] py-1.5 pl-3">
                  <p className="text-xs leading-[1.7] text-[var(--color-text-secondary)]">{t('settings.computerUse.permRestartHint')}</p>
                  <div className="flex gap-1.5">
                    {accessibilityNeedsAttention && (
                      <button
                        onClick={() => openSystemSettings('Privacy_Accessibility')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
                      >
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        {t('settings.computerUse.openAccessibility')}
                      </button>
                    )}
                    {screenRecordingNeedsAttention && (
                      <button
                        onClick={() => openSystemSettings('Privacy_ScreenCapture')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
                      >
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        {t('settings.computerUse.openScreenRecording')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {allReady && (status.platform !== 'darwin' || (status.permissions.accessibility && screenRecordingReady)) && (
            <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-600 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              {t('settings.computerUse.allReady')}
            </div>
          )}

          {setupResult && (
            <div className={`rounded-lg border p-4 space-y-2 ${setupResult.success ? 'bg-green-500/5 border-green-500/30' : 'bg-red-500/5 border-red-500/30'}`}>
              <div className={`text-sm font-medium ${setupResult.success ? 'text-green-600' : 'text-red-400'}`}>
                {setupResult.success ? t('settings.computerUse.setupSuccess') : t('settings.computerUse.setupFail')}
              </div>
              {setupResult.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <StatusIcon ok={step.ok} />
                  <span>{step.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {!status.python.installed && (
              <Button size="xs" onClick={() => openExternalUrl(pythonDownloadUrl)}>
                {t('settings.computerUse.downloadPython')}
              </Button>
            )}
            {!envReady && status.python.installed && (
              <Button size="xs" onClick={handleSetup} disabled={setupRunning} loading={setupRunning}>
                {setupRunning ? t('settings.computerUse.setupRunning') : t('settings.computerUse.setupBtn')}
              </Button>
            )}
            <Button size="xs" variant="secondary" onClick={fetchStatus}>
              {t('settings.computerUse.recheckBtn')}
            </Button>
          </div>

          {envReady && (
            <section className="space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-secondary)]">
                  {t('settings.computerUse.appsTitle')}
                  {appsSaved && (
                    <span className="text-xs font-normal text-green-500 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                      {t('settings.computerUse.appsSaved')}
                    </span>
                  )}
                </h3>
                <p className="mt-px text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsDescription')}
                </p>
              </div>

              <div>
                <SettingsRow
                  title={t('settings.computerUse.flagClipboard')}
                  control={
                    <Switch
                      label={t('settings.computerUse.flagClipboard')}
                      checked={clipboardAccess}
                      onChange={(checked) => toggleFlag('clipboard', checked)}
                    />
                  }
                />
                <SettingsRow
                  title={t('settings.computerUse.flagSystemKeys')}
                  control={
                    <Switch
                      label={t('settings.computerUse.flagSystemKeys')}
                      checked={systemKeys}
                      onChange={(checked) => toggleFlag('systemKeys', checked)}
                    />
                  }
                />
              </div>

              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                aria-label={t('settings.computerUse.appsSearch')}
                placeholder={t('settings.computerUse.appsSearch')}
              />

              {appsLoading ? (
                <div className="py-6 text-center text-sm text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsLoading')}
                </div>
              ) : installedApps.length === 0 ? (
                <div className="py-6 text-center text-sm text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsEmpty')}
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto">
                  {sortedApps.map(app => {
                    const isAuthorized = authorizedBundleIds.has(app.bundleId)
                    return (
                      <button
                        key={app.bundleId}
                        onClick={() => toggleApp(app)}
                        aria-pressed={isAuthorized}
                        className="flex w-full items-center gap-3 border-b border-[var(--color-border-separator)] px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${
                          isAuthorized
                            ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                            : 'border-[var(--color-border)]'
                        }`}>
                          {isAuthorized && (
                            <span className="material-symbols-outlined text-[14px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
                            {app.displayName}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-tertiary)] truncate font-mono">
                            {app.bundleId}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </>
      ) : null}
    </div>
  )
}
