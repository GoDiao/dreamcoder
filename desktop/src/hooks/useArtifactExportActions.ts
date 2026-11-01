import { toast } from 'sonner'
import { useTranslation, type TranslationKey } from '../i18n'
import { describeExportResult, exportArtifactPage, exportDialogMessages } from '../lib/artifactExport'
import { errorMessage } from '../lib/errorMessage'
import { BROWSER_EXPORT_FORMATS, type BrowserExportFormat } from '../lib/shell/electronBridge'
import type { MenuAction } from '../components/shared/ActionMenu'

const FORMAT_LABELS: Record<BrowserExportFormat, TranslationKey> = {
  pdf: 'artifactExport.pdf',
  png: 'artifactExport.png',
  html: 'artifactExport.html',
}

export function useArtifactExportActions(input: { tabId: string; sessionId: string | null; title: string }): MenuAction[] {
  const t = useTranslation()
  const run = (format: BrowserExportFormat) => {
    exportArtifactPage({ ...input, format, messages: exportDialogMessages(t) })
      .then((result) => {
        const described = describeExportResult(t, result)
        if (described?.kind === 'success') toast.success(described.message)
        else if (described) toast.error(described.message)
      })
      .catch((error: unknown) => {
        toast.error(t('artifactExport.failed', { message: errorMessage(error) }))
      })
  }
  return BROWSER_EXPORT_FORMATS.map((format) => ({
    id: `export-${format}`,
    label: t(FORMAT_LABELS[format]),
    onSelect: () => run(format),
  }))
}
