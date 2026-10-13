import { useEffect, useState } from 'react'
import { terminalApi, type TerminalShellDetection } from '../../api/terminal'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Dropdown } from '../shared/Dropdown'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import type { DesktopTerminalStartupShell } from '../../types/settings'

export function TerminalShellSettings() {
  if (!terminalApi.isAvailable()) return null
  return <DesktopTerminalShellSettings />
}

function DesktopTerminalShellSettings() {
  const t = useTranslation()
  const desktopTerminal = useSettingsStore((state) => state.desktopTerminal)
  const setDesktopTerminal = useSettingsStore((state) => state.setDesktopTerminal)
  const [startupShell, setStartupShell] = useState<DesktopTerminalStartupShell>(desktopTerminal?.startupShell ?? 'system')
  const [customShellPath, setCustomShellPath] = useState(desktopTerminal?.customShellPath ?? '')
  const [preferencesError, setPreferencesError] = useState<string | null>(null)
  const [preferencesSaved, setPreferencesSaved] = useState(false)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const [detection, setDetection] = useState<TerminalShellDetection | null>(null)
  const [detectionError, setDetectionError] = useState<string | null>(null)
  const isWindows = detection?.platform === 'windows'
  useEffect(() => {
    let cancelled = false
    void terminalApi.detectDefaultShell().then((result) => {
      if (cancelled) return
      setDetection(result)
    }).catch((error) => {
      if (!cancelled) setDetectionError(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [])

  const shellItems = [
    { value: 'system' as const, label: t('settings.terminal.shell.system'), description: detection?.shell ?? t('settings.terminal.shell.systemDesc') },
    ...(isWindows ? [
      { value: 'pwsh' as const, label: t('settings.terminal.shell.pwsh'), description: t('settings.terminal.shell.pwshDesc') },
      { value: 'powershell' as const, label: t('settings.terminal.shell.powershell'), description: t('settings.terminal.shell.powershellDesc') },
      { value: 'cmd' as const, label: t('settings.terminal.shell.cmd'), description: t('settings.terminal.shell.cmdDesc') },
    ] : [
      { value: 'zsh' as const, label: 'zsh' },
      { value: 'bash' as const, label: 'bash' },
      { value: 'fish' as const, label: 'fish' },
    ]),
    { value: 'custom' as const, label: t('settings.terminal.shell.custom'), description: t('settings.terminal.shell.customDesc') },
  ]

  useEffect(() => {
    setStartupShell(desktopTerminal?.startupShell ?? 'system')
    setCustomShellPath(desktopTerminal?.customShellPath ?? '')
  }, [desktopTerminal])

  useEffect(() => {
    if (!preferencesSaved) return
    const timer = window.setTimeout(() => setPreferencesSaved(false), 2500)
    return () => window.clearTimeout(timer)
  }, [preferencesSaved])

  const savePreferences = async () => {
    setPreferencesError(null)
    setPreferencesSaved(false)

    const trimmedPath = customShellPath.trim()
    if (startupShell === 'custom') {
      if (!trimmedPath) {
        setPreferencesError(t('settings.terminal.customPathRequired'))
        return
      }
      if (!(isWindows ? /^[A-Za-z]:[\\/]/.test(trimmedPath) : trimmedPath.startsWith('/'))) {
        setPreferencesError(t('settings.terminal.customPathAbsolute'))
        return
      }
    }

    setPreferencesSaving(true)
    try {
      await setDesktopTerminal({
        startupShell,
        customShellPath: trimmedPath,
      })
      setPreferencesSaved(true)
    } catch (err) {
      setPreferencesError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreferencesSaving(false)
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-4">
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('settings.general.defaultShell')}
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {t('settings.terminal.preferencesBody')}
          </p>
        </div>

        {!detection ? (
          <p role={detectionError ? 'alert' : 'status'} className="text-sm text-[var(--color-text-secondary)]">
            {detectionError ?? t('settings.terminal.detectingShell')}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Dropdown<DesktopTerminalStartupShell>
                items={shellItems}
                value={startupShell}
                onChange={(value) => {
                  setStartupShell(value)
                  setPreferencesError(null)
                  setPreferencesSaved(false)
                }}
                width="100%"
                trigger={
                  <button
                    type="button"
                    aria-label={t('settings.general.defaultShell')}
                    className="flex h-10 w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)]"
                  >
                    <span>{shellItems.find((item) => item.value === startupShell)?.label ?? startupShell}</span>
                    <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">expand_more</span>
                  </button>
                }
              />
            </div>

            {startupShell === 'custom' && (
              <Input
                label={t('settings.terminal.customPath')}
                placeholder={isWindows ? t('settings.terminal.customPathPlaceholder') : '/usr/local/bin/fish'}
                value={customShellPath}
                onChange={(event) => {
                  setCustomShellPath(event.target.value)
                  setPreferencesError(null)
                  setPreferencesSaved(false)
                }}
                error={preferencesError ?? undefined}
              />
            )}

            {preferencesError && startupShell !== 'custom' && (
              <p className="text-xs text-[var(--color-error)]">{preferencesError}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                loading={preferencesSaving}
                onClick={() => void savePreferences()}
              >
                {t('settings.terminal.saveShell')}
              </Button>
              {preferencesSaved && (
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {t('settings.terminal.saveShellSuccess')}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
