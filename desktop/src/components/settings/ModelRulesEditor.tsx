import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { Button } from '../shared/ui/button'
import { Input } from '../shared/ui/input'
import { ToggleGroup, ToggleGroupItem } from '../shared/ui/toggle-group'
import { SegmentedControl } from '../shared/SegmentedControl'
import { EFFORT_LEVELS, type EffortLevel } from '../../types/settings'
import type {
  CapabilityField,
  InheritedSource,
  ModelOverride,
  ProviderModel,
  ReasoningControl,
  ResolvedModelRulesView,
  ResolvedRuleValues,
} from '../../types/provider'

const MODEL_CONTEXT_WINDOW_MIN = 16000
const MODEL_CONTEXT_WINDOW_MAX = 10000000
const NUMBER_FORMAT = new Intl.NumberFormat('en-US')
const THINKING_OFF = 'off'
const THINKING_NO_LEVELS = 'no-levels'

type NumberField = 'contextWindow' | 'maxOutputTokens'
type InputField = 'image' | 'pdf'
type InputChoice = 'inherit' | 'yes' | 'no'

export type ModelOverrideDraft = Omit<ModelOverride, NumberField> & Record<NumberField, string>

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const EMPTY_DRAFT: ModelOverrideDraft = { contextWindow: '', maxOutputTokens: '' }

const SOURCE_LABEL_KEYS: Record<InheritedSource, TranslationKey> = {
  fallback: 'settings.providers.sourceFallback',
  model: 'settings.providers.sourceBuiltIn',
  modelsDev: 'settings.providers.sourceModelsDev',
  site: 'settings.providers.sourceBuiltIn',
  discovered: 'settings.providers.sourceDiscovered',
}

export function toModelOverrideDraft(override: ModelOverride | undefined): ModelOverrideDraft {
  const { contextWindow, maxOutputTokens, ...rest } = override ?? {}
  return {
    ...rest,
    contextWindow: contextWindow === undefined ? '' : String(contextWindow),
    maxOutputTokens: maxOutputTokens === undefined ? '' : String(maxOutputTokens),
  }
}

function numberFieldError(field: NumberField, value: string): TranslationKey | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (field === 'maxOutputTokens') {
    return Number.isInteger(parsed) && parsed > 0 ? null : 'settings.providers.positiveIntegerError'
  }
  if (!Number.isInteger(parsed)) return 'settings.providers.modelContextWindowNumberError'
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return 'settings.providers.modelContextWindowRangeError'
  return null
}

function parseNumberField(field: NumberField, value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed || numberFieldError(field, trimmed)) return undefined
  return Number(trimmed)
}

export function hasModelOverrideDraftError(draft: ModelOverrideDraft | undefined): boolean {
  if (!draft) return false
  return !!numberFieldError('contextWindow', draft.contextWindow) || !!numberFieldError('maxOutputTokens', draft.maxOutputTokens)
}

function fromModelOverrideDraft(draft: ModelOverrideDraft): ModelOverride | undefined {
  const { contextWindow, maxOutputTokens, ...rest } = draft
  const override: ModelOverride = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  )
  const parsedWindow = parseNumberField('contextWindow', contextWindow)
  const parsedOutput = parseNumberField('maxOutputTokens', maxOutputTokens)
  if (parsedWindow !== undefined) override.contextWindow = parsedWindow
  if (parsedOutput !== undefined) override.maxOutputTokens = parsedOutput
  return Object.keys(override).length > 0 ? override : undefined
}

export function buildModelOverrides(
  models: ProviderModel[],
  drafts: Record<string, ModelOverrideDraft>,
): Record<string, ModelOverride> {
  const overrides: Record<string, ModelOverride> = {}
  for (const model of models) {
    const id = model.id.trim()
    const draft = drafts[id]
    const override = draft ? fromModelOverrideDraft(draft) : undefined
    if (id && override) overrides[id] = override
  }
  return overrides
}

type Inherited<T> = { value: T; source: InheritedSource }

function inherited<T>(view: ResolvedModelRulesView | undefined, field: CapabilityField, value: (values: ResolvedRuleValues<InheritedSource>) => T): Inherited<T> | undefined {
  if (!view) return undefined
  return { value: value(view.inherited), source: view.inherited.sources[field] }
}

function effortLabel(t: Translate, level: EffortLevel): string {
  return t(`settings.general.effort.${level}`)
}

function effortLabels(t: Translate, levels: readonly EffortLevel[]): string {
  return levels.map((level) => effortLabel(t, level)).join(', ')
}

function describeThinking(t: Translate, control: ReasoningControl, levels: readonly EffortLevel[]): string {
  if (control === 'none') return t('settings.providers.thinkingNone')
  if (levels.length > 0) return effortLabels(t, levels)
  if (control === 'effort' || control === 'always') return t('settings.providers.thinkingAlways')
  return t('settings.providers.thinkingToggle')
}

function describeThinkingSelection(t: Translate, levels: EffortLevel[] | 'off'): string {
  if (levels === THINKING_OFF) return describeThinking(t, 'none', [])
  if (levels.length > 0) return effortLabels(t, levels)
  return t('settings.providers.thinkingNoLevels')
}

