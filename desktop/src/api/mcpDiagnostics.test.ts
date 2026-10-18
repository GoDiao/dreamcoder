import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, setAuthToken } from './client'

function mockFailure(body: unknown) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify(body), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
}

describe('MCP mutation diagnostics', () => {
  afterEach(() => {
    setAuthToken(null)
    vi.restoreAllMocks()
  })

  it.each(['create', 'update', 'patch'] as const)('redacts environment echoes from %s failure diagnostics', async (operation) => {
    const secret = 'synthetic-mcp-$token.*[one]'
    const fetchMock = mockFailure({
      message: `Cannot start with ${secret}`,
      nested: { echoes: [secret, { [secret]: `prefix ${secret} suffix` }] },
    })
    const payload = { name: 'example', scope: 'user', config: { type: 'stdio', env: { API_TOKEN: secret } } }
    const request = operation === 'create'
      ? api.post('/api/mcp', payload)
      : operation === 'update'
        ? api.put('/api/mcp/example', payload)
        : api.patch('/api/mcp/example', payload)

    // Reporting must not alter the original request or the error the caller handles.
    await expect(request).rejects.toMatchObject({ message: `Cannot start with ${secret}`, status: 400 })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const diagnostic = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))
    expect(JSON.stringify(diagnostic)).not.toContain(secret)
    expect(diagnostic.details.message).toBe('Cannot start with [redacted]')
    expect(diagnostic.details.response.nested.echoes).toEqual([
      '[redacted]', { '[redacted]': 'prefix [redacted] suffix' },
    ])
    expect(diagnostic.details).not.toHaveProperty('config')
    expect(diagnostic.details).not.toHaveProperty('body')
  })

  it('redacts both environment and auth token values, including JSON-escaped echoes', async () => {
    const secret = 'synthetic-"quote"\nline\\tail'
    const auth = 'synthetic-auth-token'
    setAuthToken(auth)
    const fetchMock = mockFailure({ message: `Rejected ${JSON.stringify({ value: secret })} with ${auth}` })

    await expect(api.post('/api/mcp?cwd=test', { config: { env: { TOKEN: secret } } })).rejects.toBeInstanceOf(ApiError)

    const diagnostic = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))
    expect(diagnostic.details.message).toBe('Rejected {"value":"[redacted]"} with [redacted]')
  })

  it('redacts network failure text without retaining environment values for later requests', async () => {
    const secret = 'synthetic-network-secret'
    const error = new Error(`Connection failed ${secret}`)
    error.name = `Transport ${secret}`
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockRejectedValueOnce(new Error(`Ordinary failure ${secret}`))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await expect(api.post('/api/mcp', { config: { env: { TOKEN: secret } } })).rejects.toBe(error)
    const diagnostic = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))
    expect(diagnostic.details.message).toBe('Connection failed [redacted]')
    expect(diagnostic.details.errorName).toBe('Transport [redacted]')
    await expect(api.get('/api/status')).rejects.toThrow(`Ordinary failure ${secret}`)
    expect(JSON.parse(String(fetchMock.mock.calls[3]![1]?.body)).details.message).toBe(`Ordinary failure ${secret}`)
  })

  it('handles overlapping and empty values without masking the entire diagnostic', async () => {
    const fetchMock = mockFailure({ message: 'value synthetic-long and synthetic' })
    await expect(api.post('/api/mcp', { config: { env: { SHORT_TOKEN: 'synthetic', LONG_TOKEN: 'synthetic-long', EMPTY: '' } } })).rejects.toBeInstanceOf(ApiError)
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).details.message).toBe('value [redacted] and [redacted]')
  })

  it('keeps ordinary env values readable and never rewrites generated markers', async () => {
    const message = 'exit 1 in production: true /workspace/project abc-long-secret act'
    const fetchMock = mockFailure({ message })
    await expect(api.post('/api/mcp', { config: { env: {
      DEBUG: '1', NODE_ENV: 'production', READ_ONLY: 'true', DIRECTORY: '/workspace/project',
      api_token: 'abc-long-secret', Password: 'act',
    } } })).rejects.toThrow(message)
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).details.message)
      .toBe('exit 1 in production: true /workspace/project [redacted] [redacted]')
  })

  it('reports timeout context without persisting the submitted environment', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('synthetic-timeout-secret')))
        }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      const request = api.post('/api/mcp', { config: { env: { TOKEN: 'synthetic-timeout-secret' } } }, { timeout: 1000 })
      const rejection = expect(request).rejects.toThrow('Request timed out after 1s')
      await vi.advanceTimersByTimeAsync(1000)
      await rejection

      const diagnostic = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))
      expect(diagnostic.details.message).toBe('Request timed out after 1s')
      expect(JSON.stringify(diagnostic)).not.toContain('synthetic-timeout-secret')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([undefined, { config: null }, { config: { env: ['not-an-env-map'] } }])('handles missing or malformed environment maps: %j', async (payload) => {
    const fetchMock = mockFailure({ message: 'Invalid configuration' })
    await expect(api.post('/api/mcp', payload)).rejects.toThrow('Invalid configuration')
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).details.message).toBe('Invalid configuration')
  })

  it('keeps unrelated API diagnostics behavior unchanged', async () => {
    const fetchMock = mockFailure({ message: 'Unrelated echo synthetic-value' })
    await expect(api.post('/api/mcp-other', { config: { env: { TOKEN: 'synthetic-value' } } })).rejects.toBeInstanceOf(ApiError)
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).details.message).toBe('Unrelated echo synthetic-value')
  })
})
