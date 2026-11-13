import { useTranslation } from '../../i18n'

export function SystemSwatches({ colors }: { colors: string[] }) {
  const t = useTranslation()
  return (
    <span role="img" aria-label={t('design.systemSwatches')} data-testid="system-swatches" className="flex h-12 overflow-hidden border-b border-border">
      {colors.map((color, index) => (
        <span key={index} className="flex-1" style={{ backgroundColor: color }} />
      ))}
    </span>
  )
}
