import { useState, useEffect } from 'react'
import { DreamCoderIcon } from '../shared/DreamCoderIcon'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUpdateStore } from '../../stores/updateStore'
import { useTranslation } from '../../i18n'
import { formatBytes } from '../../lib/formatBytes'
import { isValidHttpProxyUrl } from '../../lib/validation'
import type { UpdateProxyMode } from '../../types/settings'

const GITHUB_REPO = 'https://github.com/GoDiao/dreamcoder'
const GITHUB_ISSUES = `${GITHUB_REPO}/issues`
const GITHUB_RELEASES = `${GITHUB_REPO}/releases`
const AUTHOR_GITHUB = 'https://github.com/GoDiao'

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function AboutSettings() {
  const t = useTranslation()
  const updateProxy = useSettingsStore((s) => s.updateProxy)
  const setUpdateProxy = useSettingsStore((s) => s.setUpdateProxy)
  const [version, setVersion] = useState('')
  const updateStatus = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const progressPercent = useUpdateStore((s) => s.progressPercent)
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes)
  const totalBytes = useUpdateStore((s) => s.totalBytes)
  const error = useUpdateStore((s) => s.error)
  const checkedAt = useUpdateStore((s) => s.checkedAt)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const initialize = useUpdateStore((s) => s.initialize)
  const [updateProxyDraft, setUpdateProxyDraft] = useState(updateProxy)
  const [updateProxySaveError, setUpdateProxySaveError] = useState<string | null>(null)
  const [isSavingUpdateProxy, setIsSavingUpdateProxy] = useState(false)

  useEffect(() => {
    let cancelled = false

    import('@tauri-apps/api/app')
      .then((mod) => mod.getVersion())
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch(() => {
        if (!cancelled) setVersion('0.1.0')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    setUpdateProxyDraft(updateProxy)
    setUpdateProxySaveError(null)
  }, [updateProxy])

  const checkedAtText =
    checkedAt
      ? new Date(checkedAt).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        })
      : null
  const updateProxyModes: Array<{ value: UpdateProxyMode; label: string; description: string }> = [
    {
      value: 'system',
      label: t('update.proxyModeSystem'),
      description: t('update.proxyModeSystemDescription'),
    },
    {
      value: 'manual',
      label: t('update.proxyModeManual'),
      description: t('update.proxyModeManualDescription'),
    },
  ]
  const manualProxyUrl = updateProxyDraft.url.trim()
  const manualProxyError =
    updateProxyDraft.mode === 'manual' && !manualProxyUrl
      ? t('update.proxyUrlRequired')
      : updateProxyDraft.mode === 'manual' && !isValidHttpProxyUrl(manualProxyUrl)
        ? t('update.proxyUrlInvalid')
        : null
  const updateProxyDirty =
    updateProxyDraft.mode !== updateProxy.mode ||
    updateProxyDraft.url.trim() !== updateProxy.url.trim()

  const saveUpdateProxy = async () => {
    if (manualProxyError) {
      setUpdateProxySaveError(manualProxyError)
      return
    }

    setIsSavingUpdateProxy(true)
    setUpdateProxySaveError(null)
    try {
      await setUpdateProxy({
        mode: updateProxyDraft.mode,
        url: manualProxyUrl,
      })
    } catch (error) {
      setUpdateProxySaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSavingUpdateProxy(false)
    }
  }

  const hasKnownProgress = typeof totalBytes === 'number' && totalBytes > 0
  const downloadedText = formatBytes(downloadedBytes)
  const updateDescription =
    updateStatus === 'checking'
      ? t('update.checking')
      : updateStatus === 'downloading'
        ? hasKnownProgress
          ? t('update.progress', { progress: String(progressPercent) })
          : t('update.progressBytes', { downloaded: downloadedText })
        : updateStatus === 'restarting'
          ? t('update.restarting')
          : updateStatus === 'available' && availableVersion
            ? t('update.newVersion', { version: availableVersion })
            : updateStatus === 'up-to-date'
              ? t('update.upToDate', { version: version || t('update.currentVersionUnknown') })
              : error
                ? t('update.failed', { error })
                : t('update.idle')

  return (
    <div className="w-full min-w-0 max-w-lg mx-auto flex flex-col items-center py-6">
      {/* Logo + App Name + Version */}
      <DreamCoderIcon size={80} className="mb-4" />
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">DreamCoder</h1>
      {version && (
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <span>{t('settings.about.version')} {version}</span>
          <span className="text-[var(--color-border)]">·</span>
          <button
            onClick={() => openUrl(GITHUB_RELEASES)}
            className="rounded-[var(--radius-sm)] text-[var(--color-text-accent)] transition-colors hover:text-[var(--color-brand)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
          >
            {t('settings.about.changelog')}
          </button>
        </div>
      )}

      {/* GitHub Repo */}
      <div className="mt-6 w-full">
        <button
          onClick={() => openUrl(GITHUB_REPO)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <img src="/icons/github.svg" alt="GitHub" className="w-5 h-5 opacity-70" />
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">GoDiao/dreamcoder</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">{t('settings.about.starHint')}</div>
          </div>
        </button>
      </div>

      {/* TODO: Restore update checker after first public release */}
      <div className="mt-4 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.about.updates')}</div>
        <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
          {t('settings.about.updatesNotAvailable')}
        </div>
      </div>

      {/* Divider */}
      <div className="w-full border-t border-[var(--color-border)]/40 my-6" />

      {/* Author */}
      <div className="w-full">
        <h3 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">{t('settings.about.author')}</h3>
        <button
          onClick={() => openUrl(AUTHOR_GITHUB)}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <img src="/icons/github.svg" alt="GitHub" className="w-4 h-4 opacity-60" />
          <span className="text-sm text-[var(--color-text-primary)]">GoDiao</span>
          <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">GitHub</span>
        </button>
      </div>

      <div className="mt-6 w-full">
        <button
          onClick={() => openUrl(GITHUB_ISSUES)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">feedback</span>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.about.feedback')}</div>
            <div className="text-xs text-[var(--color-text-tertiary)]">{t('settings.about.feedbackDesc')}</div>
          </div>
        </button>
      </div>
    </div>
  )
}
