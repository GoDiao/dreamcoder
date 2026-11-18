export type SseMessage =
  | { type: 'event'; event: string; data: string }
  | { type: 'comment' }

const MAX_UNFRAMED_BODY = 64 * 1024

export class SseDecoder {
  private readonly decoder = new TextDecoder()
  private buffer = ''
  private event = ''
  private data: string[] = []
  private sawEvent = false
  private unframed = ''

  push(chunk: Uint8Array): SseMessage[] {
    return this.consume(this.decoder.decode(chunk, { stream: true }), false)
  }

  flush(): SseMessage[] {
    const messages = this.consume(this.decoder.decode(), true)
    const pending = this.dispatch()
    return pending ? [...messages, pending] : messages
  }

  unframedBody(): string | null {
    return this.sawEvent ? null : this.unframed.trim() || null
  }

  private consume(text: string, final: boolean): SseMessage[] {
    if (!this.sawEvent && this.unframed.length < MAX_UNFRAMED_BODY) this.unframed += text
    let pending = this.buffer + text
    const heldCarriageReturn = !final && pending.endsWith('\r')
    if (heldCarriageReturn) pending = pending.slice(0, -1)
    const lines = pending.split(/\r\n|\r|\n/)
    const rest = lines.pop() ?? ''
    if (final) {
      if (rest) lines.push(rest)
      this.buffer = ''
    } else {
      this.buffer = heldCarriageReturn ? `${rest}\r` : rest
    }

    const messages: SseMessage[] = []
    for (const line of lines) {
      const message = this.readLine(line)
      if (message) messages.push(message)
    }
    return messages
  }

  private readLine(line: string): SseMessage | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return { type: 'comment' }

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const rawValue = colon === -1 ? '' : line.slice(colon + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

    if (field === 'data') this.data.push(value)
    else if (field === 'event') this.event = value
    return null
  }

  private dispatch(): SseMessage | null {
    const event = this.event
    const data = this.data
    this.event = ''
    this.data = []
    if (data.length === 0) return null
    this.sawEvent = true
    return { type: 'event', event, data: data.join('\n') }
  }
}

export function parseSseJson(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}
