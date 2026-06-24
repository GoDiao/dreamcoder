import { useState, useEffect, useMemo } from 'react'
import QRCode from 'qrcode'
import { Copy, Eye, EyeOff, PowerOff, QrCode, RotateCw } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { copyTextToClipboard } from '../chat/clipboard'

// ─── Helper functions (private to H5AccessSettings) ──────────────

function buildH5LaunchUrl(baseUrl: string | null, token: string | null): string | null {
  if (!baseUrl) return null

  try {
    const url = new URL(baseUrl)
    if (token) {
      url.searchParams.set('serverUrl', baseUrl)
      url.searchParams.set('h5Token', token)
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return token
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}serverUrl=${encodeURIComponent(baseUrl)}&h5Token=${encodeURIComponent(token)}`
      : baseUrl
  }
}

function isLanH5BaseUrl(url: URL): boolean {
  return url.protocol === 'http:' &&
    !!url.port &&
    (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('10.') ||
      url.hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname) ||
      url.hostname.startsWith('169.254.')
    )
}

function extractH5AccessAddressDraft(baseUrl: string | null): string {
  if (!baseUrl) return ''

  try {
    const url = new URL(baseUrl)
    return isLanH5BaseUrl(url) ? url.hostname : baseUrl
  } catch {
    return baseUrl
  }
}

function extractHostnameFromUrl(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}

function extractH5AccessPort(baseUrl: string | null): string | null {
  if (!baseUrl) return null

  try {
    const url = new URL(baseUrl)
    return url.port || null
  } catch {
    return null
  }
}

function buildH5PublicBaseUrlFromHostDraft(draft: string, currentBaseUrl: string | null): string | null {
  const trimmed = draft.trim()
  if (!trimmed) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed

  try {
    const current = currentBaseUrl ? new URL(currentBaseUrl) : null
    if (!current) return trimmed

    const port = current.port ? `:${current.port}` : ''
    const path = current.pathname === '/' ? '' : current.pathname.replace(/\/+$/, '')
    return `${current.protocol}//${trimmed}${port}${path}`
  } catch {
    return trimmed
  }
}

// ─── H5 Access Settings Component ───────────────────────────────

