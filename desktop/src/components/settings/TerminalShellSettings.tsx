import { useEffect, useState } from 'react'
import { terminalApi, type TerminalShellDetection } from '../../api/terminal'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { SettingsSelect } from './SettingsSelect'
import { SettingsRow } from './SettingsRow'
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
    <div>
      {!detection ? (
        <p role={detectionError ? 'alert' : 'status'} className="py-2.5 text-xs text-[var(--color-text-secondary)]">
          {detectionError ?? t('settings.terminal.detectingShell')}
        </p>
      ) : (
        <>
          <SettingsRow
            title={t('settings.terminal.startupShell')}
            description={t('settings.terminal.preferencesBody')}
            control={
              <SettingsSelect<DesktopTerminalStartupShell>
                label={t('settings.general.defaultShell')}
                options={shellItems}
                value={startupShell}
                menuWidth={280}
                onChange={(value) => {
                  setStartupShell(value)
                  setPreferencesError(null)
                  setPreferencesSaved(false)
                }}
              />
            }
          />

          {startupShell === 'custom' && (
            <div className="mt-2">
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
            </div>
          )}

          {preferencesError && startupShell !== 'custom' && (
            <p className="mt-2 text-xs text-[var(--color-error)]">{preferencesError}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            {preferencesSaved && (
              <span className="text-xs text-[var(--color-text-secondary)]">
                {t('settings.terminal.saveShellSuccess')}
              </span>
            )}
            <Button
              type="button"
              size="xs"
              loading={preferencesSaving}
              onClick={() => void savePreferences()}
            >
              {t('settings.terminal.saveShell')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
