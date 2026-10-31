import type { BrowserHostChannel } from './hostChannel.js'

const TOKEN_PATTERN = /^[0-9a-f]{64}$/
const MAX_LINE_BYTES = 256

export async function readTokenLine(stream: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    while (buffered.length <= MAX_LINE_BYTES) {
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const newline = buffered.indexOf('\n')
      if (newline !== -1) {
        const line = buffered.slice(0, newline).trim()
        return TOKEN_PATTERN.test(line) ? line : null
      }
    }
    return null
  } finally {
    reader.releaseLock()
  }
}

export function startBrowserHostTokenReader(
  channel: BrowserHostChannel,
  stream: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!stream) return Promise.resolve()
  return readTokenLine(stream).then(
    (token) => {
      if (token) channel.setToken(token)
    },
    (error: unknown) => {
      console.error('[browser-host] could not read the channel token from stdin', error instanceof Error ? error.message : error)
    },
  )
}
