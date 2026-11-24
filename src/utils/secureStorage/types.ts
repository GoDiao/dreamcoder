import type { OAuthTokens } from '../../services/oauth/types.js'
import type { OpenAIOAuthTokens } from '../../services/openaiAuth/types.js'

export type SecureStorageData = {
  claudeAiOauth?: Pick<
    OAuthTokens,
    | 'accessToken'
    | 'refreshToken'
    | 'expiresAt'
    | 'scopes'
    | 'subscriptionType'
    | 'rateLimitTier'
  >
  mcpOAuth?: Record<
    string,
    {
      serverName: string
      serverUrl: string
      accessToken: string
      refreshToken?: string
      expiresAt: number
      scope?: string
      clientId?: string
      clientSecret?: string
      stepUpScope?: string
      discoveryState?: {
        authorizationServerUrl: string
        resourceMetadataUrl?: string
        resourceMetadata?: unknown
        authorizationServerMetadata?: unknown
      }
    }
  >
  mcpOAuthClientConfig?: Record<string, { clientSecret: string }>
  mcpXaaIdp?: Record<string, { idToken: string; expiresAt: number }>
  mcpXaaIdpConfig?: Record<string, { clientSecret: string }>
  pluginSecrets?: Record<string, Record<string, string>>
  trustedDeviceToken?: string
  openaiCodexOauth?: OpenAIOAuthTokens
}

export type SecureStorage = {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}
