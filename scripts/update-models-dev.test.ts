import { describe, expect, test } from 'bun:test'

import { fetchModelsDevSnapshot } from './update-models-dev.js'

function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch
}

describe('fetchModelsDevSnapshot', () => {
  test('writes only the read fields, one model per line', async () => {
    const snapshot = await fetchModelsDevSnapshot(fetchReturning(Response.json({
      openai: {
        id: 'openai',
        name: 'OpenAI',
        api: 'https://api.openai.com/v1',
        models: {
          'gpt-5': { id: 'gpt-5', name: 'GPT-5', cost: { input: 1 }, limit: { context: 400_000, output: 128_000 }, reasoning: true },
          'gpt-4.1': { id: 'gpt-4.1', reasoning: false },
        },
      },
    })))
    const lines = snapshot.split('\n')
    expect(lines).toContain('"gpt-5":{"limit":{"context":400000,"output":128000},"reasoning":true},')
    expect(lines).toContain('"gpt-4.1":{"reasoning":false}')
    expect(snapshot).not.toContain('GPT-5')
    expect(snapshot).not.toContain('cost')
    expect(Number.isNaN(Date.parse(JSON.parse(snapshot).fetchedAt))).toBe(false)
  })

  test('fails on an error response or an empty catalog', async () => {
    await expect(fetchModelsDevSnapshot(fetchReturning(new Response('down', { status: 503 })))).rejects.toThrow('HTTP 503')
    await expect(fetchModelsDevSnapshot(fetchReturning(Response.json({})))).rejects.toThrow('no providers')
  })
})
