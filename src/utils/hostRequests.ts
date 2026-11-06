import type { z } from 'zod/v4'

export type HostRequest = { subtype: string } & Record<string, unknown>

export type HostRequester = <T>(
  request: HostRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => Promise<T>

let activeRequester: HostRequester | null = null

export function setHostRequester(requester: HostRequester | null): void {
  activeRequester = requester
}

export async function requestHost<T>(
  request: HostRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!activeRequester) {
    throw new Error('Session links need the DreamCoder host, which is not connected to this session.')
  }
  return activeRequester(request, schema, signal)
}
