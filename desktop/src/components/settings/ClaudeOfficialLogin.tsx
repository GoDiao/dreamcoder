import { useEffect } from 'react'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { useProviderOAuthStore } from '../../stores/providerOAuthStore'
import { useTranslation } from '../../i18n'

export function ClaudeOfficialLogin() {
  const t = useTranslation()
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useProviderOAuthStore()

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  const handleLogin = async () => {
    try {
      const { authorizeUrl } = await login()
      try {
        await shellOpen(authorizeUrl)
        startPolling()
      } catch (err) {
        console.error('[ClaudeOfficialLogin] shellOpen failed:', err)
        useProviderOAuthStore.setState({
          error: t('settings.claudeOfficialLogin.openBrowserFailed'),
        })
      }
    } catch {
    }
  }

  if (status === null) {
    if (error) {
      return (
        <div className="text-xs text-[var(--color-error)]">
          {t('settings.claudeOfficialLogin.errorPrefix')}{error}
        </div>
      )
    }
    return (
      <div className="text-xs text-[var(--color-text-tertiary)]">
        {t('common.loading')}
      </div>
    )
  }

  if (status.loggedIn) {
    const subTypeLabel = status.subscriptionType
      ? status.subscriptionType.toUpperCase()
      : t('settings.claudeOfficialLogin.subTypeUnknown')
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--color-success)]">
          ✓ {t('settings.claudeOfficialLogin.loggedInPrefix')} {subTypeLabel})
        </span>
        <button
          type="button"
          onClick={logout}
          disabled={isLoading}
          className="px-3 py-1 text-xs rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
        >
          {isLoading
            ? t('settings.claudeOfficialLogin.logoutProcessing')
            : t('settings.claudeOfficialLogin.logoutButton')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-[var(--color-text-secondary)]">
        {t('settings.claudeOfficialLogin.intro')}
      </div>
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoading}
        className="self-start rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:brightness-105 disabled:opacity-50 transition-opacity"
      >
        {isLoading
          ? t('settings.claudeOfficialLogin.loginStarting')
          : t('settings.claudeOfficialLogin.loginButton')}
      </button>
      {error && (
        <div className="text-xs text-[var(--color-error)]">
          {t('settings.claudeOfficialLogin.errorPrefix')}{error}
        </div>
      )}
    </div>
  )
}
