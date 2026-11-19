export type TextSegment = { kind: 'text' | 'thinking'; text: string }

const OPEN_TAG = '<think>'
const CLOSE_TAG = '</think>'

function heldTagPrefix(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length -= 1) {
    if (text.endsWith(tag.slice(0, length))) return length
  }
  return 0
}

export class ThinkTagSplitter {
  private inThink = false
  private afterClose = false
  private held = ''

  push(chunk: string): TextSegment[] {
    const segments: TextSegment[] = []
    let rest = this.held + chunk
    this.held = ''
    while (rest) {
      const tag = this.inThink ? CLOSE_TAG : OPEN_TAG
      const at = rest.indexOf(tag)
      if (at >= 0) {
        this.emit(rest.slice(0, at), segments)
        this.inThink = !this.inThink
        this.afterClose = !this.inThink
        rest = rest.slice(at + tag.length)
        continue
      }
      const held = heldTagPrefix(rest, tag)
      this.emit(rest.slice(0, rest.length - held), segments)
      this.held = rest.slice(rest.length - held)
      break
    }
    return segments
  }

  flush(): TextSegment[] {
    const segments: TextSegment[] = []
    this.emit(this.held, segments)
    this.held = ''
    return segments
  }

  private emit(text: string, segments: TextSegment[]): void {
    const kind = this.inThink ? 'thinking' : 'text'
    const trimmed = kind === 'text' && this.afterClose ? text.replace(/^\s+/, '') : text
    if (!trimmed) return
    if (kind === 'text') this.afterClose = false
    const last = segments.at(-1)
    if (last?.kind === kind) last.text += trimmed
    else segments.push({ kind, text: trimmed })
  }
}

export function splitThinkTags(text: string): TextSegment[] {
  const splitter = new ThinkTagSplitter()
  return [...splitter.push(text), ...splitter.flush()]
}
