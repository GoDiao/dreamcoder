import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { terminalApi } from '../../api/terminal'
import { pickFile } from '../../lib/shell'
import { useSettingsStore } from '../../stores/settingsStore'

export function BashPathSettings() {
  const t = useTranslation()
  const storedBashPath = useSettingsStore((state) => state.desktopTerminal.bashPath)
  const setDesktopTerminal = useSettingsStore((state) => state.setDesktopTerminal)
  const [bashPathDraft, setBashPathDraft] = useState<string | undefined>(undefined)
  const bashPath = bashPathDraft === undefined ? storedBashPath : bashPathDraft
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    const trimmed = bashPath?.trim() || null
    setSaving(true)
    setInvalid(false)
    setSaveError(null)
    setSaved(false)
    try {
      try {
        await terminalApi.validateBashPath(trimmed)
      } catch {
        setInvalid(true)
        return
      }
      await setDesktopTerminal({ bashPath: trimmed })
      setBashPathDraft(undefined)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('[terminal] Failed to save Bash path', error)
      setSaveError(t('settings.terminal.bashPathSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    setSaved(false)
    setInvalid(false)
    setSaveError(null)
    try {
      await setDesktopTerminal({ bashPath: null })
      setBashPathDraft(undefined)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('[terminal] Failed to reset Bash path', error)
      setSaveError(t('settings.terminal.bashPathSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleBrowse = async () => {
    try {
      const selected = await pickFile({
        title: t('settings.terminal.bashPathLabel'),
        multiple: false,
        filters: [{
          name: 'Bash Executable',
          extensions: ['exe', '', 'bat', 'cmd', 'ps1'],
        }],
      })
      if (selected && typeof selected === 'string') {
        setBashPathDraft(selected)
        setInvalid(false)
      }
    } catch {
    }
  }

  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
      <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('settings.terminal.bashPathLabel')}
      </label>
      <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">
        {t('settings.terminal.bashPathDescription')}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={bashPath || ''}
          disabled={saving}
          onChange={(e) => { setBashPathDraft(e.target.value); setInvalid(false); setSaved(false); setSaveError(null) }}
          placeholder={t('settings.terminal.bashPathLabel')}
          className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-mono text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
        />
        <button
          type="button"
          onClick={handleBrowse}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <span className="material-symbols-outlined text-[16px]">folder_open</span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] px-3 text-xs font-medium text-[var(--color-surface)] transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {saved ? t('settings.terminal.bashPathSaved') : t('settings.terminal.bashPathSave')}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving || bashPath === null}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {t('settings.terminal.bashPathReset')}
        </button>
      </div>
      {saveError && (
        <p role="alert" className="mt-1.5 text-xs text-[var(--color-error)]">{saveError}</p>
      )}
      {invalid && (
        <p className="mt-1.5 text-xs text-[var(--color-error)]">
          {t('settings.terminal.bashPathInvalid')}
        </p>
      )}
    </div>
  )
}
