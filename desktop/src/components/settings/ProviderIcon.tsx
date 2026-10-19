import { Server } from 'lucide-react'

const providerIcons: Record<string, string> = {
  deepseek: 'deepseek',
  qwen: 'qwen',
  kimi: 'kimi',
  zhipuglm: 'zhipu',
  lmstudio: 'lmstudio',
  ollama: 'ollama',
}

type ProviderIconProps = {
  presetId: string
  className?: string
}

function ProviderIcon({ presetId, className = '' }: ProviderIconProps) {
  const icon = Object.prototype.hasOwnProperty.call(providerIcons, presetId)
    ? providerIcons[presetId]
    : undefined
  if (!icon) {
    return <Server aria-hidden="true" data-testid="provider-icon-fallback" className={`size-4 shrink-0 ${className}`} />
  }

  const maskImage = `url('/icons/providers/${icon}.svg')`
  return (
    <span
      aria-hidden="true"
      data-testid={`provider-icon-${presetId}`}
      className={`inline-block size-4 shrink-0 bg-current ${className}`}
      style={{
        maskImage,
        WebkitMaskImage: maskImage,
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}

export { ProviderIcon }
