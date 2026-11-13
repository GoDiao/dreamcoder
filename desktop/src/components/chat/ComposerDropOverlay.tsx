import { FileUpIcon } from 'lucide-react'
type ComposerDropOverlayProps = {
  title: string
  description: string
  testId: string
}

export function ComposerDropOverlay({ title, description, testId }: ComposerDropOverlayProps) {
  return (
    <div
      data-testid={testId}
      className="composer-drop-overlay pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-[inherit] border border-primary/45 bg-popover/88 p-4 backdrop-blur-xs"
      aria-hidden="true"
    >
      <div className="flex max-w-[280px] items-center gap-3 rounded-xl border border-primary/30 bg-card px-4 py-3 text-left shadow-popover">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary" aria-hidden="true"><FileUpIcon size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-5 text-foreground">{title}</span>
          <span className="block text-xs leading-5 text-subtle-foreground">{description}</span>
        </span>
      </div>
    </div>
  )
}
