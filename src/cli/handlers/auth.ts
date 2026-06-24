/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import {
  clearAuthRelatedCaches,
  performLogout,
} from '../../commands/logout/logout.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getSSLErrorHint } from '../../services/api/errorUtils.js'
import { fetchAndStoreClaudeCodeFirstTokenDate } from '../../services/api/firstTokenDate.js'
import {
  createAndStoreApiKey,
  fetchAndStoreUserRoles,
  refreshOAuthToken,
  shouldUseClaudeAIAuth,
  storeOAuthAccountInfo,
} from '../../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js'
import { OAuthService } from '../../services/oauth/index.js'
import type { OAuthTokens } from '../../services/oauth/types.js'
import { OpenAIOAuthService } from '../../services/openaiAuth/index.js'
import { getOpenAIOAuthTokens } from '../../services/openaiAuth/storage.js'
import type { OpenAIOAuthTokens } from '../../services/openaiAuth/types.js'
import {
  clearStoredClaudeAIOAuthTokens,
  clearOAuthTokenCache,
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  getOpenAIAuthOverrideWarning,
  getOauthAccountInfo,
  getSubscriptionType,
  isUsing3PServices,
  removeApiKey,
  saveOAuthTokensIfNeeded,
  validateForceLoginOrg,
} from '../../utils/auth.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isRunningOnHomespace } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  buildAccountProperties,
  buildAPIProviderProperties,
} from '../../utils/status.js'

/**
 * Shared post-token-acquisition logic. Saves tokens, fetches profile/roles,
 * and sets up the local auth state.
 */
