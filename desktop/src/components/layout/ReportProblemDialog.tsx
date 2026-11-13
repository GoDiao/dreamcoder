import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/ui/button'
import { diagnosticsApi, type ProblemReport } from '../../api/diagnostics'
import { useCopyAndNotify } from '../../hooks/useCopyAndNotify'
import { useTranslation } from '../../i18n'
import { buildBugReportUrl, buildProblemReportText } from '../../lib/problemReport'
import { openExternalUrl } from '../../lib/externalUrl'
import { useUIStore } from '../../stores/uiStore'

/** "Report a problem" (#132): nothing leaves the machine until the user copies or opens. */
export function ReportProblemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const copyAndNotify = useCopyAndNotify()
  const [report, setReport] = useState<ProblemReport | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setReport(null)
    setLoadError(false)
    diagnosticsApi.getProblemReport()
      .then((next) => {
        if (!cancelled) setReport(next)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const text = useMemo(() => (report ? buildProblemReportText(report) : ''), [report])

  const handleCopy = () => copyAndNotify(text, t('reportProblem.copied'))

  const handleOpenIssue = () => {
    if (report) openExternalUrl(buildBugReportUrl(report))
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const { bundle } = await diagnosticsApi.exportBundle()
      addToast({ type: 'success', message: t('settings.diagnostics.exported', { file: bundle.fileName }) })
      await diagnosticsApi.revealExport(bundle.fileName).catch(() => undefined)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.diagnostics.exportFailed'),
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('reportProblem.title')}
      width={560}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" disabled={isExporting} onClick={() => void handleExport()}>
            {t('reportProblem.exportBundle')}
          </Button>
          <Button size="sm" variant="outline" disabled={!report} onClick={() => void handleCopy()}>
            {t('reportProblem.copy')}
          </Button>
          <Button size="sm" disabled={!report} onClick={handleOpenIssue}>
            {t('reportProblem.openIssue')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3" data-testid="report-problem-dialog">
        <p className="text-sm text-muted-foreground">{t('reportProblem.description')}</p>
        {loadError ? (
          <p className="text-sm text-destructive">{t('reportProblem.loadFailed')}</p>
        ) : (
          <pre
            aria-label={t('reportProblem.previewLabel')}
            className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs leading-normal text-foreground"
          >
            {report ? text : t('reportProblem.loading')}
          </pre>
        )}
        <p className="text-xs text-subtle-foreground">{t('reportProblem.privacyNote')}</p>
      </div>
    </Modal>
  )
}
