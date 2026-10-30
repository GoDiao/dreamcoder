import { cn } from '../../lib/utils'
import { Spinner } from './ui/spinner'

export function LoadingBlock({ className, spinnerClassName }: { className?: string; spinnerClassName?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-12', className)}>
      <Spinner className={cn('size-5 text-[var(--color-brand)]', spinnerClassName)} />
    </div>
  )
}
