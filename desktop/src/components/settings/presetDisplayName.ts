import type { TranslationKey } from '../../i18n'
import type { ProviderPreset } from '../../types/providerPreset'

// Preset names are brand names and stay as-is; only the generic custom entry is translated.
export function getPresetDisplayName(
  preset: Pick<ProviderPreset, 'id' | 'name'>,
  t: (key: TranslationKey) => string,
): string {
  return preset.id === 'custom' ? t('settings.providers.customPreset') : preset.name
}
