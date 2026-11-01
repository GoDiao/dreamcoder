import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function CardButton({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type}
      className={cn(
        'rounded-lg bg-[var(--color-surface)] text-left transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
        className,
      )}
      {...props}
    />
  )
}
