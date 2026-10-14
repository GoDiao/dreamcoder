export const CARD_ERROR = {
  RATE_LIMITED: 230020,
  CARD_CONTENT_FAILED: 230099,
} as const

export const CARD_CONTENT_SUB_ERROR = {
  ELEMENT_LIMIT: 11310,
} as const

function coerceCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function extractLarkApiCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as {
    code?: unknown
    data?: { code?: unknown }
    response?: { data?: { code?: unknown } }
  }
  return coerceCode(e.code) ?? coerceCode(e.data?.code) ?? coerceCode(e.response?.data?.code)
}

export function extractSubCode(msg: string): number | null {
  const match = /ErrCode:\s*(\d+)/.exec(msg)
  if (!match) return null
  const code = Number(match[1])
  return Number.isFinite(code) ? code : null
}

export type CardApiErrorInfo = {
  code: number
  subCode: number | null
  errMsg: string
}

export function parseCardApiError(err: unknown): CardApiErrorInfo | null {
  const code = extractLarkApiCode(err)
  if (code === undefined) return null

  let errMsg = ''
  if (err && typeof err === 'object') {
    const e = err as {
      msg?: unknown
      message?: unknown
      response?: { data?: { msg?: unknown } }
    }
    if (typeof e.msg === 'string') {
      errMsg = e.msg
    } else if (typeof e.response?.data?.msg === 'string') {
      errMsg = e.response.data.msg
    } else if (typeof e.message === 'string') {
      errMsg = e.message
    }
  }

  const subCode = extractSubCode(errMsg)
  return { code, subCode, errMsg }
}

export function isCardRateLimitError(err: unknown): boolean {
  const parsed = parseCardApiError(err)
  if (!parsed) return false
  return parsed.code === CARD_ERROR.RATE_LIMITED
}

export function isCardTableLimitError(err: unknown): boolean {
  const parsed = parseCardApiError(err)
  if (!parsed) return false
  return (
    parsed.code === CARD_ERROR.CARD_CONTENT_FAILED &&
    parsed.subCode === CARD_CONTENT_SUB_ERROR.ELEMENT_LIMIT &&
    /table number over limit/i.test(parsed.errMsg)
  )
}
