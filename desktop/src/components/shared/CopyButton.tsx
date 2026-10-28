import { Tooltip as HintTooltip } from './Tooltip'
import { useEffect, useState, type MouseEventHandler } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { Check, Copy } from 'lucide-react'
import { Button, type buttonVariants } from './ui/button'
import { useTranslation } from '../../i18n'
import { useCopyAndNotify } from '../../hooks/useCopyAndNotify'

type Props = {
  text: string
  label?: string
  copiedLabel?: string
  iconOnly?: boolean
  size?: VariantProps<typeof buttonVariants>['size']
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
}

export function CopyButton({
  text,
  label,
  copiedLabel,
  iconOnly = false,
  size = 'xs',
  onClick,
  className = '',
}: Props) {
  const t = useTranslation()
  const copyAndNotify = useCopyAndNotify()
  const copyLabel = label ?? t('common.copy')
  const copiedText = copiedLabel ?? t('common.copied')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    setCopied(await copyAndNotify(text))
  }

  const currentLabel = copied ? copiedText : copyLabel

  return (
    <HintTooltip content={currentLabel}><Button
      variant="ghost"
      size={size}
      type="button"
      onClick={(event) => {
        onClick?.(event)
        void handleCopy()
      }}
      className={className}
      aria-label={currentLabel}
    >
      {iconOnly ? (copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />) : currentLabel}
    </Button></HintTooltip>
  )
}
