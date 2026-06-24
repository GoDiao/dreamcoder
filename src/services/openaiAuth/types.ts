export type OpenAIOAuthTokenResponse = {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export type OpenAIOAuthTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  idToken?: string
  accountId?: string
  email?: string
  clientId?: string
}

export type OpenAIJwtClaims = {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}
