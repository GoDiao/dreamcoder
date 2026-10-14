import type { TranslationKey } from '../../i18n'
import type { ProviderPreset } from '../../types/providerPreset'

export function getPresetDisplayName(
  preset: Pick<ProviderPreset, 'id' | 'name'>,
  t: (key: TranslationKey) => string,
): string {
  return preset.id === 'custom' ? t('settings.providers.customPreset') : preset.name
}
