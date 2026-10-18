import { useTranslation } from '../../i18n'
import { useProviderStore } from '../../stores/providerStore'
import { SETTINGS_TAB_ID, useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { RuntimeSelection } from '../../types/runtime'
import { Button } from '../shared/Button'

export function openProviderSettings() {
  useUIStore.getState().setPendingSettingsTab('providers')
  useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
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

export function ProviderRequiredNotice({ className = '', testId = 'provider-required-notice' }: Props) {
  const t = useTranslation()
  const hasProviders = useProviderStore((s) => s.providers.length > 0)

  return (
    <div
      data-testid={testId}
      role="status"
      className={`flex items-center justify-between gap-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-left text-sm text-[var(--color-text-secondary)] ${className}`}
    >
      <span className="min-w-0">
        {hasProviders ? t('chat.providerRequired.noDefault') : t('empty.noProvider')}
      </span>
      <Button size="sm" variant="secondary" className="flex-shrink-0" onClick={openProviderSettings}>
        {hasProviders ? t('chat.providerRequired.openSettings') : t('settings.providers.addProvider')}
      </Button>
    </div>
  )
}
