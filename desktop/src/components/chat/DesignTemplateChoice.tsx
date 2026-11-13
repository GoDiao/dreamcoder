import { Check, PencilRuler } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '../../i18n'
import { errorMessage } from '../../lib/errorMessage'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import {
  parseChosen,
  parseDesignCandidates,
  respondWithDesignChoice,
  SCRATCH_CHOICE,
  useDesignChoiceRequest,
} from '../../lib/designChoice'
import { DESIGN_CATEGORY_LABELS, localizedText } from '../../lib/designTemplates'
import { useDesignTemplateStore } from '../../stores/designTemplateStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { TemplateThumbnail } from '../design/TemplateThumbnail'
import { CardButton } from '../shared/CardButton'
import { Button } from '../shared/ui/button'
import { Card, CardHeader, CardTitle } from '../shared/ui/card'

type Props = {
  sessionId: string
  toolUseId: string
  input: unknown
  result?: unknown
}

export function DesignTemplateChoice({ sessionId, toolUseId, input, result }: Props) {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const templates = useDesignTemplateStore((state) => state.items)
  const load = useDesignTemplateStore((state) => state.load)
  const request = useDesignChoiceRequest(sessionId)
  const openPreview = useWorkspacePanelStore((state) => state.openTemplatePreview)
  const candidates = parseDesignCandidates(input)
  const chosen = parseChosen(result)
  const answerable = request !== null && request.toolUseId === toolUseId && chosen === null
  const resolved = chosen !== null || (result !== undefined && !answerable)
  const desktop = isDesktopRuntime()

  useEffect(() => {
    void load()
  }, [load])

  const choose = (choice: string) => {
    if (request && answerable) respondWithDesignChoice(sessionId, request, choice)
  }

  const preview = (templateId: string) => {
    openPreview(sessionId, templateId).catch((error: unknown) => toast.error(errorMessage(error)))
  }

  const summary = chosen === SCRATCH_CHOICE
    ? t('design.chosenScratch')
    : chosen
      ? t('design.chosen', { title: localizedText(templates.find((template) => template.id === chosen)?.title ?? { en: chosen, zh: chosen }, locale) })
      : t('design.notChosen')

  return (
    <Card size="sm" data-testid="design-template-choice" className="my-2">
      <CardHeader>
        <CardTitle>{t('design.choiceTitle')}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-3">
        {resolved && <p role="status" className="text-xs text-muted-foreground">{summary}</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {candidates.map((candidate) => {
            const template = templates.find((item) => item.id === candidate.id)
            const picked = chosen === candidate.id
            return (
              <div
                key={candidate.id}
                data-testid="design-choice-card"
                data-picked={picked}
                className={`flex flex-col overflow-hidden rounded-lg border bg-background ${picked ? 'border-primary' : 'border-border'}`}
              >
                <TemplateThumbnail templateId={candidate.id} className="h-24 w-full" />
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <span className="text-sm font-medium text-foreground">
                    {template ? localizedText(template.title, locale) : candidate.id}
                  </span>
                  {template && <span className="text-xs text-subtle-foreground">{t(DESIGN_CATEGORY_LABELS[template.category])}</span>}
                  <span className="text-xs text-muted-foreground">{candidate.reason}</span>
                  <div className="mt-auto flex gap-2 pt-2">
                    {desktop && (
                      <Button variant="outline" size="xs" onClick={() => preview(candidate.id)}>{t('design.preview')}</Button>
                    )}
                    {picked ? (
                      <Check aria-hidden="true" className="ml-auto size-4 text-primary" />
                    ) : (
                      <Button size="xs" disabled={!answerable} onClick={() => choose(candidate.id)}>{t('design.useTemplate')}</Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <CardButton
            disabled={!answerable}
            data-picked={chosen === SCRATCH_CHOICE}
            onClick={() => choose(SCRATCH_CHOICE)}
            data-testid="design-choice-scratch"
            className={`flex min-h-24 flex-col items-start justify-between gap-2 border border-dashed p-3 ${chosen === SCRATCH_CHOICE ? 'border-primary' : 'border-border'}`}
          >
            <PencilRuler aria-hidden="true" size={22} strokeWidth={1.6} className="text-subtle-foreground" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{t('design.choiceScratch')}</span>
              <span className="text-xs text-muted-foreground">{t('design.choiceScratchHint')}</span>
            </span>
          </CardButton>
        </div>
      </div>
    </Card>
  )
}