function sameLevels(a: EffortLevel[] | 'off' | undefined, b: EffortLevel[] | 'off' | undefined): boolean {
  if (a === undefined || b === undefined || a === THINKING_OFF || b === THINKING_OFF) return a === b
  return a.length === b.length && a.every((level) => b.includes(level))
}

function describeSupport(t: Translate, value: boolean): string {
  return t(value ? 'settings.providers.ruleYes' : 'settings.providers.ruleNo')
}

function thinkingSelection(levels: EffortLevel[] | 'off' | undefined): string[] {
  if (levels === undefined) return []
  if (levels === THINKING_OFF) return [THINKING_OFF]
  if (levels.length === 0) return [THINKING_NO_LEVELS]
  return levels
}

function nextThinkingLevels(previous: string[], next: string[]): EffortLevel[] | 'off' | undefined {
  const added = next.find((value) => !previous.includes(value))
  if (added === THINKING_OFF) return THINKING_OFF
  if (added === THINKING_NO_LEVELS) return []
  const levels = EFFORT_LEVELS.filter((level) => next.includes(level))
  return levels.length > 0 ? levels : undefined
}

function inheritedLevels(thinking: Inherited<{ control: ReasoningControl; levels: EffortLevel[] }> | undefined): EffortLevel[] | 'off' | undefined {
  if (!thinking) return undefined
  return thinking.value.control === 'none' ? THINKING_OFF : thinking.value.levels
}

function groupDigits(value: string): string {
  return /^\d+$/.test(value) ? NUMBER_FORMAT.format(Number(value)) : value
}

function inputChoice(value: boolean | undefined): InputChoice {
  if (value === undefined) return 'inherit'
  return value ? 'yes' : 'no'
}

type ModelRulesEditorProps = {
  modelId: string
  view: ResolvedModelRulesView | undefined
  saved: ModelOverride | undefined
  draft: ModelOverrideDraft | undefined
  onChange: (draft: ModelOverrideDraft) => void
}