export function H5AccessSettings() {
  const {
    h5Access,
    h5AccessDiagnostics,
    h5AccessError,
    enableH5Access,
    disableH5Access,
    regenerateH5AccessToken,
    updateH5AccessSettings,
  } = useSettingsStore()
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [h5PublicBaseUrlDraft, setH5PublicBaseUrlDraft] = useState(extractH5AccessAddressDraft(h5Access.publicBaseUrl))
  const [h5GeneratedToken, setH5GeneratedToken] = useState<string | null>(null)
  const [h5TokenVisible, setH5TokenVisible] = useState(false)
  const [h5EnableConfirmOpen, setH5EnableConfirmOpen] = useState(false)
  const [h5QrDataUrl, setH5QrDataUrl] = useState<string | null>(null)
  const [h5ActionRunning, setH5ActionRunning] = useState(false)
  const h5AccessUrl = h5Access.publicBaseUrl
  const h5LaunchUrl = useMemo(
    () => buildH5LaunchUrl(h5AccessUrl, h5GeneratedToken),
    [h5AccessUrl, h5GeneratedToken],
  )
  const h5AccessPort = extractH5AccessPort(h5AccessUrl)
  const h5NextPublicBaseUrl = buildH5PublicBaseUrlFromHostDraft(h5PublicBaseUrlDraft, h5Access.publicBaseUrl)
  const h5AccessDirty = h5NextPublicBaseUrl !== (h5Access.publicBaseUrl ?? null)

  useEffect(() => {
    setH5PublicBaseUrlDraft(extractH5AccessAddressDraft(h5Access.publicBaseUrl))
  }, [h5Access])

  useEffect(() => {
    let cancelled = false
    if (!h5Access.enabled || !h5LaunchUrl || !h5GeneratedToken) {
      setH5QrDataUrl(null)
      return () => {
        cancelled = true
      }
    }

    QRCode.toDataURL(h5LaunchUrl, { margin: 1, width: 192 })
      .then((dataUrl) => {
        if (!cancelled) setH5QrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setH5QrDataUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [h5Access.enabled, h5LaunchUrl, h5GeneratedToken])

  const runH5Action = async (action: () => Promise<void>) => {
    setH5ActionRunning(true)
    try {
      await action()
    } catch {
      // The store owns H5-specific error state.
    } finally {
      setH5ActionRunning(false)
    }
  }

  const handleH5SettingsSave = async () => {
    await runH5Action(async () => {
      await updateH5AccessSettings({
        publicBaseUrl: h5NextPublicBaseUrl,
      })
    })
  }

  const handleH5SwitchToSuggestedHost = async () => {
    const suggested = h5AccessDiagnostics?.suggestedHost
    if (!suggested) return
    await runH5Action(async () => {
      // Build URL using current port if available, otherwise let backend pick.
      const port = extractH5AccessPort(h5Access.publicBaseUrl)
      const nextUrl = port ? `http://${suggested}:${port}` : `http://${suggested}`
      await updateH5AccessSettings({ publicBaseUrl: nextUrl })
    })
  }

  const handleH5UrlCopy = async () => {
    if (!h5AccessUrl) return
    const copied = await copyTextToClipboard(h5AccessUrl)
    addToast({
      type: copied ? 'success' : 'error',
      message: copied ? t('settings.general.h5AccessUrlCopied') : t('common.copyFailed'),
    })
  }

  const handleH5LaunchUrlCopy = async () => {
    if (!h5LaunchUrl) return
    const copied = await copyTextToClipboard(h5LaunchUrl)
    addToast({
      type: copied ? 'success' : 'error',
      message: copied ? t('settings.general.h5AccessLaunchUrlCopied') : t('common.copyFailed'),
    })
  }

  const handleH5EnableConfirm = async () => {
    await runH5Action(async () => {
      const token = await enableH5Access()
      setH5GeneratedToken(token)
      setH5TokenVisible(false)
      setH5EnableConfirmOpen(false)
    })
  }

  const handleH5Disable = async () => {
    await runH5Action(async () => {
      await disableH5Access()
      setH5GeneratedToken(null)
      setH5TokenVisible(false)
    })
  }

  const handleH5Regenerate = async () => {
    await runH5Action(async () => {
      const token = await regenerateH5AccessToken()
      setH5GeneratedToken(token)
      setH5TokenVisible(false)
    })
  }

  return (
    <div className="max-w-3xl">
      <section aria-labelledby="h5-access-title" role="region">
        <div className="mb-5 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-brand)]">
            <QrCode className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id="h5-access-title"
              className="text-base font-semibold text-[var(--color-text-primary)] mb-1"
            >
              {t('settings.general.h5AccessTitle')}
            </h2>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('settings.general.h5AccessDescription')}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <label className="flex min-w-0 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                checked={h5Access.enabled}
                disabled={h5ActionRunning}
                aria-label={t('settings.general.h5AccessEnabled')}
                onChange={(event) => {
                  if (event.target.checked) {
                    setH5EnableConfirmOpen(true)
                  } else {
                    void handleH5Disable()
                  }
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                  {t('settings.general.h5AccessEnabled')}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">
                  {t('settings.general.h5AccessEnabledHint')}
                </span>
              </span>
            </label>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                h5Access.enabled
                  ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-tertiary)] border border-[var(--color-border)]'
              }`}
            >
              {h5Access.enabled ? t('settings.general.h5AccessStatusEnabled') : t('settings.general.h5AccessDisabledValue')}
            </span>
          </div>

          {h5AccessDiagnostics?.storedHostStaleness === 'unreachable' && h5AccessDiagnostics.storedPublicBaseUrl ? (
            <div
              data-testid="h5-access-stale-host-banner"
              className="mt-4 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-3 text-xs leading-5 text-[var(--color-text-primary)]"
            >
              <div className="font-semibold">
                {t('settings.general.h5AccessStaleHostTitle')}
              </div>
              <div className="mt-1 text-[var(--color-text-secondary)]">
                {h5AccessDiagnostics.suggestedHost
                  ? t('settings.general.h5AccessStaleHostBody', {
                      storedHost: extractHostnameFromUrl(h5AccessDiagnostics.storedPublicBaseUrl) ?? h5AccessDiagnostics.storedPublicBaseUrl,
                    })
                  : t('settings.general.h5AccessStaleHostNoSuggestion', {
                      storedHost: extractHostnameFromUrl(h5AccessDiagnostics.storedPublicBaseUrl) ?? h5AccessDiagnostics.storedPublicBaseUrl,
                    })}
              </div>
              {h5AccessDiagnostics.suggestedHost && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={h5ActionRunning}
                    onClick={() => void handleH5SwitchToSuggestedHost()}
                    data-testid="h5-access-stale-host-apply"
                  >
                    {t('settings.general.h5AccessStaleHostApply', {
                      suggestedHost: h5AccessDiagnostics.suggestedHost,
                    })}
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {h5AccessDiagnostics?.storedHostStaleness === 'proxy' ? (
            <div
              data-testid="h5-access-proxy-note"
              className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-xs leading-5 text-[var(--color-text-tertiary)]"
            >
              {t('settings.general.h5AccessProxyNote')}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <Input
                id="h5-access-public-url"
                label={t('settings.general.h5AccessPublicHost')}
                value={h5PublicBaseUrlDraft}
                placeholder={t('settings.general.h5AccessPublicHostPlaceholder')}
                onChange={(event) => setH5PublicBaseUrlDraft(event.target.value)}
              />
              <Input
                id="h5-access-current-port"
                label={t('settings.general.h5AccessCurrentPort')}
                value={h5AccessPort ?? t('settings.general.h5AccessCurrentPortUnknown')}
                readOnly
                className="text-[var(--color-text-tertiary)]"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {t('settings.general.h5AccessOpenHint')}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleH5SettingsSave()}
                disabled={!h5AccessDirty || h5ActionRunning}
                aria-label={t('settings.general.h5AccessSave')}
              >
                {t('settings.general.h5AccessSave')}
              </Button>
            </div>
          </div>

          {h5AccessUrl && (
            <div className="mt-4 border-t border-[var(--color-border)]/60 pt-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                    {t('settings.general.h5AccessUrl')}
                  </div>
                  <div className="mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] break-all">
                    {h5AccessUrl}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                  aria-label={t('settings.general.h5AccessCopyUrl')}
                  onClick={() => void handleH5UrlCopy()}
                >
                  {t('settings.general.h5AccessCopy')}
                </Button>
              </div>
            </div>
          )}

          {h5Access.enabled && h5AccessUrl && (
            <div className="mt-4 border-t border-[var(--color-border)]/60 pt-4">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white p-3">
                  {h5QrDataUrl ? (
                    <img
                      src={h5QrDataUrl}
                      alt={t('settings.general.h5AccessQrAlt')}
                      className="h-full w-full"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 px-4 text-center">
                      <QrCode className="h-12 w-12 text-neutral-400" aria-hidden="true" />
                      <p className="text-xs leading-5 text-neutral-500">
                        {t('settings.general.h5AccessQrEmptyHint')}
                      </p>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium uppercase text-[var(--color-text-tertiary)]">
                    {t('settings.general.h5AccessQrTitle')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {h5GeneratedToken
                      ? t('settings.general.h5AccessQrHint')
                      : t('settings.general.h5AccessQrRefreshHint')}
                  </p>
                  {h5LaunchUrl && (
                    <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] break-all">
                      {h5LaunchUrl}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                      disabled={!h5LaunchUrl || !h5GeneratedToken}
                      onClick={() => void handleH5LaunchUrlCopy()}
                    >
                      {t('settings.general.h5AccessCopyLaunchUrl')}
                    </Button>
                    <Button
                      size="sm"
                      variant={h5GeneratedToken ? 'secondary' : 'primary'}
                      icon={<RotateCw className="h-3.5 w-3.5" aria-hidden="true" />}
                      loading={h5ActionRunning}
                      onClick={() => void handleH5Regenerate()}
                    >
                      {h5GeneratedToken ? t('settings.general.h5AccessRegenerate') : t('settings.general.h5AccessGenerateToken')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {h5Access.enabled && (
            <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase text-[var(--color-text-tertiary)]">
                    {t('settings.general.h5AccessTokenPreview')}
                  </div>
                  <div className="mt-1 break-all text-sm text-[var(--color-text-primary)]">
                    {h5TokenVisible && h5GeneratedToken
                      ? h5GeneratedToken
                      : h5Access.tokenPreview || t('settings.general.h5AccessTokenNotAvailable')}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={h5TokenVisible ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                    disabled={!h5GeneratedToken}
                    onClick={() => setH5TokenVisible((visible) => !visible)}
                  >
                    {h5TokenVisible ? t('settings.general.h5AccessHideToken') : t('settings.general.h5AccessShowToken')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<PowerOff className="h-3.5 w-3.5" aria-hidden="true" />}
                    loading={h5ActionRunning}
                    onClick={() => void handleH5Disable()}
                  >
                    {t('settings.general.h5AccessDisable')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-[var(--color-text-tertiary)] leading-5">
            {t('settings.general.h5AccessSafetyNote')}
          </p>
          {h5AccessError && (
            <p className="mt-2 text-xs text-[var(--color-error)]">
              {h5AccessError}
            </p>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={h5EnableConfirmOpen}
        onClose={() => {
          if (!h5ActionRunning) setH5EnableConfirmOpen(false)
        }}
        onConfirm={handleH5EnableConfirm}
        title={t('settings.general.h5AccessConfirmTitle')}
        body={t('settings.general.h5AccessConfirmBody')}
        confirmLabel={t('settings.general.h5AccessConfirmEnable')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={h5ActionRunning}
      />
    </div>
  )
}
