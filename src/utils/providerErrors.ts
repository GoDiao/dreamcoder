export type ProviderErrorKind = 'context_overflow' | 'quota' | 'auth' | 'rate_limit'

const OVERFLOW_CODES = new Set([
  'context_length_exceeded',
  'context_window_exceeded',
  'model_context_window_exceeded',
  '1261',
])

const OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /maximum context length/i,
  /context[ _](?:length|window)[ _](?:is )?exceeded/i,
  /exceeds? the (?:model's )?context window/i,
  /range of input length should be/i,
  /input token count.*exceeds? the maximum number of tokens/i,
  /exceeded model token limit/i,
  /message token length.*exceeds? model limit/i,
  /prompt exceeds max length/i,
]

const QUOTA_CODES = new Set([
  'insufficient_quota',
  'exceeded_current_quota_error',
  'billing_hard_limit_reached',
  'insufficient_balance',
  '1113',
])

const QUOTA_PATTERNS = [
  /insufficient[ _](?:quota|balance|credits)/i,
  /exceeded (?:your |the )?current quota/i,
  /exceeded_current_quota_error/i,
  /billing_hard_limit_reached/i,
  /"code"\s*:\s*"?1113\b/,
  /余额不足/,
]

const AUTH_CODES = new Set(['invalid_api_key', 'invalid_authentication', 'authentication_error', 'unauthorized'])

const RATE_LIMIT_CODES = new Set(['rate_limit_exceeded', 'rate_limit_error', '1302', '1303', '1305'])

const TOKEN_COUNT_PATTERNS: Array<{ pattern: RegExp; actual: number; limit: number }> = [
  { pattern: /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i, actual: 1, limit: 2 },
  { pattern: /maximum context length is (\d+) tokens.*?(?:resulted in|requested about) (\d+) tokens/is, actual: 2, limit: 1 },
  { pattern: /input token count \((\d+)\) exceeds? the maximum number of tokens allowed \((\d+)\)/i, actual: 1, limit: 2 },
  { pattern: /message token length (\d+) exceeds? model limit (\d+)/i, actual: 1, limit: 2 },
]

function hasCode(codes: Set<string>, code: unknown): boolean {
  return (typeof code === 'string' || typeof code === 'number') && codes.has(String(code).toLowerCase())
}

function isContextOverflowCode(code: unknown): boolean {
  return hasCode(OVERFLOW_CODES, code)
}

export function isQuotaErrorText(text: string): boolean {
  return QUOTA_PATTERNS.some((pattern) => pattern.test(text))
}

export function classifyProviderError(error: { status?: number; code?: string; message: string }): ProviderErrorKind | undefined {
  if (isContextOverflowCode(error.code) || isContextOverflowText(error.message)) return 'context_overflow'
  if (error.status === 402 || hasCode(QUOTA_CODES, error.code) || isQuotaErrorText(error.message)) return 'quota'
  if (error.status === 401 || error.status === 403 || hasCode(AUTH_CODES, error.code)) return 'auth'
  if (error.status === 429 || hasCode(RATE_LIMIT_CODES, error.code)) return 'rate_limit'
  return undefined
}

export function isContextOverflowText(text: string): boolean {
  return OVERFLOW_PATTERNS.some((pattern) => pattern.test(text))
}

export function parseContextOverflowTokens(text: string): { actualTokens?: number; limitTokens?: number } {
  for (const { pattern, actual, limit } of TOKEN_COUNT_PATTERNS) {
    const match = text.match(pattern)
    if (match) return { actualTokens: Number(match[actual]), limitTokens: Number(match[limit]) }
  }
  return {}
}

export function toPromptTooLongMessage(text: string): string {
  const { actualTokens, limitTokens } = parseContextOverflowTokens(text)
  const counts = actualTokens !== undefined && limitTokens !== undefined
    ? `: ${actualTokens} tokens > ${limitTokens} maximum`
    : ''
  return `prompt is too long${counts} · ${text}`
}
