import { cn } from '../../lib/utils'
import { Spinner } from './ui/spinner'

export function LoadingBlock({ className, spinnerClassName }: { className?: string; spinnerClassName?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-12 text-primary', className)}>
      <Spinner className={cn('size-5', spinnerClassName)} />
    </div>
  )
}
