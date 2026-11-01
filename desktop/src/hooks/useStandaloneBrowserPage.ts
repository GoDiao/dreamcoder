import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { closeBrowser, placeBrowserGuest, submitBrowserInput } from '../lib/browserGuests'
import { errorMessage } from '../lib/errorMessage'

type PageTarget = { filePath: string; rootDir: string }

export function useStandaloneBrowserPage(
  tabId: string,
  key: string,
  resolve: () => Promise<PageTarget>,
  afterOpen?: () => Promise<unknown>,
) {
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const release = placeBrowserGuest(tabId, stage, true)
    return () => {
      release()
      closeBrowser(tabId)
    }
  }, [tabId])

  useEffect(() => {
    let cancelled = false
    resolve()
      .then(async (target) => {
        if (cancelled) return
        await submitBrowserInput(null, tabId, target.filePath, target.rootDir)
        await afterOpen?.()
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(errorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [tabId, key])

  return stageRef
}
