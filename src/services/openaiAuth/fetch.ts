import type { ClientOptions } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { OPENAI_CODEX_API_ENDPOINT } from './client.js'
import { ensureFreshOpenAITokens } from './index.js'
import { resolveOpenAICodexModel } from './models.js'
import { getOpenAIOAuthTokens } from './storage.js'
import { anthropicToOpenaiResponses } from '../../server/proxy/transform/anthropicToOpenaiResponses.js'
import { openaiResponsesToAnthropic } from '../../server/proxy/transform/openaiResponsesToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from '../../server/proxy/streaming/openaiResponsesStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropicResponse } from '../../server/proxy/streaming/openaiResponsesStreamToAnthropicResponse.js'
import type { AnthropicRequest } from '../../server/proxy/transform/types.js'
import { logForDebugging } from '../../utils/debug.js'

export const OPENAI_OAUTH_DUMMY_KEY = 'openai-oauth-dummy-key'

export function shouldUseOpenAICodexAuth(): boolean {
  const openaiTokens = getOpenAIOAuthTokens()
  return !!openaiTokens?.refreshToken
}

export function buildOpenAICodexFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  const inner = fetchOverride ?? globalThis.fetch

  return async (input, init) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input))

    if (!url.pathname.endsWith('/v1/messages')) {
      return inner(input, init)
    }

    const originalBody = await readAnthropicBody(input, init)
    const mappedModel = resolveOpenAICodexModel(originalBody.model)
    const transformedBody = anthropicToOpenaiResponses({
      ...originalBody,
      model: mappedModel,
    })
    const upstreamBody = {
      ...transformedBody,
      stream: true,
    }

    const tokens = await ensureFreshOpenAITokens()
    if (!tokens) {
      throw new Error(
        'OpenAI OAuth token is missing or expired. Run claude auth login --openai again.',
      )
    }

    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    headers.set('Authorization', `Bearer ${tokens.accessToken}`)
    if (tokens.accountId) {
      headers.set('ChatGPT-Account-Id', tokens.accountId)
    }

    logForDebugging(
      `[API REQUEST] ${url.pathname} remapped_to=OpenAI/Codex model=${mappedModel} source=${source ?? 'unknown'} request_id=${randomUUID()}`,
    )

    const upstream = await inner(OPENAI_CODEX_API_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      signal: init?.signal,
    })

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '')
      return Response.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message: `OpenAI upstream returned HTTP ${upstream.status}: ${errorText.slice(0, 500)}`,
          },
        },
        { status: upstream.status },
      )
    }

    if (transformedBody.stream) {
      if (!upstream.body) {
        return Response.json(
          {
            type: 'error',
            error: {
              type: 'api_error',
              message: 'OpenAI upstream returned no body for stream',
            },
          },
          { status: 502 },
        )
      }

      return new Response(
        openaiResponsesStreamToAnthropic(upstream.body, mappedModel),
        {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        },
      )
    }

    if (upstream.body && isEventStreamResponse(upstream)) {
      const responseBody = await openaiResponsesStreamToAnthropicResponse(
        upstream.body,
        mappedModel,
      )
      return Response.json(responseBody)
    }

    const responseBody = await upstream.json()
    return Response.json(
      openaiResponsesToAnthropic(responseBody, mappedModel),
    )
  }
}

function isEventStreamResponse(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '')
    .toLowerCase()
    .includes('text/event-stream')
}

async function readAnthropicBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<AnthropicRequest> {
  const directBody = init?.body

  if (typeof directBody === 'string') {
    return JSON.parse(directBody) as AnthropicRequest
  }

  if (directBody instanceof Uint8Array || directBody instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(directBody).toString('utf8')) as AnthropicRequest
  }

  if (input instanceof Request) {
    return (await input.clone().json()) as AnthropicRequest
  }

  throw new Error('Unable to read Anthropic request body for OpenAI/Codex transformation')
}
