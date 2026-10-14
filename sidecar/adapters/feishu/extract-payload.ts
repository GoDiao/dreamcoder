export type PendingDownload =
  | { kind: 'image'; fileKey: string; fileName?: string }
  | { kind: 'file'; fileKey: string; fileName?: string }

export interface InboundPayload {
  text: string
  pendingDownloads: PendingDownload[]
}

export function extractInboundPayload(content: string, msgType: string): InboundPayload {
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    return { text: '', pendingDownloads: [] }
  }

  if (msgType === 'text') {
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      pendingDownloads: [],
    }
  }

  if (msgType === 'image') {
    if (typeof parsed.image_key === 'string' && parsed.image_key) {
      return {
        text: '',
        pendingDownloads: [{ kind: 'image', fileKey: parsed.image_key }],
      }
    }
    return { text: '', pendingDownloads: [] }
  }

  if (msgType === 'file' || msgType === 'file_archive') {
    if (typeof parsed.file_key === 'string' && parsed.file_key) {
      return {
        text: '',
        pendingDownloads: [
          {
            kind: 'file',
            fileKey: parsed.file_key,
            fileName: typeof parsed.file_name === 'string' ? parsed.file_name : undefined,
          },
        ],
      }
    }
    return { text: '', pendingDownloads: [] }
  }

  if (msgType === 'post') {
    const nodes = (parsed.zh_cn?.content ?? parsed.en_us?.content ?? []) as any[]
    const flat = nodes.flat()
    const textParts: string[] = []
    const downloads: PendingDownload[] = []
    for (const node of flat) {
      if (!node || typeof node !== 'object') continue
      if (node.tag === 'text' || node.tag === 'md') {
        const t = node.text ?? node.content ?? ''
        if (typeof t === 'string') textParts.push(t)
      } else if (node.tag === 'img' && typeof node.image_key === 'string') {
        downloads.push({ kind: 'image', fileKey: node.image_key })
      } else if (node.tag === 'file' && typeof node.file_key === 'string') {
        downloads.push({
          kind: 'file',
          fileKey: node.file_key,
          fileName: typeof node.file_name === 'string' ? node.file_name : undefined,
        })
      }
    }
    return { text: textParts.join(''), pendingDownloads: downloads }
  }

  return { text: '', pendingDownloads: [] }
}
