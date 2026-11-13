import { Stethoscope } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../shared/ui/button'
import { useTranslation } from '../../i18n'
import { runLocalDoctorRepair, type LocalDoctorRepairResult } from '../../lib/doctorRepair'
import { useUIStore } from '../../stores/uiStore'

type DoctorPanelProps = {
  compact?: boolean
}

export function DoctorPanel({ compact = false }: DoctorPanelProps) {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [result, setResult] = useState<LocalDoctorRepairResult | null>(null)

  const handleRunDoctor = () => {
    const nextResult = runLocalDoctorRepair()
    setResult(nextResult)
    addToast({
      type: nextResult.failedKeys.length === 0 ? 'success' : 'warning',
      message: getDoctorToastMessage(t, nextResult),
    })
  }

  const statusText = result ? getDoctorStatusMessage(t, result) : null

  return (
    <section className={`rounded-lg border border-border bg-background ${compact ? 'p-3' : 'p-4'} `}>
      <div className={`flex ${compact ? 'flex-col gap-3' : 'items-start justify-between gap-4'}`}>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{t('settings.diagnostics.doctorTitle')}</div>
          <p className="mt-1 text-xs text-subtle-foreground">
            {t('settings.diagnostics.doctorDescription')}
          </p>
          <p className="mt-1 text-xs text-subtle-foreground">
            {t('settings.diagnostics.doctorProtectedData')}
          </p>
        </div>
        <div className={`flex ${compact ? 'justify-start' : 'justify-end'} shrink-0`}>
          <Button
            size="sm"
            onClick={handleRunDoctor}
          >
            <Stethoscope data-icon="inline-start" className="h-4 w-4" aria-hidden="true" />
            {t('settings.diagnostics.runDoctor')}
          </Button>
        </div>
      </div>

      <div className="mt-2 text-2xs leading-relaxed text-subtle-foreground">
        {t('settings.diagnostics.doctorSafeKeys')}
      </div>

      {statusText ? (
        <div className="mt-2 rounded-md border border-border bg-muted px-2.5 py-2 text-xs text-muted-foreground">
          {statusText}
        </div>
      ) : null}
    </section>
  )
}

function getDoctorToastMessage(
  t: ReturnType<typeof useTranslation>,
  result: LocalDoctorRepairResult,
): string {
  if (result.failedKeys.length > 0) {
    return t('settings.diagnostics.doctorPartial', { count: String(result.failedKeys.length) })
  }
  return t('settings.diagnostics.doctorCompleted')
}

function getDoctorStatusMessage(
  t: ReturnType<typeof useTranslation>,
  result: LocalDoctorRepairResult,
): string {
  const base = t('settings.diagnostics.doctorResultLocal', { count: String(result.removedKeys.length) })

  if (result.failedKeys.length > 0) {
    return `${base} ${t('settings.diagnostics.doctorResultFailedKeys', { count: String(result.failedKeys.length) })}`
  }

  return base
}
