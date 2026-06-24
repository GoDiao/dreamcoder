// desktop/src/components/settings/ChatGPTOfficialLogin.tsx

import { useEffect, useState } from 'react'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { Copy, LogIn, LogOut } from 'lucide-react'
import { useProviderOpenAIOAuthStore } from '../../stores/providerOpenAIOAuthStore'
import { useTranslation } from '../../i18n'
import { copyTextToClipboard } from '../chat/clipboard'

export function ChatGPTOfficialLogin() {
  const t = useTranslation()
  const [manualAuthorizeUrl, setManualAuthorizeUrl] = useState<string | null>(null)
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useProviderOpenAIOAuthStore()

  useEffect(() => {
    void fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  useEffect(() => {
    if (status?.loggedIn) {
      setManualAuthorizeUrl(null)
    }
  }, [status?.loggedIn])

  const handleLogin = async () => {
    setManualAuthorizeUrl(null)
    try {
      const { authorizeUrl } = await login()
      setManualAuthorizeUrl(authorizeUrl)
      try {
        await shellOpen(authorizeUrl)
        setManualAuthorizeUrl(null)
        startPolling()
      } catch (err) {
        console.error('[ChatGPTOfficialLogin] shellOpen failed:', err)
        useProviderOpenAIOAuthStore.setState({
          error: t('settings.chatgptOfficialLogin.openBrowserFailed'),
        })
      }
    } catch {
      // store.login() errors are already captured into store.error
    }
  }

  const handleCopyAuthorizeUrl = async () => {
    if (!manualAuthorizeUrl) return
    const copied = await copyTextToClipboard(manualAuthorizeUrl)
    if (copied) {
      setManualAuthorizeUrl(null)
      useProviderOpenAIOAuthStore.setState({ error: null })
      startPolling()
      return
    }
    useProviderOpenAIOAuthStore.setState({
      error: t('settings.chatgptOfficialLogin.copyLinkFailed'),
    })
  }

  const manualAuthorizeButton = manualAuthorizeUrl ? (
    <button
      type="button"
      onClick={handleCopyAuthorizeUrl}
      className="inline-flex items-center gap-1.5 self-start rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      {t('settings.chatgptOfficialLogin.copyAuthorizeUrl')}
    </button>
  ) : null

  if (status === null) {
    if (error) {
      return (
        <div data-testid="chatgpt-official-login" className="flex flex-col gap-2">
          <div className="text-xs text-[var(--color-error)]">
            {t('settings.chatgptOfficialLogin.errorPrefix')}{error}
          </div>
          {manualAuthorizeButton}
        </div>
      )
    }
    return (
      <div data-testid="chatgpt-official-login" className="text-xs text-[var(--color-text-tertiary)]">
        {t('common.loading')}
      </div>
    )
  }

  if (status.loggedIn) {
    const accountLabel = status.email || status.accountId || t('settings.chatgptOfficialLogin.accountUnknown')
    return (
      <div data-testid="chatgpt-official-login" className="flex items-center gap-3 text-sm">
        <span className="text-[var(--color-success)]">
          {t('settings.chatgptOfficialLogin.loggedInPrefix')} {accountLabel}
        </span>
        <button
          type="button"
          onClick={logout}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] px-3 py-1 text-xs transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          {isLoading
            ? t('settings.chatgptOfficialLogin.logoutProcessing')
            : t('settings.chatgptOfficialLogin.logoutButton')}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="chatgpt-official-login" className="flex flex-col gap-2">
      <div className="text-sm text-[var(--color-text-secondary)]">
        {t('settings.chatgptOfficialLogin.intro')}
      </div>
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoading}
        className="inline-flex items-center gap-2 self-start rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-opacity hover:brightness-105 disabled:opacity-50"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {isLoading
          ? t('settings.chatgptOfficialLogin.loginStarting')
          : t('settings.chatgptOfficialLogin.loginButton')}
      </button>
      {error && (
        <div className="text-xs text-[var(--color-error)]">
          {t('settings.chatgptOfficialLogin.errorPrefix')}{error}
        </div>
      )}
      {manualAuthorizeButton}
    </div>
  )
}
