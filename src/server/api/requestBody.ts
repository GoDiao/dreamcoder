import { ApiError } from '../middleware/errorHandler.js'

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
  throw ApiError.badRequest('Body must be a JSON object')
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value === '') throw ApiError.badRequest(`${field} is required`)
  return value
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') throw ApiError.badRequest(`${field} must be a non-empty string`)
  return value
}
