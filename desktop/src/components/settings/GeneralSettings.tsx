import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { RotateCw } from 'lucide-react'
import { useSettingsStore, UI_ZOOM_DEFAULT, UI_ZOOM_MIN, UI_ZOOM_MAX, UI_ZOOM_STEP } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { Dropdown } from '../shared/Dropdown'
import type { EffortLevel, ThemeMode, WebSearchMode, AppMode } from '../../types/settings'
import type { Locale } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { isTauriRuntime } from '../../lib/desktopRuntime'
import { isValidHttpProxyUrl } from '../../lib/validation'
import { ProxyConfigForm } from './ProxyConfigForm'
import {
  getDesktopNotificationPermission,
  notifyDesktop,
  openDesktopNotificationSettings,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from '../../lib/desktopNotifications'

const NETWORK_TIMEOUT_MIN_SECONDS = 5
const NETWORK_TIMEOUT_MAX_SECONDS = 600
const NETWORK_TIMEOUT_STEP_SECONDS = 30

function SettingsCheckboxMark({ checked, disabled = false }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-brand)]/40 ${
        checked
          ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white shadow-[var(--shadow-button-primary)]'
          : 'border-[var(--color-border-focus)] bg-[var(--color-surface)] text-transparent'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span className="material-symbols-outlined text-[16px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
        check
      </span>
    </span>
  )
}

