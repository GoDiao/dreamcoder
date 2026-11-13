import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function CardButton({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type}
      className={cn(
        'rounded-lg bg-background text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  )
}
