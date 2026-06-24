import { Input } from '../shared/Input'
import { Button } from '../shared/Button'

type ProxyMode = 'system' | 'manual'

type ProxyConfigFormLabels = {
  modeSystemLabel: string
  modeSystemDesc: string
  modeManualLabel: string
  modeManualDesc: string
  urlLabel: string
  urlPlaceholder: string
  urlHint: string
  urlRequiredError: string
  urlInvalidError: string
  scopeHint: string
  saveLabel: string
}

type ProxyConfigFormProps = {
  mode: ProxyMode
  url: string
  isDirty: boolean
  isSaving: boolean
  error: string | null
  labels: ProxyConfigFormLabels
  onModeChange: (mode: ProxyMode) => void
  onUrlChange: (url: string) => void
  onSave: () => void
}

export function ProxyConfigForm({
  mode,
  url,
  isDirty,
  isSaving,
  error,
  labels,
  onModeChange,
  onUrlChange,
  onSave,
}: ProxyConfigFormProps) {
  const proxyUrl = url.trim()
  const proxyError =
    mode === 'manual' && !proxyUrl
      ? labels.urlRequiredError
      : mode === 'manual' && !isValidHttpProxyUrl(proxyUrl)
        ? labels.urlInvalidError
        : null

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {([
          { value: 'system' as const, label: labels.modeSystemLabel, description: labels.modeSystemDesc },
          { value: 'manual' as const, label: labels.modeManualLabel, description: labels.modeManualDesc },
        ]).map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onModeChange(item.value)}
            aria-pressed={mode === item.value}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              mode === item.value
                ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <div className="text-xs font-semibold">{item.label}</div>
            <div className="mt-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
              {item.description}
            </div>
          </button>
        ))}
      </div>

      {mode === 'manual' && (
        <div className="mt-4">
          <Input
            label={labels.urlLabel}
            value={url}
            placeholder={labels.urlPlaceholder}
            autoComplete="off"
            error={proxyError ?? undefined}
            onChange={(event) => onUrlChange(event.target.value)}
          />
          {!proxyError && (
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
              {labels.urlHint}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 text-[11px] leading-4 text-[var(--color-text-tertiary)]">
          {labels.scopeHint}
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="min-w-[72px] px-4 whitespace-nowrap"
          disabled={!isDirty || !!proxyError || isSaving}
          loading={isSaving}
          onClick={onSave}
        >
          {labels.saveLabel}
        </Button>
      </div>

      {error && (
        <p className="mt-2 text-[11px] leading-4 text-[var(--color-error)]">
          {error}
        </p>
      )}
    </div>
  )
}

function isValidHttpProxyUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
