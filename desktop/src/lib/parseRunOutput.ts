export function parseRunOutput(raw: string): string {
  if (!raw || !raw.trim()) return ''

  const lines = raw.trim().split('\n')

  const firstLine = lines.find((l) => l.trim())
  if (!firstLine || !firstLine.trim().startsWith('{')) {
    return raw.trim()
  }

  const textParts: string[] = []
  let anyRecognized = false

  for (const line of lines) {
    if (!line.trim()) continue

    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const type = parsed?.type

    if (type === 'assistant') {
      anyRecognized = true
      const content = parsed?.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) {
          textParts.push(block.text.trim())
        }
      }
    }

    if (type === 'result') {
      anyRecognized = true
      const result = parsed?.result
      if (typeof result === 'string' && result.trim()) {
        textParts.push(result.trim())
      } else if (result?.message?.trim()) {
        textParts.push(result.message.trim())
      }
    }

    if (type === 'system' || type === 'user') {
      anyRecognized = true
    }
  }

  if (anyRecognized) {
    return textParts.join('\n\n')
  }

  return raw.trim()
}
