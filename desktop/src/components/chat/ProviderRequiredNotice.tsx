import { useTranslation } from '../../i18n'
import { useProviderStore } from '../../stores/providerStore'
import { useUIStore } from '../../stores/uiStore'
import type { RuntimeSelection } from '../../types/runtime'
import { Button } from '../shared/Button'

export function openProviderSettings() {
  useUIStore.getState().openSettings('providers')
}

export function useProviderMissing(selection?: RuntimeSelection): boolean {
  return useProviderStore((s) =>
    s.hasLoadedProviders &&
    !s.activeId &&
    !(selection?.providerId && s.providers.some((provider) => provider.id === selection.providerId)),
  )
}

type Props = {
  className?: string
  testId?: string
}

/** Takes the place of the whole composer (input box, attachments, controls row) until a provider is usable. */
export function ProviderGateCard({ className = '', testId = 'provider-required-notice' }: Props) {
  const t = useTranslation()
  const providerCount = useProviderStore((s) => s.providers.length)
  const hasProviders = providerCount > 0

  return (
    <div
      data-testid={testId}
      role="status"
      className={`flex min-h-[78px] flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-3.5 pl-[18px] pr-3.5 ${className}`}
    >
      <div className="grid min-w-0 flex-1 gap-0.5 text-left">
        <strong className="text-ui-body font-semibold text-[var(--color-text-primary)]">
          {hasProviders ? t('chat.providerGate.noDefaultTitle') : t('chat.providerGate.noneTitle')}
        </strong>
        <span className="text-ui-aux text-[var(--color-text-secondary)]">
          {hasProviders
            ? t('chat.providerGate.noDefaultBody', { count: providerCount })
            : t('chat.providerGate.noneBody')}
        </span>
      </div>
      <Button size="xs" variant="primary" className="h-8 shrink-0 px-3.5 text-[13px]" onClick={openProviderSettings}>
        {hasProviders ? t('chat.providerGate.choose') : t('settings.providers.addProvider')}
      </Button>
    </div>
  )
}
