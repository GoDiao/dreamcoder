import { parseSseJson, SseDecoder, type SseMessage } from '../proxy/streaming/sse.js'
import type { UpstreamOutcome } from './requestLog.js'
import { anthropicErrorBody, apiError } from './upstreamError.js'

export function superviseAnthropicStream(
  stream: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  onEnd: (outcome: UpstreamOutcome) => void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  const sse = new SseDecoder()
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setTimeout> | undefined
  let streamError: string | undefined
  let stopped = false
  let ended = false

  const finish = (outcome: UpstreamOutcome): boolean => {
    if (ended) return false
    ended = true
    clearTimeout(timer)
    onEnd(outcome)
    return true
  }
  const observe = (messages: SseMessage[]): boolean => {
    let active = false
    for (const message of messages) {
      if (message.type !== 'event' || message.event === 'ping') continue
      active = true
      if (message.event === 'message_stop') stopped = true
      if (message.event === 'error') streamError ??= readErrorMessage(message.data)
    }
    return active
  }

  return new ReadableStream({
    async start(controller) {
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          const message = `No response from the provider for ${Math.round(idleTimeoutMs / 1000)}s`
          if (!finish({ outcome: 'idle_timeout', error: message })) return
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(anthropicErrorBody(apiError(message)))}\n\n`))
          controller.close()
          reader.cancel(new DOMException('Stream idle timeout', 'TimeoutError')).catch((err: unknown) => {
            console.error('[Upstream] Cancelling the provider stream after an idle timeout failed:', err)
          })
        }, idleTimeoutMs)
      }

      arm()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (ended) return
          if (done) break
          if (observe(sse.push(value))) arm()
          controller.enqueue(value)
        }
        observe(sse.flush())
        finish(streamError
          ? { outcome: 'error', error: streamError }
          : { outcome: stopped ? 'completed' : 'incomplete' })
        controller.close()
      } catch (err) {
        if (finish({ outcome: 'error', error: err instanceof Error ? err.message : String(err) })) {
          controller.error(err)
        }
      }
    },
    cancel(reason) {
      finish({ outcome: 'client_disconnected' })
      return reader.cancel(reason)
    },
  })
}

function readErrorMessage(data: string): string {
  const parsed = parseSseJson(data) as { error?: { message?: unknown } } | undefined
  const message = parsed?.error?.message
  return typeof message === 'string' && message ? message : 'Upstream stream error'
}
