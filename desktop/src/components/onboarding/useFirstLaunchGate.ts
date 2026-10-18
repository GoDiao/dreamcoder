import { useCallback, useEffect, useRef, useState } from 'react'
import { useClaudeCodeImportStore } from '../../stores/claudeCodeImportStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

export type FirstLaunchGateState = 'pending' | 'open' | 'closed'

let shownThisRun = false

/** Whether the first-launch screen was shown since the app started. */
export function firstLaunchWasShown() {
  return shownThisRun
}

/** Test helper. */
export function resetFirstLaunchWasShown() {
  shownThisRun = false
}

/**
 * Decides whether the first-launch screen covers the app: when the Claude Code
 * import is offered, or when no provider exists and onboarding was never
 * finished. Once shown it stays until finish(), so importing or adding a
 * provider does not close it under the user.
 */
export function useFirstLaunchGate(ready: boolean) {
  const importPromptOpen = useClaudeCodeImportStore((s) => s.promptOpen)
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted)
  const providersLoaded = useProviderStore((s) => s.hasLoadedProviders)
  const hasProviders = useProviderStore((s) => s.providers.length > 0)
  const [providersChecked, setProvidersChecked] = useState(false)
  const [shown, setShown] = useState(false)
  const [finished, setFinished] = useState(false)
  const requestedRef = useRef(false)

  useEffect(() => {
    if (!ready || requestedRef.current) return
    requestedRef.current = true
    const store = useProviderStore.getState()
    const request = store.hasLoadedProviders ? Promise.resolve() : store.fetchProviders()
    void request.finally(() => setProvidersChecked(true))
  }, [ready])

  const onboardingNeeded = providersChecked && providersLoaded && !hasProviders && !onboardingCompleted
  const needed = ready && !finished && (importPromptOpen || onboardingNeeded)
  if (needed && !shown) {
    shownThisRun = true
    setShown(true)
  }

  const finish = useCallback(() => {
    setFinished(true)
    useClaudeCodeImportStore.getState().closePrompt()
    // Land on the empty new-session page rather than a restored tab.
    useTabStore.setState({ activeTabId: null })
  }, [])

  let state: FirstLaunchGateState = 'closed'
  if (ready && !finished) {
    if (needed || shown) state = 'open'
    else if (!providersChecked) state = 'pending'
  }

  return { state, finish }
}
