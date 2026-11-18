import { classifyProviderError, toPromptTooLongMessage } from '../../utils/providerErrors.js'
import { parseSseJson } from '../proxy/streaming/sse.js'

export type AnthropicErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'billing_error'
  | 'permission_error'
  | 'not_found_error'
  | 'request_too_large'
  | 'rate_limit_error'
  | 'api_error'
  | 'overloaded_error'

export type UpstreamFailure = {
  ok: false
  httpStatus?: number
  error: string
  errorType?: AnthropicErrorType
  headers?: Record<string, string>
}

type ProviderError = { message: string; code?: string }

export type AnthropicError = { status: number; type: AnthropicErrorType; message: string; retryable?: false }

export class UpstreamReplyError extends Error {
  constructor(readonly error: AnthropicError) {
    super(error.message)
  }
}

export function anthropicErrorBody(error: { type: AnthropicErrorType; message: string }) {
  return { type: 'error', error: { type: error.type, message: error.message } }
}

export function anthropicErrorResponse(error: AnthropicError, headers?: Record<string, string>): Response {
  return Response.json(anthropicErrorBody(error), { status: error.status, headers })
}

const MAX_PROVIDER_MESSAGE_CHARS = 500

export function apiError(message: string): AnthropicError {
  return { status: 502, type: 'api_error', message }
}

export function streamClosedEarlyError(): AnthropicError {
  return apiError('The provider closed the stream before the reply finished.')
}

export function contentFilterError(detail: string): AnthropicError {
  return { status: 400, type: 'invalid_request_error', message: `The provider's content filter stopped the reply (${detail}).` }
}

export function providerSideError(detail: string): AnthropicError {
  return apiError(`The provider stopped the reply because of an error on its side (${detail}).`)
}

const PASSED_HEADERS = ['retry-after', 'retry-after-ms', 'x-request-id']

export function readProviderError(body: unknown): ProviderError | undefined {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  const nested = record.error
  const source = nested && typeof nested === 'object' ? nested as Record<string, unknown> : record
  const message = [source.message, typeof nested === 'string' ? nested : undefined, record.message, record.msg]
    .find((value): value is string => typeof value === 'string' && value.length > 0)
  const code = [source.code, source.type, record.code].find(
    (value): value is string | number => typeof value === 'string' || typeof value === 'number',
  )
  if (!message && code === undefined) return undefined
  return {
    message: (message ?? String(code)).slice(0, MAX_PROVIDER_MESSAGE_CHARS),
    ...(code !== undefined && { code: String(code) }),
  }
}

export function toAnthropicError(status: number | undefined, error: ProviderError): AnthropicError {
  const { message } = error
  switch (classifyProviderError({ status, ...error })) {
    case 'context_overflow':
      return { status: 400, type: 'invalid_request_error', message: toPromptTooLongMessage(message) }
    case 'quota':
      return { status: 402, type: 'billing_error', message, retryable: false }
    case 'auth':
      return status === 403
        ? { status, type: 'permission_error', message, retryable: false }
        : { status: 401, type: 'authentication_error', message, retryable: false }
    case 'rate_limit':
      return { status: 429, type: 'rate_limit_error', message }
  }
  return status === undefined
    ? apiError(message)
    : { status, type: errorTypeForStatus(status), message }
}

export function upstreamHttpFailure(status: number, text: string, headers: Headers): UpstreamFailure {
  const error = readProviderError(parseSseJson(text)) ?? { message: text.trim().slice(0, MAX_PROVIDER_MESSAGE_CHARS) || `HTTP ${status}` }
  return toFailure(toAnthropicError(status, error), passedHeaders(headers))
}

export function upstreamBodyFailure(body: unknown): UpstreamFailure {
  const error = readProviderError(body) ?? { message: 'Error in response body' }
  return toFailure(toAnthropicError(undefined, error), {})
}

export function describeFailure(failure: UpstreamFailure): string {
  const status = failure.httpStatus ? `HTTP ${failure.httpStatus}` : ''
  if (!status || failure.error === status) return failure.error || status
  return `${status}: ${failure.error}`
}

export function toFailure(error: AnthropicError, headers: Record<string, string>): UpstreamFailure {
  return {
    ok: false,
    httpStatus: error.status,
    errorType: error.type,
    error: error.message,
    headers: error.retryable === false ? { ...headers, 'x-should-retry': 'false' } : headers,
  }
}

function errorTypeForStatus(status: number): AnthropicErrorType {
  switch (status) {
    case 400:
    case 422:
      return 'invalid_request_error'
    case 404:
      return 'not_found_error'
    case 413:
      return 'request_too_large'
    case 429:
      return 'rate_limit_error'
    case 529:
      return 'overloaded_error'
    default:
      return 'api_error'
  }
}

function passedHeaders(headers: Headers): Record<string, string> {
  const passed: Record<string, string> = {}
  for (const name of PASSED_HEADERS) {
    const value = headers.get(name)
    if (value) passed[name] = value
  }
  const requestId = passed['x-request-id'] ?? headers.get('request-id')
  if (requestId) passed['request-id'] = requestId
  return passed
}