export function ModelRulesEditor({ modelId, view, saved, draft = EMPTY_DRAFT, onChange }: ModelRulesEditorProps) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasError = hasModelOverrideDraftError(draft)
  const open = expanded || hasError

  const inheritedWindow = inherited(view, 'contextWindow', (v) => v.contextWindow)
  const inheritedOutput = inherited(view, 'maxOutputTokens', (v) => v.maxOutputTokens)
  const inheritedThinking = inherited(view, 'reasoning', (v) => ({ control: v.reasoning.control, levels: v.effortLevels }))
  const inheritedImage = inherited(view, 'image', (v) => v.image)
  const inheritedPdf = inherited(view, 'pdf', (v) => v.pdf)

  const sourceLabel = (source: InheritedSource) => t(SOURCE_LABEL_KEYS[source])
  const formatNumber = (value: number | undefined) => value === undefined ? '—' : NUMBER_FORMAT.format(value)
  const formatSupport = (value: boolean | undefined) => value === undefined ? '—' : describeSupport(t, value)

  const windowValue = parseNumberField('contextWindow', draft.contextWindow) ?? inheritedWindow?.value
  const outputValue = parseNumberField('maxOutputTokens', draft.maxOutputTokens) ?? inheritedOutput?.value
  const savedThinking = view && draft.reasoningLevels !== undefined && sameLevels(draft.reasoningLevels, saved?.reasoningLevels)
  const thinkingValue = savedThinking
    ? describeThinking(t, view.reasoning.control, view.effortLevels)
    : draft.reasoningLevels !== undefined
      ? describeThinkingSelection(t, draft.reasoningLevels)
      : inheritedThinking ? describeThinking(t, inheritedThinking.value.control, inheritedThinking.value.levels) : '—'
  const hasOverride = fromModelOverrideDraft(draft) !== undefined
  const summary = !view && !hasOverride
    ? t('settings.providers.modelRulesPending')
    : [
        `${t('settings.providers.ruleSummaryWindow')} ${formatNumber(windowValue)}`,
        `${t('settings.providers.ruleSummaryOutput')} ${formatNumber(outputValue)}`,
        `${t('settings.providers.ruleThinking')} ${thinkingValue}`,
        `${t('settings.providers.ruleImages')} ${formatSupport(draft.image ?? inheritedImage?.value)}`,
        `${t('settings.providers.rulePdf')} ${formatSupport(draft.pdf ?? inheritedPdf?.value)}`,
      ].join(' · ')

  const update = (patch: Partial<ModelOverrideDraft>) => onChange({ ...draft, ...patch })
  const inheritedHint = (value: string | undefined, source: InheritedSource | undefined) => (
    value !== undefined && source
      ? t('settings.providers.inheritedHint', { value, source: sourceLabel(source) })
      : t('settings.providers.inheritedAfterSave')
  )

  const restoreButton = (fieldLabel: string, disabled: boolean, patch: Partial<ModelOverrideDraft>) => (
    <Button
      variant="link-muted"
      size="inline-text"
      disabled={disabled}
      aria-label={t('settings.providers.restoreDefaultFor', { field: fieldLabel })}
      onClick={() => update(patch)}
    >
      {t('settings.providers.restoreDefault')}
    </Button>
  )

  const fieldHeader = (label: string, restore: ReactNode) => (
    <div className="mb-1 flex items-center justify-between gap-2 text-2xs">
      <span className="text-xs text-muted-foreground">{label}</span>
      {restore}
    </div>
  )

  const renderNumberField = (field: NumberField, label: string, ariaLabel: string, inheritedValue: Inherited<number> | undefined) => {
    const errorKey = numberFieldError(field, draft[field])
    return (
      <div>
        {fieldHeader(label, restoreButton(label, !draft[field], { [field]: '' }))}
        <Input
          aria-label={ariaLabel}
          aria-invalid={!!errorKey}
          inputMode="numeric"
          value={groupDigits(draft[field])}
          onChange={(event) => update({ [field]: event.target.value.replace(/[,\s]/g, '') })}
          placeholder={inheritedValue
            ? t('settings.providers.inheritedPlaceholder', { value: formatNumber(inheritedValue.value), source: sourceLabel(inheritedValue.source) })
            : t('settings.providers.inheritedAfterSave')}
        />
        {errorKey && <p className="mt-1 text-2xs text-destructive">{t(errorKey)}</p>}
      </div>
    )
  }

  const renderInputField = (field: InputField, label: string, ariaLabel: string, inheritedValue: Inherited<boolean> | undefined) => (
    <div>
      {fieldHeader(label, restoreButton(label, draft[field] === undefined, { [field]: undefined }))}
      <SegmentedControl<InputChoice>
        label={ariaLabel}
        value={inputChoice(draft[field])}
        options={[
          { value: 'inherit', label: t('settings.providers.inputDefault') },
          { value: 'yes', label: t('settings.providers.inputSupported') },
          { value: 'no', label: t('settings.providers.inputNotSupported') },
        ]}
        onChange={(choice) => update({ [field]: choice === 'inherit' ? undefined : choice === 'yes' })}
      />
      <p className="mt-1 text-2xs text-subtle-foreground">
        {inheritedHint(inheritedValue && describeSupport(t, inheritedValue.value), inheritedValue?.source)}
      </p>
    </div>
  )

  const thinkingLabel = t('settings.providers.ruleThinking')
  const defaultLevels = inheritedLevels(inheritedThinking)
  const selection = thinkingSelection(draft.reasoningLevels ?? defaultLevels)
  const selectThinking = (next: string[]) => {
    const levels = nextThinkingLevels(selection, next)
    update({ reasoningLevels: sameLevels(levels, defaultLevels) ? undefined : levels })
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-center gap-2">
        <p data-testid={`model-rules-summary-${modelId}`} className="min-w-0 flex-1 text-2xs text-muted-foreground [overflow-wrap:anywhere]">
          {summary}
        </p>
        <Button
          variant="ghost-muted"
          size="xs"
          aria-expanded={open}
          aria-label={t('settings.providers.modelSettingsFor', { model: modelId })}
          onClick={() => setExpanded((current) => !current)}
        >
          {t('settings.providers.modelSettings')}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      </div>
      {open && (
        <div data-testid={`model-rules-editor-${modelId}`} className="mt-2 grid gap-3 sm:grid-cols-2">
          {renderNumberField('contextWindow', t('settings.providers.modelContextWindow'), t('settings.providers.modelContextWindowLabel', { model: modelId }), inheritedWindow)}
          {renderNumberField('maxOutputTokens', t('settings.providers.maxOutputTokens'), t('settings.providers.maxOutputTokensLabel', { model: modelId }), inheritedOutput)}
          <div className="sm:col-span-2">
            {fieldHeader(thinkingLabel, restoreButton(thinkingLabel, draft.reasoningLevels === undefined, { reasoningLevels: undefined }))}
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              spacing={1}
              aria-label={t('settings.providers.thinkingFor', { model: modelId })}
              value={selection}
              onValueChange={selectThinking}
              className="flex-wrap"
            >
              {EFFORT_LEVELS.map((level) => (
                <ToggleGroupItem key={level} value={level}>{effortLabel(t, level)}</ToggleGroupItem>
              ))}
              <ToggleGroupItem value={THINKING_NO_LEVELS}>{t('settings.providers.thinkingNoLevels')}</ToggleGroupItem>
              <ToggleGroupItem value={THINKING_OFF}>{t('settings.providers.thinkingNone')}</ToggleGroupItem>
            </ToggleGroup>
            <p className="mt-1 text-2xs text-subtle-foreground">
              {inheritedHint(
                inheritedThinking && describeThinking(t, inheritedThinking.value.control, inheritedThinking.value.levels),
                inheritedThinking?.source,
              )}
            </p>
          </div>
          {renderInputField('image', t('settings.providers.ruleImages'), t('settings.providers.imagesFor', { model: modelId }), inheritedImage)}
          {renderInputField('pdf', t('settings.providers.rulePdf'), t('settings.providers.pdfFor', { model: modelId }), inheritedPdf)}
        </div>
      )}
    </div>
  )
}
