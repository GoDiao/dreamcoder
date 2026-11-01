import { designApi } from '../../api/design'
import { useStandaloneBrowserPage } from '../../hooks/useStandaloneBrowserPage'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/ui/button'
import { ViewerHeader } from '../shared/ViewerHeader'

export const DESIGN_PREVIEW_TAB = '__design-preview-tab__'

type Props = {
  templateId: string
  title: string
  busy: boolean
  onBack: () => void
  onUse: () => void
}

export function DesignTemplatePreview({ templateId, title, busy, onBack, onUse }: Props) {
  const t = useTranslation()
  const stageRef = useStandaloneBrowserPage(DESIGN_PREVIEW_TAB, templateId, () => designApi.preview(templateId))

  return (
    <div data-testid="design-template-preview" className="flex min-h-0 flex-1 flex-col">
      <ViewerHeader title={t('design.previewOf', { title })} onBack={onBack}>
        <Button size="sm" disabled={busy} onClick={onUse}>{t('design.useTemplate')}</Button>
      </ViewerHeader>
      <div ref={stageRef} data-testid="design-preview-stage" className="min-h-0 flex-1" />
    </div>
  )
}
