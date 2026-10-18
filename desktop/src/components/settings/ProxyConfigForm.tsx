import type { ReactNode } from 'react'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { SettingsRow } from './SettingsRow'
import { SettingsSelect } from './SettingsSelect'

type ProxyMode = 'system' | 'manual'

type ProxyConfigFormLabels = {
  modeTitle: string
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
  /** Extra fields shown between the proxy URL and the save button. */
  children?: ReactNode
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
  children,
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
      <SettingsRow
        title={labels.modeTitle}
        description={mode === 'manual' ? labels.modeManualDesc : labels.modeSystemDesc}
        control={
          <SettingsSelect<ProxyMode>
            label={labels.modeTitle}
            options={[
              { value: 'system', label: labels.modeSystemLabel },
              { value: 'manual', label: labels.modeManualLabel },
            ]}
            value={mode}
            onChange={onModeChange}
          />
        }
      />

      {mode === 'manual' && (
        <div className="mt-3">
          <Input
            label={labels.urlLabel}
            value={url}
            placeholder={labels.urlPlaceholder}
            autoComplete="off"
            error={proxyError ?? undefined}
            onChange={(event) => onUrlChange(event.target.value)}
          />
          {!proxyError && (
            <p className="mt-1 text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
              {labels.urlHint}
            </p>
          )}
        </div>
      )}

      {children}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
          {labels.scopeHint}
        </p>
        <Button
          size="xs"
          variant="secondary"
          className="whitespace-nowrap"
          disabled={!isDirty || !!proxyError || isSaving}
          loading={isSaving}
          onClick={onSave}
        >
          {labels.saveLabel}
        </Button>
      </div>

      {error && (
        <p className="mt-2 text-xs leading-[1.5] text-[var(--color-error)]">
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
