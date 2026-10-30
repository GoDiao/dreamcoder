import type { ReactElement, ReactNode } from 'react'
import { Tooltip as PrimitiveTooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

type TooltipProps = {
  content?: ReactNode
  children: ReactElement
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <PrimitiveTooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {content && <TooltipContent sideOffset={6}>{content}</TooltipContent>}
    </PrimitiveTooltip>
  )
}
