import { Input } from '../shared/ui/input'
import { Button } from '../shared/ui/button'
import { FolderOpenIcon } from 'lucide-react'
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
    <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
      <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('settings.terminal.bashPathLabel')}
      </label>
      <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">
        {t('settings.terminal.bashPathDescription')}
      </p>
      <div className="flex gap-2">
        <Input
          aria-label={t('settings.terminal.bashPathLabel')}
          aria-invalid={invalid}
          type="text"
          value={bashPath || ''}
          disabled={saving}
          onChange={(e) => { setBashPathDraft(e.target.value); setInvalid(false); setSaved(false); setSaveError(null) }}
          placeholder={t('settings.terminal.bashPathLabel')}
          className="min-w-0 flex-1 font-mono"
        />
        <Button variant="outline"
          type="button"
          onClick={handleBrowse}
          aria-label={t('settings.terminal.bashPathBrowse')}
          disabled={saving}
        >
          <FolderOpenIcon aria-hidden="true" size={16} />
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
        >
          {saved ? t('settings.terminal.bashPathSaved') : t('settings.terminal.bashPathSave')}
        </Button>
        <Button variant="outline"
          type="button"
          onClick={handleReset}
          disabled={saving || bashPath === null}
        >
          {t('settings.terminal.bashPathReset')}
        </Button>
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