export async function installOAuthTokens(tokens: OAuthTokens): Promise<void> {
  // Clear old state before saving new credentials
  await performLogout({ clearOnboarding: false })

  // Reuse pre-fetched profile if available, otherwise fetch fresh
  const profile =
    tokens.profile ?? (await getOauthProfileFromOauthToken(tokens.accessToken))
  if (profile) {
    storeOAuthAccountInfo({
      accountUuid: profile.account.uuid,
      emailAddress: profile.account.email,
      organizationUuid: profile.organization.uuid,
      displayName: profile.account.display_name || undefined,
      hasExtraUsageEnabled:
        profile.organization.has_extra_usage_enabled ?? undefined,
      billingType: profile.organization.billing_type ?? undefined,
      subscriptionCreatedAt:
        profile.organization.subscription_created_at ?? undefined,
      accountCreatedAt: profile.account.created_at,
    })
  } else if (tokens.tokenAccount) {
    // Fallback to token exchange account data when profile endpoint fails
    storeOAuthAccountInfo({
      accountUuid: tokens.tokenAccount.uuid,
      emailAddress: tokens.tokenAccount.emailAddress,
      organizationUuid: tokens.tokenAccount.organizationUuid,
    })
  }

  const storageResult = saveOAuthTokensIfNeeded(tokens)
  clearOAuthTokenCache()

  if (storageResult.warning) {
    logEvent('tengu_oauth_storage_warning', {
      warning:
        storageResult.warning as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Roles and first-token-date may fail for limited-scope tokens (e.g.
  // inference-only from setup-token). They're not required for core auth.
  await fetchAndStoreUserRoles(tokens.accessToken).catch(err =>
    logForDebugging(String(err), { level: 'error' }),
  )

  if (shouldUseClaudeAIAuth(tokens.scopes)) {
    await fetchAndStoreClaudeCodeFirstTokenDate().catch(err =>
      logForDebugging(String(err), { level: 'error' }),
    )
  } else {
    // API key creation is critical for Console users — let it throw.
    const apiKey = await createAndStoreApiKey(tokens.accessToken)
    if (!apiKey) {
      throw new Error(
        'Unable to create API key. The server accepted the request but did not return a key.',
      )
    }
  }

  await clearAuthRelatedCaches()
}

export async function installOpenAIOAuthTokens(
  tokens: OpenAIOAuthTokens,
): Promise<string | null> {
  await removeApiKey()
  const clearClaudeOauth = clearStoredClaudeAIOAuthTokens()
  if (!clearClaudeOauth.success) {
    throw new Error(
      clearClaudeOauth.warning ?? 'Failed to disable existing Claude auth state',
    )
  }

  saveGlobalConfig(current => ({
    ...current,
    oauthAccount: undefined,
  }))

  if (!tokens.refreshToken) {
    throw new Error('OpenAI OAuth tokens are incomplete.')
  }

  await clearAuthRelatedCaches()
  return getOpenAIAuthOverrideWarning()
}

export async function authLogin({
  email,
  sso,
  console: useConsole,
  claudeai,
  openai,
}: {
  email?: string
  sso?: boolean
  console?: boolean
  claudeai?: boolean
  openai?: boolean
}): Promise<void> {
  if (openai) {
    if (email || sso || useConsole || claudeai) {
      process.stderr.write(
        'Error: --openai cannot be combined with --email, --sso, --console, or --claudeai.\n',
      )
      process.exit(1)
    }

    const openaiOAuthService = new OpenAIOAuthService()

    try {
      const tokens = await openaiOAuthService.startOAuthFlow(async url => {
        process.stdout.write('Opening browser to sign in to OpenAI…\n')
        process.stdout.write(`If the browser did not open, visit: ${url}\n`)
      })

      const warning = await installOpenAIOAuthTokens(tokens)

      process.stdout.write('OpenAI login successful.\n')
      if (warning) {
        process.stdout.write(`${warning}\n`)
      }
      process.exit(0)
    } catch (err) {
      logError(err)
      process.stderr.write(`OpenAI login failed: ${errorMessage(err)}\n`)
      process.exit(1)
    } finally {
      openaiOAuthService.cleanup()
    }
  }

  if (useConsole && claudeai) {
    process.stderr.write(
      'Error: --console and --claudeai cannot be used together.\n',
    )
    process.exit(1)
  }

  const settings = getInitialSettings()
  // forceLoginMethod is a hard constraint (enterprise setting) — matches ConsoleOAuthFlow behavior.
  // Without it, --console selects Console; --claudeai (or no flag) selects claude.ai.
  const loginWithClaudeAi = settings.forceLoginMethod
    ? settings.forceLoginMethod === 'claudeai'
    : !useConsole
  const orgUUID = settings.forceLoginOrgUUID

  // Fast path: if a refresh token is provided via env var, skip the browser
  // OAuth flow and exchange it directly for tokens.
  const envRefreshToken = process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN
  if (envRefreshToken) {
    const envScopes = process.env.CLAUDE_CODE_OAUTH_SCOPES
    if (!envScopes) {
      process.stderr.write(
        'CLAUDE_CODE_OAUTH_SCOPES is required when using CLAUDE_CODE_OAUTH_REFRESH_TOKEN.\n' +
          'Set it to the space-separated scopes the refresh token was issued with\n' +
          '(e.g. "user:inference" or "user:profile user:inference user:sessions:claude_code user:mcp_servers").\n',
      )
      process.exit(1)
    }

    const scopes = envScopes.split(/\s+/).filter(Boolean)

    try {
      logEvent('tengu_login_from_refresh_token', {})

      const tokens = await refreshOAuthToken(envRefreshToken, { scopes })
      await installOAuthTokens(tokens)

      const orgResult = await validateForceLoginOrg()
      if (!orgResult.valid) {
        process.stderr.write(orgResult.message + '\n')
        process.exit(1)
      }

      // Mark onboarding complete — interactive paths handle this via
      // the Onboarding component, but the env var path skips it.
      saveGlobalConfig(current => {
        if (current.hasCompletedOnboarding) return current
        return { ...current, hasCompletedOnboarding: true }
      })

      logEvent('tengu_oauth_success', {
        loginWithClaudeAi: shouldUseClaudeAIAuth(tokens.scopes),
      })
      process.stdout.write('Login successful.\n')
      process.exit(0)
    } catch (err) {
      logError(err)
      const sslHint = getSSLErrorHint(err)
      process.stderr.write(
        `Login failed: ${errorMessage(err)}\n${sslHint ? sslHint + '\n' : ''}`,
      )
      process.exit(1)
    }
  }

  const resolvedLoginMethod = sso ? 'sso' : undefined

  const oauthService = new OAuthService()

  try {
    logEvent('tengu_oauth_flow_start', { loginWithClaudeAi })

    const result = await oauthService.startOAuthFlow(
      async url => {
        process.stdout.write('Opening browser to sign in…\n')
        process.stdout.write(`If the browser didn't open, visit: ${url}\n`)
      },
      {
        loginWithClaudeAi,
        loginHint: email,
        loginMethod: resolvedLoginMethod,
        orgUUID,
      },
    )

    await installOAuthTokens(result)

    const orgResult = await validateForceLoginOrg()
    if (!orgResult.valid) {
      process.stderr.write(orgResult.message + '\n')
      process.exit(1)
    }

    logEvent('tengu_oauth_success', { loginWithClaudeAi })

    process.stdout.write('Login successful.\n')
    process.exit(0)
  } catch (err) {
    logError(err)
    const sslHint = getSSLErrorHint(err)
    process.stderr.write(
      `Login failed: ${errorMessage(err)}\n${sslHint ? sslHint + '\n' : ''}`,
    )
    process.exit(1)
  } finally {
    oauthService.cleanup()
  }
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
  openai?: boolean
}): Promise<void> {
  if (opts.openai) {
    const openaiTokens = getOpenAIOAuthTokens()
    const loggedIn =
      !!openaiTokens &&
      openaiTokens.refreshToken.length > 0 &&
      openaiTokens.expiresAt > 0

    if (opts.text) {
      if (!loggedIn) {
        process.stdout.write(
          'Not logged in to OpenAI. Run claude auth login --openai to authenticate.\n',
        )
      } else {
        process.stdout.write('Provider: openai\n')
        if (openaiTokens.email) {
          process.stdout.write(`Email: ${openaiTokens.email}\n`)
        }
        if (openaiTokens.accountId) {
          process.stdout.write(`Account ID: ${openaiTokens.accountId}\n`)
        }
        process.stdout.write(
          `Expires At: ${new Date(openaiTokens.expiresAt).toISOString()}\n`,
        )
      }
    } else {
      process.stdout.write(
        jsonStringify(
          {
            loggedIn,
            authMethod: loggedIn ? 'openai_oauth' : 'none',
            provider: 'openai',
            email: openaiTokens?.email ?? null,
            accountId: openaiTokens?.accountId ?? null,
            expiresAt: openaiTokens?.expiresAt ?? null,
          },
          null,
          2,
        ) + '\n',
      )
    }

    process.exit(loggedIn ? 0 : 1)
  }

  const { source: authTokenSource, hasToken } = getAuthTokenSource()
  const { source: apiKeySource } = getAnthropicApiKeyWithSource()
  const hasApiKeyEnvVar =
    !!process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()
  const oauthAccount = getOauthAccountInfo()
  const subscriptionType = getSubscriptionType()
  const using3P = isUsing3PServices()
  const openaiTokens = getOpenAIOAuthTokens()
  const usingOpenAI =
    !!openaiTokens?.refreshToken &&
    !hasToken &&
    apiKeySource === 'none' &&
    !hasApiKeyEnvVar &&
    !using3P
  const loggedIn =
    hasToken ||
    apiKeySource !== 'none' ||
    hasApiKeyEnvVar ||
    using3P ||
    usingOpenAI

  // Determine auth method
  let authMethod: string = 'none'
  if (usingOpenAI) {
    authMethod = 'openai_oauth'
  } else if (using3P) {
    authMethod = 'third_party'
  } else if (authTokenSource === 'claude.ai') {
    authMethod = 'claude.ai'
  } else if (authTokenSource === 'apiKeyHelper') {
    authMethod = 'api_key_helper'
  } else if (authTokenSource !== 'none') {
    authMethod = 'oauth_token'
  } else if (apiKeySource === 'ANTHROPIC_API_KEY' || hasApiKeyEnvVar) {
    authMethod = 'api_key'
  } else if (apiKeySource === '/login managed key') {
    authMethod = 'claude.ai'
  }

  if (opts.text) {
    const properties = [
      ...buildAccountProperties(),
      ...buildAPIProviderProperties(),
    ]
    let hasAuthProperty = false
    for (const prop of properties) {
      const value =
        typeof prop.value === 'string'
          ? prop.value
          : Array.isArray(prop.value)
            ? prop.value.join(', ')
            : null
      if (value === null || value === 'none') {
        continue
      }
      hasAuthProperty = true
      if (prop.label) {
        process.stdout.write(`${prop.label}: ${value}\n`)
      } else {
        process.stdout.write(`${value}\n`)
      }
    }
    if (!hasAuthProperty && hasApiKeyEnvVar) {
      process.stdout.write('API key: ANTHROPIC_API_KEY\n')
    }
    if (!loggedIn) {
      process.stdout.write(
        'Not logged in. Run claude auth login to authenticate.\n',
      )
    }
  } else {
    const apiProvider = getAPIProvider()
    const resolvedApiKeySource =
      apiKeySource !== 'none'
        ? apiKeySource
        : hasApiKeyEnvVar
          ? 'ANTHROPIC_API_KEY'
          : null
    const output: Record<string, string | boolean | null> = {
      loggedIn,
      authMethod,
      apiProvider,
    }
    if (resolvedApiKeySource) {
      output.apiKeySource = resolvedApiKeySource
    }
    if (authMethod === 'claude.ai') {
      output.email = oauthAccount?.emailAddress ?? null
      output.orgId = oauthAccount?.organizationUuid ?? null
      output.orgName = oauthAccount?.organizationName ?? null
      output.subscriptionType = subscriptionType ?? null
    } else if (authMethod === 'openai_oauth') {
      output.provider = 'openai'
      output.email = openaiTokens?.email ?? null
      output.accountId = openaiTokens?.accountId ?? null
      output.subscriptionType = 'ChatGPT Pro/Plus'
    }

    process.stdout.write(jsonStringify(output, null, 2) + '\n')
  }
  process.exit(loggedIn ? 0 : 1)
}

export async function authLogout(opts?: { openai?: boolean }): Promise<void> {
  if (opts?.openai) {
    const openaiOAuthService = new OpenAIOAuthService()
    const success = openaiOAuthService.logout()
    if (!success) {
      process.stderr.write('Failed to log out from OpenAI.\n')
      process.exit(1)
    }
    process.stdout.write('Successfully logged out from your OpenAI account.\n')
    process.exit(0)
  }

  try {
    await performLogout({ clearOnboarding: false })
  } catch {
    process.stderr.write('Failed to log out.\n')
    process.exit(1)
  }
  process.stdout.write('Successfully logged out from your Anthropic account.\n')
  process.exit(0)
}