export function GeneralSettings() {
  const {
    effortLevel,
    setEffort,
    thinkingEnabled,
    setThinkingEnabled,
    locale,
    setLocale,
    theme,
    setTheme,
    skipWebFetchPreflight,
    setSkipWebFetchPreflight,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    webSearch,
    setWebSearch,
    network,
    setNetwork,
    responseLanguage,
    setResponseLanguage,
    appMode,
    appModeRequiresRestart,
    fetchAppMode,
    setAppMode: setAppModeAction,
    uiZoom,
    setUiZoom,
  } = useSettingsStore()
  const t = useTranslation()
  const [webSearchDraft, setWebSearchDraft] = useState(webSearch)
  const [networkDraft, setNetworkDraft] = useState(network)
  const [networkTimeoutInput, setNetworkTimeoutInput] = useState(String(Math.round(network.aiRequestTimeoutMs / 1000)))
  const [networkSaveError, setNetworkSaveError] = useState<string | null>(null)
  const [isSavingNetwork, setIsSavingNetwork] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<DesktopNotificationPermission>('default')
  const [notificationActionRunning, setNotificationActionRunning] = useState(false)
  const [modeSwitchConfirmOpen, setModeSwitchConfirmOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null)
  const [pendingPortableDir, setPendingPortableDir] = useState<string | null>(null)
  const [portableDirDraft, setPortableDirDraft] = useState('')
  const [modeActionRunning, setModeActionRunning] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)
  const [uiZoomDraft, setUiZoomDraft] = useState(uiZoom)
  const [isUiZoomDragging, setIsUiZoomDragging] = useState(false)
  const isUiZoomDraggingRef = useRef(false)
  const addToast = useUIStore((s) => s.addToast)
  const webSearchDirty = JSON.stringify(webSearchDraft) !== JSON.stringify(webSearch)
  const uiZoomPercent = Math.round(uiZoomDraft * 100)
  const uiZoomRangeProgress = `${Math.round(((uiZoomDraft - UI_ZOOM_MIN) / (UI_ZOOM_MAX - UI_ZOOM_MIN)) * 1000) / 10}%`
  const activeConfigDir = appMode.activeConfigDir ?? (appMode.mode === 'portable' ? appMode.portableDir : null)
  const configDirSource = appMode.configDirSource ?? (appMode.mode === 'portable' ? 'portable' : 'system')
  const isEnvironmentConfigDir = configDirSource === 'environment'

  useEffect(() => {
    setWebSearchDraft(webSearch)
  }, [webSearch])

  useEffect(() => {
    setNetworkDraft(network)
    setNetworkTimeoutInput(String(Math.round(network.aiRequestTimeoutMs / 1000)))
    setNetworkSaveError(null)
  }, [network])

  useEffect(() => {
    if (!isUiZoomDragging) {
      setUiZoomDraft(uiZoom)
    }
  }, [isUiZoomDragging, uiZoom])

  useEffect(() => {
    let cancelled = false
    getDesktopNotificationPermission().then((permission) => {
      if (!cancelled) setNotificationPermission(permission)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    void fetchAppMode()
  }, [fetchAppMode])

  useEffect(() => {
    setPortableDirDraft(appMode.portableDir ?? appMode.defaultPortableDir ?? '')
  }, [appMode.defaultPortableDir, appMode.portableDir])

  const EFFORT_LABELS: Record<EffortLevel, string> = {
    low: t('settings.general.effort.low'),
    medium: t('settings.general.effort.medium'),
    high: t('settings.general.effort.high'),
    max: t('settings.general.effort.max'),
  }

  const LANGUAGES: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ]

  const RESPONSE_LANGUAGES: Array<{ value: string; label: string }> = [
    { value: '', label: t('settings.general.responseLangDefault') },
    { value: 'english', label: 'English' },
    { value: 'chinese', label: '中文 (Chinese)' },
    { value: 'japanese', label: '日本語 (Japanese)' },
    { value: 'korean', label: '한국어 (Korean)' },
    { value: 'spanish', label: 'Español (Spanish)' },
    { value: 'french', label: 'Français (French)' },
    { value: 'german', label: 'Deutsch (German)' },
    { value: 'portuguese', label: 'Português (Portuguese)' },
    { value: 'italian', label: 'Italiano (Italian)' },
    { value: 'russian', label: 'Русский (Russian)' },
    { value: 'dutch', label: 'Nederlands (Dutch)' },
    { value: 'polish', label: 'Polski (Polish)' },
    { value: 'turkish', label: 'Türkçe (Turkish)' },
    { value: 'hindi', label: 'हिन्दी (Hindi)' },
    { value: 'indonesian', label: 'Bahasa Indonesia' },
    { value: 'ukrainian', label: 'Українська (Ukrainian)' },
    { value: 'greek', label: 'Ελληνικά (Greek)' },
    { value: 'czech', label: 'Čeština (Czech)' },
    { value: 'danish', label: 'Dansk (Danish)' },
    { value: 'swedish', label: 'Svenska (Swedish)' },
    { value: 'norwegian', label: 'Norsk (Norwegian)' },
  ]
  const selectedResponseLanguageLabel =
    RESPONSE_LANGUAGES.find(({ value }) => value === responseLanguage)?.label ?? RESPONSE_LANGUAGES[0]!.label

  const THEMES: Array<{ value: ThemeMode; label: string }> = [
    { value: 'white', label: t('settings.general.appearance.white') },
    { value: 'light', label: t('settings.general.appearance.light') },
    { value: 'dark', label: t('settings.general.appearance.dark') },
    { value: 'midnight', label: t('settings.general.appearance.midnight') },
    { value: 'dreamfield', label: t('settings.general.appearance.dreamfield') },
    { value: 'amber', label: t('settings.general.appearance.amber') },
  ]

  const WEB_SEARCH_MODES: Array<{ value: WebSearchMode; label: string }> = [
    { value: 'auto', label: t('settings.general.webSearch.mode.auto') },
    { value: 'tavily', label: t('settings.general.webSearch.mode.tavily') },
    { value: 'brave', label: t('settings.general.webSearch.mode.brave') },
    { value: 'anthropic', label: t('settings.general.webSearch.mode.anthropic') },
    { value: 'disabled', label: t('settings.general.webSearch.mode.disabled') },
  ]

  const notificationStatusLabel: Record<DesktopNotificationPermission, string> = {
    granted: t('settings.general.notificationsStatusGranted'),
    denied: t('settings.general.notificationsStatusDenied'),
    default: t('settings.general.notificationsStatusDefault'),
    unsupported: t('settings.general.notificationsStatusUnsupported'),
  }

  const handleDesktopNotificationsToggle = async (enabled: boolean) => {
    await setDesktopNotificationsEnabled(enabled)
    if (!enabled) return

    setNotificationActionRunning(true)
    try {
      const permission = await requestDesktopNotificationPermission()
      setNotificationPermission(permission)
      if (permission === 'granted') {
        void notifyDesktop({
          title: t('settings.general.notificationsTestTitle'),
          body: t('settings.general.notificationsTestBody'),
        })
      }
      if (permission === 'denied') {
        await openDesktopNotificationSettings()
      }
    } finally {
      setNotificationActionRunning(false)
    }
  }

  const handleNotificationPermissionAction = async () => {
    setNotificationActionRunning(true)
    try {
      if (notificationPermission === 'denied') {
        await openDesktopNotificationSettings()
      } else {
        const permission = await requestDesktopNotificationPermission()
        setNotificationPermission(permission)
        if (permission === 'granted') {
          void notifyDesktop({
            title: t('settings.general.notificationsTestTitle'),
            body: t('settings.general.notificationsTestBody'),
          })
        }
        if (permission === 'denied') {
          await openDesktopNotificationSettings()
        }
      }
    } finally {
      setNotificationActionRunning(false)
    }
  }

  const networkProxyUrl = networkDraft.proxy.url.trim()
  const networkProxyError =
    networkDraft.proxy.mode === 'manual' && !networkProxyUrl
      ? t('settings.general.networkProxyUrlRequired')
      : networkDraft.proxy.mode === 'manual' && !isValidHttpProxyUrl(networkProxyUrl)
        ? t('settings.general.networkProxyUrlInvalid')
        : null
  const timeoutSeconds = Math.round(networkDraft.aiRequestTimeoutMs / 1000)
  const parsedNetworkTimeoutSeconds = (() => {
    const trimmed = networkTimeoutInput.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds) || seconds < NETWORK_TIMEOUT_MIN_SECONDS || seconds > NETWORK_TIMEOUT_MAX_SECONDS) return null
    return seconds
  })()
  const networkTimeoutError =
    networkTimeoutInput.trim().length === 0
      ? t('settings.general.networkTimeoutRequired')
      : parsedNetworkTimeoutSeconds === null
        ? t('settings.general.networkTimeoutRange', {
            min: String(NETWORK_TIMEOUT_MIN_SECONDS),
            max: String(NETWORK_TIMEOUT_MAX_SECONDS),
          })
        : null
  const networkDirty =
    networkDraft.aiRequestTimeoutMs !== network.aiRequestTimeoutMs ||
    networkDraft.proxy.mode !== network.proxy.mode ||
    networkDraft.proxy.url.trim() !== network.proxy.url.trim()

  const setNetworkTimeoutSeconds = (seconds: number) => {
    const nextSeconds = Math.min(Math.max(Math.round(seconds), NETWORK_TIMEOUT_MIN_SECONDS), NETWORK_TIMEOUT_MAX_SECONDS)
    setNetworkTimeoutInput(String(nextSeconds))
    setNetworkDraft((current) => ({
      ...current,
      aiRequestTimeoutMs: nextSeconds * 1000,
    }))
    setNetworkSaveError(null)
  }

  const saveNetworkSettings = async () => {
    if (networkProxyError) {
      setNetworkSaveError(networkProxyError)
      return
    }
    if (networkTimeoutError || parsedNetworkTimeoutSeconds === null) {
      setNetworkSaveError(networkTimeoutError ?? t('settings.general.networkTimeoutRange', {
        min: String(NETWORK_TIMEOUT_MIN_SECONDS),
        max: String(NETWORK_TIMEOUT_MAX_SECONDS),
      }))
      return
    }

    setIsSavingNetwork(true)
    setNetworkSaveError(null)
    try {
      await setNetwork({
        aiRequestTimeoutMs: parsedNetworkTimeoutSeconds * 1000,
        proxy: {
          mode: networkDraft.proxy.mode,
          url: networkProxyUrl,
        },
      })
      addToast({
        type: 'success',
        message: t('settings.general.networkSaved'),
      })
    } catch (error) {
      setNetworkSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSavingNetwork(false)
    }
  }

  const openPortableDirPicker = async () => {
    setModeError(null)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.general.storageChooseDirTitle'),
      })
      if (typeof selected === 'string') {
        setPortableDirDraft(selected)
      }
    } catch {
      setModeError(t('settings.general.storagePickerError'))
    }
  }

  const openModeSwitchConfirm = (mode: AppMode) => {
    if (isEnvironmentConfigDir) {
      setModeError(t('settings.general.storageEnvironmentSwitchBlocked'))
      return
    }

    const portableDir = portableDirDraft.trim()
    if (mode === 'portable' && !portableDir) {
      setModeError(t('settings.general.storageNoDirError'))
      return
    }

    setModeError(null)
    setPendingMode(mode)
    setPendingPortableDir(mode === 'portable' ? portableDir : null)
    setModeSwitchConfirmOpen(true)
  }

  const closeModeSwitchConfirm = () => {
    if (modeActionRunning) return
    setModeSwitchConfirmOpen(false)
    setPendingMode(null)
    setPendingPortableDir(null)
  }

  const confirmModeSwitch = async () => {
    if (!pendingMode) return

    setModeActionRunning(true)
    setModeError(null)
    try {
      await setAppModeAction(pendingMode, pendingPortableDir)
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('prepare_for_app_mode_restart')
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (error) {
      setModeError(
        error instanceof Error
          ? error.message
          : t('settings.general.storageRestartError'),
      )
      setModeSwitchConfirmOpen(false)
      setPendingMode(null)
      setPendingPortableDir(null)
      setModeActionRunning(false)
    }
  }

  const setUiZoomDraggingState = (dragging: boolean) => {
    isUiZoomDraggingRef.current = dragging
    setIsUiZoomDragging(dragging)
  }

  const commitUiZoom = (value: number) => {
    const nextZoom = Number.isFinite(value) ? value : UI_ZOOM_DEFAULT
    setUiZoomDraggingState(false)
    setUiZoomDraft(nextZoom)
    setUiZoom(nextZoom)
  }

  const uiZoomSection = (
    <div className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.uiZoom')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)]">{t('settings.general.uiZoomDescription')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
            <span>{t('settings.general.uiZoomShortcutHint')}</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">+</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">-</kbd>
              <span>/</span>
              <kbd className="settings-zoom-kbd">Ctrl</kbd>
              <kbd className="settings-zoom-kbd">0</kbd>
            </span>
            <span>{t('settings.general.uiZoomShortcutResetHint')}</span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="min-w-[48px] rounded-md bg-[var(--color-surface-container-low)] px-2 py-1 text-center text-sm font-medium text-[var(--color-text-secondary)]">
            {uiZoomPercent}%
          </span>
          <button
            type="button"
            aria-label={t('settings.general.uiZoomReset')}
            title={t('settings.general.uiZoomReset')}
            onClick={() => {
              setIsUiZoomDragging(false)
              setUiZoomDraft(UI_ZOOM_DEFAULT)
              setUiZoom(UI_ZOOM_DEFAULT)
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            100%
          </button>
        </div>
      </div>
      <div
        className={`settings-zoom-control flex items-center gap-3 ${isUiZoomDragging ? 'is-dragging' : ''}`}
        style={{ '--settings-zoom-range-progress': uiZoomRangeProgress } as CSSProperties}
      >
        <span className="w-9 text-right text-xs text-[var(--color-text-tertiary)]">{Math.round(UI_ZOOM_MIN * 100)}%</span>
        <div className="settings-zoom-range-wrap flex-1">
          <div className="settings-zoom-preview" aria-hidden="true">
            {uiZoomPercent}%
          </div>
          <input
            type="range"
            aria-label={t('settings.general.uiZoom')}
            min={UI_ZOOM_MIN}
            max={UI_ZOOM_MAX}
            step={UI_ZOOM_STEP}
            value={uiZoomDraft}
            onPointerDown={() => {
              setUiZoomDraggingState(true)
            }}
            onPointerUp={(e) => commitUiZoom(e.currentTarget.valueAsNumber)}
            onPointerCancel={() => {
              setUiZoomDraggingState(false)
              setUiZoomDraft(uiZoom)
            }}
            onChange={(e) => {
              const nextZoom = Number.isFinite(e.currentTarget.valueAsNumber)
                ? e.currentTarget.valueAsNumber
                : UI_ZOOM_DEFAULT
              setUiZoomDraft(nextZoom)
              if (!isUiZoomDraggingRef.current) {
                setUiZoom(nextZoom)
              }
            }}
            onBlur={(e) => {
              if (uiZoomDraft !== uiZoom) {
                commitUiZoom(e.currentTarget.valueAsNumber)
              } else {
                setUiZoomDraggingState(false)
              }
            }}
            className="settings-zoom-range w-full"
          />
        </div>
        <span className="w-9 text-xs text-[var(--color-text-tertiary)]">{Math.round(UI_ZOOM_MAX * 100)}%</span>
      </div>
    </div>
  )

  return (
    <div className="max-w-xl">
      {/* Appearance selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.appearanceTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.appearanceDescription')}</p>
      <div className="flex gap-2 mb-8">
        {THEMES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => void setTheme(value)}
            aria-pressed={theme === value}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              theme === value
                ? 'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] border-transparent shadow-[var(--shadow-button-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Language selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.languageTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.languageDescription')}</p>
      <div className="flex gap-2 mb-8">
        {LANGUAGES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setLocale(value)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              locale === value
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Response Language */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.responseLangTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.responseLangDescription')}</p>
      <Dropdown<string>
        items={RESPONSE_LANGUAGES}
        value={responseLanguage}
        onChange={(value) => void setResponseLanguage(value)}
        width="100%"
        maxHeight={320}
        className="mb-8 block w-full"
        trigger={
          <button
            type="button"
            aria-label={t('settings.general.responseLangTitle')}
            className="flex h-10 w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)]"
          >
            <span className="min-w-0 flex-1 truncate">{selectedResponseLanguageLabel}</span>
            <span className="material-symbols-outlined flex-shrink-0 text-[18px] text-[var(--color-text-secondary)]">expand_more</span>
          </button>
        }
      />

      {/* Effort Level */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.effortTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.effortDescription')}</p>
      <div className="flex gap-2">
        {(['low', 'medium', 'high', 'max'] as EffortLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => setEffort(level)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              effortLevel === level
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {EFFORT_LABELS[level]}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.thinkingTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.thinkingDescription')}</p>
        <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 cursor-pointer hover:border-[var(--color-border-focus)] transition-colors">
          <input
            type="checkbox"
            aria-label={t('settings.general.thinkingEnabled')}
            checked={thinkingEnabled}
            onChange={(e) => void setThinkingEnabled(e.target.checked)}
            className="peer sr-only"
          />
          <SettingsCheckboxMark checked={thinkingEnabled} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.general.thinkingEnabled')}
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-5">
              {t('settings.general.thinkingHint')}
            </div>
          </div>
        </label>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.notificationsTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.notificationsDescription')}</p>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              aria-label={t('settings.general.notificationsEnabled')}
              checked={desktopNotificationsEnabled}
              onChange={(e) => void handleDesktopNotificationsToggle(e.target.checked)}
              className="peer sr-only"
            />
            <SettingsCheckboxMark checked={desktopNotificationsEnabled} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.general.notificationsEnabled')}
              </div>
              <div className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-5">
                {desktopNotificationsEnabled
                  ? t('settings.general.notificationsHintOn')
                  : t('settings.general.notificationsHintOff')}
              </div>
            </div>
          </label>
          {desktopNotificationsEnabled && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)]/60 pt-3">
              <div className="min-w-0 text-xs text-[var(--color-text-tertiary)]">
                {t('settings.general.notificationsStatus')}: {notificationStatusLabel[notificationPermission]}
              </div>
              {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="px-3 whitespace-nowrap"
                  disabled={notificationActionRunning}
                  onClick={() => void handleNotificationPermissionAction()}
                >
                  {notificationPermission === 'denied'
                    ? t('settings.general.notificationsOpenSettings')
                    : t('settings.general.notificationsAuthorize')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {uiZoomSection}

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.networkTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.networkDescription')}</p>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-4">
          <ProxyConfigForm
            mode={networkDraft.proxy.mode}
            url={networkDraft.proxy.url}
            isDirty={networkDirty}
            isSaving={isSavingNetwork}
            error={networkSaveError}
            labels={{
              modeSystemLabel: t('settings.general.networkProxyModeSystem'),
              modeSystemDesc: t('settings.general.networkProxyModeSystemDescription'),
              modeManualLabel: t('settings.general.networkProxyModeManual'),
              modeManualDesc: t('settings.general.networkProxyModeManualDescription'),
              urlLabel: t('settings.general.networkProxyUrl'),
              urlPlaceholder: 'http://127.0.0.1:7890',
              urlHint: t('settings.general.networkProxyUrlHint'),
              urlRequiredError: t('settings.general.networkProxyUrlRequired'),
              urlInvalidError: t('settings.general.networkProxyUrlInvalid'),
              scopeHint: t('settings.general.networkScopeHint'),
              saveLabel: t('settings.general.networkSave'),
            }}
            onModeChange={(mode) => {
              setNetworkDraft((current) => ({
                ...current,
                proxy: { ...current.proxy, mode },
              }))
              setNetworkSaveError(null)
            }}
            onUrlChange={(url) => {
              setNetworkDraft((current) => ({
                ...current,
                proxy: { ...current.proxy, url },
              }))
              setNetworkSaveError(null)
            }}
            onSave={() => void saveNetworkSettings()}
          />

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="network-timeout-seconds" className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.general.networkTimeout')}
              </label>
              <span className="rounded-md bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
                {t('settings.general.networkTimeoutValue', { seconds: String(timeoutSeconds) })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-10 w-10 px-0"
                aria-label={t('settings.general.networkTimeoutDecrease')}
                onClick={() => setNetworkTimeoutSeconds((parsedNetworkTimeoutSeconds ?? timeoutSeconds) - NETWORK_TIMEOUT_STEP_SECONDS)}
              >
                -30
              </Button>
              <div className="relative min-w-0 flex-1">
                <input
                  id="network-timeout-seconds"
                  type="number"
                  min={NETWORK_TIMEOUT_MIN_SECONDS}
                  max={NETWORK_TIMEOUT_MAX_SECONDS}
                  step={1}
                  inputMode="numeric"
                  value={networkTimeoutInput}
                  aria-invalid={networkTimeoutError ? true : undefined}
                  aria-describedby="network-timeout-help"
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value
                    if (!/^\d*$/.test(nextValue)) return
                    setNetworkTimeoutInput(nextValue)
                    const seconds = Number(nextValue)
                    if (nextValue.length > 0 && seconds >= NETWORK_TIMEOUT_MIN_SECONDS && seconds <= NETWORK_TIMEOUT_MAX_SECONDS) {
                      setNetworkDraft((current) => ({
                        ...current,
                        aiRequestTimeoutMs: seconds * 1000,
                      }))
                    }
                    setNetworkSaveError(null)
                  }}
                  className={`h-10 w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3 pr-12 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] ${
                    networkTimeoutError
                      ? 'border-[var(--color-error)] focus:shadow-[var(--shadow-error-ring)]'
                      : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]'
                  }`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.general.networkTimeoutUnit')}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-10 w-10 px-0"
                aria-label={t('settings.general.networkTimeoutIncrease')}
                onClick={() => setNetworkTimeoutSeconds((parsedNetworkTimeoutSeconds ?? timeoutSeconds) + NETWORK_TIMEOUT_STEP_SECONDS)}
              >
                +30
              </Button>
            </div>
            <p
              id="network-timeout-help"
              className={`mt-2 text-xs leading-5 ${networkTimeoutError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}
            >
              {networkTimeoutError ?? t('settings.general.networkTimeoutHint')}
            </p>
          </div>

          {networkSaveError && (
            <p className="mt-2 text-[11px] leading-4 text-[var(--color-error)]">
              {networkSaveError}
            </p>
          )}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.webFetchPreflightTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.webFetchPreflightDescription')}</p>
        <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 cursor-pointer hover:border-[var(--color-border-focus)] transition-colors">
          <input
            type="checkbox"
            aria-label={t('settings.general.webFetchPreflightEnabled')}
            checked={skipWebFetchPreflight}
            onChange={(e) => void setSkipWebFetchPreflight(e.target.checked)}
            className="peer sr-only"
          />
          <SettingsCheckboxMark checked={skipWebFetchPreflight} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.general.webFetchPreflightEnabled')}
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)] mt-1 leading-5">
              {t('settings.general.webFetchPreflightHint')}
            </div>
          </div>
        </label>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.webSearchTitle')}</h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.webSearchDescription')}</p>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-4">
          <div className="grid grid-cols-5 gap-1.5 mb-4">
            {WEB_SEARCH_MODES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setWebSearchDraft({ ...webSearchDraft, mode: value })}
                className={`h-9 px-2 text-xs font-semibold rounded-lg border transition-all truncate ${
                  (webSearchDraft.mode ?? 'auto') === value
                    ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
                title={label}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3">
            <Input
              id="web-search-tavily-key"
              type="password"
              label={t('settings.general.webSearchTavilyKey')}
              value={webSearchDraft.tavilyApiKey ?? ''}
              placeholder="tvly-..."
              autoComplete="off"
              onChange={(event) =>
                setWebSearchDraft({
                  ...webSearchDraft,
                  tavilyApiKey: event.target.value,
                })
              }
            />
            <div className="-mt-1 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
              <span>{t('settings.general.webSearchTavilyFreeHint')}</span>
              <a
                href="https://app.tavily.com/home"
                target="_blank"
                rel="noreferrer"
                aria-label={t('settings.general.webSearchTavilyApiKeyLink')}
                className="font-medium text-[var(--color-brand)] hover:underline whitespace-nowrap"
              >
                {t('settings.general.webSearchGetApiKey')}
              </a>
            </div>
            <Input
              id="web-search-brave-key"
              type="password"
              label={t('settings.general.webSearchBraveKey')}
              value={webSearchDraft.braveApiKey ?? ''}
              placeholder={t('settings.general.webSearchBravePlaceholder')}
              autoComplete="off"
              onChange={(event) =>
                setWebSearchDraft({
                  ...webSearchDraft,
                  braveApiKey: event.target.value,
                })
              }
            />
            <div className="-mt-1 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
              <span>{t('settings.general.webSearchBraveFreeHint')}</span>
              <a
                href="https://api-dashboard.search.brave.com/app/keys"
                target="_blank"
                rel="noreferrer"
                aria-label={t('settings.general.webSearchBraveApiKeyLink')}
                className="font-medium text-[var(--color-brand)] hover:underline whitespace-nowrap"
              >
                {t('settings.general.webSearchGetApiKey')}
              </a>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-[var(--color-text-tertiary)] leading-5">
              {t('settings.general.webSearchHint')}
            </p>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                className="min-w-[72px] px-4 whitespace-nowrap"
                disabled={!webSearchDirty}
                onClick={() => void setWebSearch(webSearchDraft)}
              >
                {t('settings.general.webSearchSave')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {isTauriRuntime() && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-8">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.storageTitle')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.storageDescription')}</p>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-4">
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isEnvironmentConfigDir) {
                    setModeError(t('settings.general.storageEnvironmentSwitchBlocked'))
                    return
                  }
                  if (appMode.mode !== 'default') {
                    openModeSwitchConfirm('default')
                  }
                }}
                aria-pressed={appMode.mode === 'default' && !isEnvironmentConfigDir}
                className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-all ${
                  appMode.mode === 'default' && !isEnvironmentConfigDir
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface)] shadow-[var(--shadow-focus-ring)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-focus)]'
                }`}
              >
                <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-text-secondary)]">settings_applications</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.general.storageSystemTitle')}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.storageSystemDescription')}</span>
                </span>
              </button>

              <div
                className={`rounded-lg border px-3 py-3 transition-all ${
                  appMode.mode === 'portable' && !isEnvironmentConfigDir
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface)] shadow-[var(--shadow-focus-ring)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                }`}
              >
                <div className="mb-3 flex items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-text-secondary)]">drive_file_move</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.general.storagePortableTitle')}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.general.storagePortableDescription')}</div>
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      id="portable-data-dir"
                      label={t('settings.general.storagePortableDirLabel')}
                      value={portableDirDraft}
                      placeholder={t('settings.general.storagePortableDirPlaceholder')}
                      onChange={(event) => {
                        setPortableDirDraft(event.target.value)
                        setModeError(null)
                      }}
                      className="w-full font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 flex-shrink-0 px-3 whitespace-nowrap"
                    onClick={() => void openPortableDirPicker()}
                  >
                    {t('settings.general.storageChooseDir')}
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--color-brand)] hover:underline"
                    onClick={() => {
                      setPortableDirDraft(appMode.defaultPortableDir ?? '')
                      setModeError(null)
                    }}
                  >
                    {t('settings.general.storageUseDefaultPortableDir')}
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={modeActionRunning || (appMode.mode === 'portable' && portableDirDraft.trim() === (appMode.portableDir ?? ''))}
                    onClick={() => openModeSwitchConfirm('portable')}
                  >
                    {t('settings.general.storageApplyPortable')}
                  </Button>
                </div>
              </div>
            </div>

            {activeConfigDir && (
              <div className="mt-3 rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{t('settings.general.storageActiveDir')}</div>
                <div className="mt-1 break-all font-mono text-xs text-[var(--color-text-secondary)]">{activeConfigDir}</div>
              </div>
            )}

            {isEnvironmentConfigDir && (
              <div className="mt-3 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                {t('settings.general.storageEnvironmentHint')}
              </div>
            )}

            {appModeRequiresRestart && (
              <div className="mt-3 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                {t('settings.general.storageRestartHint')}
              </div>
            )}

            <div className="mt-3 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t('settings.general.storageMoveHint')}
            </div>

            {modeError && (
              <div className="mt-3 text-xs text-[var(--color-error)]">
                {modeError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm dialog for mode switch */}
      <ConfirmDialog
        open={modeSwitchConfirmOpen}
        onClose={closeModeSwitchConfirm}
        onConfirm={() => void confirmModeSwitch()}
        title={t('settings.general.modeSwitchTitle')}
        body={(
          <div className="space-y-3 text-sm leading-6 text-[var(--color-text-secondary)]">
            <p>
              {pendingMode === 'portable'
                ? t('settings.general.storageSwitchPortableBody')
                : t('settings.general.storageSwitchDefaultBody')}
            </p>
            {pendingMode === 'portable' && pendingPortableDir && (
              <div className="rounded-lg bg-[var(--color-surface-container-low)] px-3 py-2 font-mono text-xs break-all text-[var(--color-text-secondary)]">
                {pendingPortableDir}
              </div>
            )}
            <p>{t('settings.general.storageSwitchRestartBody')}</p>
          </div>
        )}
        confirmLabel={t('settings.general.modeSwitchConfirm')}
        cancelLabel={t('common.cancel')}
        confirmVariant="primary"
        loading={modeActionRunning}
      />
    </div>
  )
}
