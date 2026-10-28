import { AppShell } from './components/layout/AppShell'
import { useScheduledTaskDesktopNotifications } from './hooks/useScheduledTaskDesktopNotifications'
import { installDesktopNotificationNavigation } from './lib/desktopNotificationNavigation'
import { useEffect } from 'react'
import { TooltipProvider } from './components/shared/ui/tooltip'
import { Toaster } from './components/shared/ui/sonner'

export function App() {
  useScheduledTaskDesktopNotifications()
  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    installDesktopNotificationNavigation()
      .then((fn) => {
        if (cancelled) {
          fn()
        } else {
          cleanup = fn
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])
  return (
    <TooltipProvider delayDuration={400}>
      <AppShell />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
