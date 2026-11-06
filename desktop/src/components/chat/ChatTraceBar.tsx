import type { ReactNode } from 'react'
import { Trace } from '../shared/ui/trace'

export function ChatTraceBar({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 px-8">
      <Trace className="mx-auto mb-2 max-w-[860px] rounded-lg border border-ui-border p-3">{children}</Trace>
    </div>
  )
}
