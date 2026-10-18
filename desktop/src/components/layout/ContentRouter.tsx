import { useEffect, useState, type ReactNode } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { EmptySession } from '../../pages/EmptySession'
import { ActiveSession } from '../../pages/ActiveSession'
import { ScheduledTasks } from '../../pages/ScheduledTasks'

export function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTabType = useTabStore((s) => s.tabs.find((t) => t.sessionId === s.activeTabId)?.type)
  const [pageAnimating, setPageAnimating] = useState(false)

  useEffect(() => {
    setPageAnimating(false)
    const frame = window.requestAnimationFrame(() => setPageAnimating(true))
    return () => window.cancelAnimationFrame(frame)
  }, [activeTabId, activeTabType])

  let page: ReactNode
  if (!activeTabId || !activeTabType) {
    page = <EmptySession />
  } else if (activeTabType === 'scheduled') {
    page = <ScheduledTasks />
  } else {
    page = <ActiveSession />
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className={`absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden motion-page-transition${pageAnimating ? ' motion-page-transition--visible' : ''}`}>
        {page}
      </div>
    </div>
  )
}
