import { useState, useEffect } from 'react'
import { prepareAppModeRestart, relaunchApp, pickDirectory } from '../../lib/shell'
import { DEFAULT_AUTO_COMPACT_PERCENT, useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { Switch } from '../shared/Switch'
import { SegmentedControl } from '../shared/SegmentedControl'
import { SettingsGroup, SettingsRow } from './SettingsRow'
import { SettingsSelect } from './SettingsSelect'
import { SettingsDisclosureRow } from './SettingsDisclosureRow'
import { terminalApi } from '../../api/terminal'
import type { EffortLevel, ThemeMode, WebSearchMode, AppMode } from '../../types/settings'
import type { Locale } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { isValidHttpProxyUrl } from '../../lib/validation'
import { TerminalShellSettings } from './TerminalShellSettings'
import { ProxyConfigForm } from './ProxyConfigForm'
import { ClaudeCodeImportSettings } from './ClaudeCodeImportSettings'
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

const AUTO_COMPACT_PERCENTS = [50, 60, 70, 80, 90, 95]

export function GeneralSettings() {
  const {
    effortLevel,
    setEffort,
    thinkingEnabled,
    setThinkingEnabled,
    autoCompactPercent,
    setAutoCompactPercent,
    locale,
    setLocale,
    theme,
    setTheme,
    skipWebFetchPreflight,
    setSkipWebFetchPreflight,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    agentTeamsEnabled,
    setAgentTeamsEnabled,
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
    desktopTerminal,
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
  const [storageChoice, setStorageChoice] = useState<AppMode>(appMode.mode)
  const addToast = useUIStore((s) => s.addToast)
  const webSearchDirty = JSON.stringify(webSearchDraft) !== JSON.stringify(webSearch)
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
    setStorageChoice(appMode.mode)
  }, [appMode.mode])

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
    if (!isDesktopRuntime()) return
    void fetchAppMode()
  }, [fetchAppMode])

  useEffect(() => {
    setPortableDirDraft(appMode.portableDir ?? appMode.defaultPortableDir ?? '')
  }, [appMode.defaultPortableDir, appMode.portableDir])

  const AUTO_COMPACT_OPTIONS = [...new Set([...AUTO_COMPACT_PERCENTS, autoCompactPercent])].sort((a, b) => a - b).map((percent) => ({
    value: String(percent),
    label: percent === DEFAULT_AUTO_COMPACT_PERCENT
      ? t('settings.general.autoCompactDefaultOption', { percent })
      : `${percent}%`,
  }))
  const EFFORT_OPTIONS: Array<{ value: EffortLevel; label: string }> = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' },
  ]

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

  const THEMES: Array<{ value: ThemeMode; label: string }> = [
    { value: 'white', label: t('settings.general.appearance.white') },
    { value: 'light', label: t('settings.general.appearance.light') },
    { value: 'dark', label: t('settings.general.appearance.dark') },
    { value: 'midnight', label: t('settings.general.appearance.midnight') },
    { value: 'dreamfield', label: t('settings.general.appearance.dreamfield') },
    { value: 'amber', label: t('settings.general.appearance.amber') },
    { value: 'aurora', label: t('settings.general.appearance.aurora') },
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
    unknown: t('settings.general.notificationsStatusUnknown'),
  }
  const notificationSettingsOnly = notificationPermission === 'denied' || notificationPermission === 'unknown'

  const handleDesktopNotificationsToggle = async (enabled: boolean) => {
    await setDesktopNotificationsEnabled(enabled)
    if (!enabled) return

    setNotificationActionRunning(true)
    try {
      const permission = await requestDesktopNotificationPermission()
      setNotificationPermission(permission)
      if (permission === 'granted' || permission === 'unknown') {
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
      if (notificationSettingsOnly) {
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
      const selected = await pickDirectory({
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
      await prepareAppModeRestart()
      await relaunchApp()
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

  const proxyModeLabel = (mode: 'system' | 'manual') =>
    mode === 'manual' ? t('settings.general.networkProxyModeManual') : t('settings.general.networkProxyModeSystem')
  const webSearchModeLabel = (mode: WebSearchMode | undefined) =>
    WEB_SEARCH_MODES.find((item) => item.value === (mode ?? 'auto'))?.label ?? WEB_SEARCH_MODES[0]!.label
  const shellSummary = (() => {
    const shell = desktopTerminal?.startupShell ?? 'system'
    if (shell === 'system') return t('settings.terminal.shell.system')
    if (shell === 'custom') return t('settings.terminal.shell.custom')
    if (shell === 'pwsh' || shell === 'powershell' || shell === 'cmd') return t(`settings.terminal.shell.${shell}`)
    return shell
  })()
  const storageSummary = isEnvironmentConfigDir
    ? 'DREAMCODER_CONFIG_DIR'
    : appMode.mode === 'portable'
      ? t('settings.general.storagePortableShort')
      : t('settings.general.storageSystemShort')
  const storageApplyDisabled =
    modeActionRunning ||
    (storageChoice === appMode.mode &&
      (storageChoice === 'default' || portableDirDraft.trim() === (appMode.portableDir ?? '')))
  const showShellRow = isDesktopRuntime() && terminalApi.isAvailable()

  return (
    <div>
      <SettingsGroup title={t('settings.general.groupAppearance')}>
        <SettingsRow
          title={t('settings.general.colorTheme')}
          control={
            <SettingsSelect<ThemeMode>
              label={t('settings.general.colorTheme')}
              options={THEMES}
              value={theme}
              onChange={(value) => void setTheme(value)}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.general.groupLanguageModel')}>
        <SettingsRow
          title={t('settings.general.interfaceLanguage')}
          control={
            <SettingsSelect<Locale>
              label={t('settings.general.interfaceLanguage')}
              options={LANGUAGES}
              value={locale}
              onChange={(value) => setLocale(value)}
            />
          }
        />
        <SettingsRow
          title={t('settings.general.responseLangTitle')}
          description={t('settings.general.responseLangDescription')}
          control={
            <SettingsSelect<string>
              label={t('settings.general.responseLangTitle')}
              options={RESPONSE_LANGUAGES}
              value={responseLanguage}
              onChange={(value) => void setResponseLanguage(value)}
            />
          }
        />
        <SettingsRow
          title={t('settings.general.effortTitle')}
          description={t('settings.general.effortDescription')}
          control={
            <SegmentedControl<EffortLevel>
              label={t('settings.general.effortTitle')}
              options={EFFORT_OPTIONS}
              value={effortLevel}
              onChange={(level) => setEffort(level)}
            />
          }
        />
        <SettingsRow
          title={t('settings.general.thinkingTitle')}
          description={t('settings.general.thinkingDescription')}
          control={
            <Switch
              label={t('settings.general.thinkingEnabled')}
              checked={thinkingEnabled}
              onChange={(checked) => void setThinkingEnabled(checked)}
            />
          }
        />
        <SettingsRow
          title={t('settings.general.autoCompactTitle')}
          description={t('settings.general.autoCompactDescription')}
          control={
            <SettingsSelect<string>
              label={t('settings.general.autoCompactTitle')}
              options={AUTO_COMPACT_OPTIONS}
              value={String(autoCompactPercent)}
              onChange={(value) => void setAutoCompactPercent(Number(value))}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.general.groupNotifications')}>
        <SettingsRow
          title={t('settings.general.notificationsTitle')}
          description={t('settings.general.notificationsDescription')}
          control={
            <Switch
              label={t('settings.general.notificationsEnabled')}
              checked={desktopNotificationsEnabled}
              onChange={(checked) => void handleDesktopNotificationsToggle(checked)}
            />
          }
        />
        {desktopNotificationsEnabled && (
          <SettingsRow
            title={t('settings.general.notificationsPermission')}
            description={`${t('settings.general.notificationsStatus')}: ${notificationStatusLabel[notificationPermission]}`}
            control={
              notificationPermission !== 'granted' && notificationPermission !== 'unsupported' ? (
                <Button
                  size="xs"
                  variant="secondary"
                  className="whitespace-nowrap"
                  disabled={notificationActionRunning}
                  onClick={() => void handleNotificationPermissionAction()}
                >
                  {notificationSettingsOnly
                    ? t('settings.general.notificationsOpenSettings')
                    : t('settings.general.notificationsAuthorize')}
                </Button>
              ) : null
            }
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t('settings.general.groupExperimental')}>
        <SettingsRow
          title={t('settings.general.agentTeamsTitle')}
          description={t('settings.general.agentTeamsDescription')}
          control={
            <Switch
              label={t('settings.general.agentTeamsTitle')}
              checked={agentTeamsEnabled}
              onChange={(checked) => void setAgentTeamsEnabled(checked)}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.general.groupAdvanced')}>
        <SettingsDisclosureRow title={t('settings.general.networkTitle')} summary={proxyModeLabel(network.proxy.mode)}>
          <ProxyConfigForm
            mode={networkDraft.proxy.mode}
            url={networkDraft.proxy.url}
            isDirty={networkDirty}
            isSaving={isSavingNetwork}
            error={networkSaveError}
            labels={{
              modeTitle: t('settings.general.networkProxy'),
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
          >
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="network-timeout-seconds" className="text-xs text-[var(--color-text-secondary)]">
                  {t('settings.general.networkTimeout')}
                </label>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.general.networkTimeoutValue', { seconds: String(timeoutSeconds) })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  className="w-12 px-0"
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
                    className={`h-9 w-full rounded-[var(--radius-md)] border bg-[var(--color-surface-container-lowest)] px-3 pr-12 text-[13px] text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--color-text-tertiary)] ${
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
                  size="xs"
                  variant="secondary"
                  className="w-12 px-0"
                  aria-label={t('settings.general.networkTimeoutIncrease')}
                  onClick={() => setNetworkTimeoutSeconds((parsedNetworkTimeoutSeconds ?? timeoutSeconds) + NETWORK_TIMEOUT_STEP_SECONDS)}
                >
                  +30
                </Button>
              </div>
              <p
                id="network-timeout-help"
                className={`mt-1.5 text-xs leading-[1.5] ${networkTimeoutError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}
              >
                {networkTimeoutError ?? t('settings.general.networkTimeoutHint')}
              </p>
            </div>
          </ProxyConfigForm>
        </SettingsDisclosureRow>

        <SettingsDisclosureRow title={t('settings.general.webSearchFetchTitle')} summary={webSearchModeLabel(webSearch.mode)}>
          <SettingsRow
            title={t('settings.general.webSearchMode')}
            description={t('settings.general.webSearchHint')}
            control={
              <SettingsSelect<WebSearchMode>
                label={t('settings.general.webSearchMode')}
                options={WEB_SEARCH_MODES}
                value={webSearchDraft.mode ?? 'auto'}
                onChange={(mode) => setWebSearchDraft({ ...webSearchDraft, mode })}
              />
            }
          />
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div>
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
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
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
            </div>
            <div>
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
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
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
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              size="xs"
              variant="secondary"
              className="whitespace-nowrap"
              disabled={!webSearchDirty}
              onClick={() => void setWebSearch(webSearchDraft)}
            >
              {t('settings.general.webSearchSave')}
            </Button>
          </div>
          <SettingsRow
            className="mt-2 border-t border-[var(--color-border-separator)]"
            title={t('settings.general.webFetchPreflightEnabled')}
            description={t('settings.general.webFetchPreflightDescription')}
            control={
              <Switch
                label={t('settings.general.webFetchPreflightEnabled')}
                checked={skipWebFetchPreflight}
                onChange={(checked) => void setSkipWebFetchPreflight(checked)}
              />
            }
          />
        </SettingsDisclosureRow>

        {showShellRow && (
          <SettingsDisclosureRow title={t('settings.general.defaultShell')} summary={shellSummary}>
            <TerminalShellSettings />
          </SettingsDisclosureRow>
        )}

        {isDesktopRuntime() && (
          <SettingsDisclosureRow title={t('settings.general.storageTitle')} summary={storageSummary}>
            <SettingsRow
              title={t('settings.general.storageMode')}
              description={
                storageChoice === 'portable'
                  ? t('settings.general.storagePortableDescription')
                  : t('settings.general.storageSystemDescription')
              }
              control={
                <SettingsSelect<AppMode>
                  label={t('settings.general.storageMode')}
                  options={[
                    { value: 'default', label: t('settings.general.storageSystemShort') },
                    { value: 'portable', label: t('settings.general.storagePortableShort') },
                  ]}
                  value={storageChoice}
                  onChange={(mode) => {
                    setStorageChoice(mode)
                    setModeError(null)
                  }}
                />
              }
            />

            {storageChoice === 'portable' && (
              <div className="mt-3">
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
                    size="xs"
                    variant="secondary"
                    className="mb-1 flex-shrink-0 whitespace-nowrap"
                    onClick={() => void openPortableDirPicker()}
                  >
                    {t('settings.general.storageChooseDir')}
                  </Button>
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-[var(--color-brand)] hover:underline"
                  onClick={() => {
                    setPortableDirDraft(appMode.defaultPortableDir ?? '')
                    setModeError(null)
                  }}
                >
                  {t('settings.general.storageUseDefaultPortableDir')}
                </button>
              </div>
            )}

            <div className="mt-4 border-l-2 border-[var(--color-border)] py-1 pl-3 text-xs leading-[1.7] text-[var(--color-text-secondary)]">
              {activeConfigDir && (
                <div>
                  {t('settings.general.storageActiveDir')}: <span className="break-all font-mono">{activeConfigDir}</span>
                </div>
              )}
              <div>{t('settings.general.storageMoveHint')}</div>
            </div>

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

            {modeError && (
              <div className="mt-3 text-xs text-[var(--color-error)]" role="alert">
                {modeError}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                size="xs"
                variant="secondary"
                disabled={storageApplyDisabled}
                onClick={() => openModeSwitchConfirm(storageChoice)}
              >
                {storageChoice === 'portable'
                  ? t('settings.general.storageApplyPortable')
                  : t('settings.general.storageApply')}
              </Button>
            </div>
          </SettingsDisclosureRow>
        )}

        {isDesktopRuntime() && <ClaudeCodeImportSettings />}
      </SettingsGroup>

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
