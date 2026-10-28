import { useState } from 'react'
import { writeSessionExport, pickExportPath } from '../../lib/shell'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/ui/button'
import { Checkbox } from '../shared/ui/checkbox'
import { SegmentedControl } from '../shared/SegmentedControl'
import { sessionsApi, type SessionExport, type SessionExportOptions } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { useUIStore } from '../../stores/uiStore'

type Format = SessionExportOptions['format']

/**
 * Saves a rendered export. The desktop app writes it to the path the user picks
 * in the native dialog; a browser (H5) downloads it.
 */
async function saveExport(file: SessionExport): Promise<boolean> {
  if (isDesktopRuntime()) {
    const markdown = file.format === 'markdown'
    const path = await pickExportPath({
      defaultPath: file.fileName,
      filters: [markdown ? { name: 'Markdown', extensions: ['md'] } : { name: 'JSON', extensions: ['json'] }],
    })
    if (!path) return false
    await writeSessionExport({ path, contents: file.content })
    return true
  }
  const blob = new Blob([file.content], { type: file.format === 'json' ? 'application/json' : 'text/markdown' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = file.fileName
  link.click()
  URL.revokeObjectURL(href)
  return true
}

/** "Export…" in the session header menu (#133). */
export function ExportSessionDialog({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [format, setFormat] = useState<Format>('markdown')
  const [includeThinking, setIncludeThinking] = useState(false)
  const [fullToolOutput, setFullToolOutput] = useState(false)
  const [redact, setRedact] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const markdown = format === 'markdown'

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const file = await sessionsApi.exportSession(sessionId, { format, includeThinking, fullToolOutput, redact })
      if (await saveExport(file)) {
        addToast({ type: 'success', message: t('exportSession.saved') })
        onClose()
      }
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : t('exportSession.failed'),
      })
    } finally {
      setIsSaving(false)
    }
  }

  const option = (checked: boolean, onChange: (value: boolean) => void, label: string, disabled = false) => (
    <label className={`flex items-center gap-2 text-ui-body ${disabled ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)]'}`}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('exportSession.title')}
      width={440}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="xs" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="xs" disabled={isSaving} onClick={() => void handleSave()}>
            {t('exportSession.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="export-session-dialog">
        <SegmentedControl<Format>
          label={t('exportSession.format')}
          options={[
            { value: 'markdown', label: 'Markdown' },
            { value: 'json', label: 'JSON' },
          ]}
          value={format}
          onChange={setFormat}
        />
        <div className="space-y-2">
          {option(includeThinking, setIncludeThinking, t('exportSession.includeThinking'), !markdown)}
          {option(fullToolOutput, setFullToolOutput, t('exportSession.fullToolOutput'), !markdown)}
          {option(redact, setRedact, t('exportSession.redact'))}
        </div>
        <p className="text-ui-aux text-[var(--color-text-tertiary)]">
          {markdown ? t('exportSession.privacyNote') : t('exportSession.jsonNote')}
        </p>
      </div>
    </Modal>
  )
}
