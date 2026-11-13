import type { ReactNode } from 'react'
import { Trace } from '../shared/ui/trace'

export function ChatTraceBar({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 px-8">
      <div className="mx-auto mb-2 max-w-[860px] rounded-lg border border-border p-3">
        <Trace>{children}</Trace>
      </div>
    </div>
  )
}
