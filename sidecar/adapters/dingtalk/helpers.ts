export type DingTalkRobotMessage = {
  msgId?: string
  msgtype?: string
  conversationType?: string
  conversationId?: string
  conversationTitle?: string
  senderStaffId?: string
  senderId?: string
  senderNick?: string
  sessionWebhook?: string
  text?: { content?: string }
  markdown?: { text?: string; title?: string }
  content?: unknown
}

export type DingTalkAttachmentCandidate = {
  kind: 'image' | 'file'
  url?: string
  downloadCode?: string
  fileName?: string
}

export function parseDingTalkPayload(raw: unknown): DingTalkRobotMessage | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as DingTalkRobotMessage
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as DingTalkRobotMessage : null
  } catch {
    return null
  }
}
export function isDingTalkDirectMessage(data: DingTalkRobotMessage): boolean {
  return data.conversationType === '1'
}

export function getDingTalkSenderId(data: DingTalkRobotMessage): string | null {
  const senderId = data.senderStaffId || data.senderId
  return senderId ? String(senderId) : null
}

export function getDingTalkChatId(data: DingTalkRobotMessage): string | null {
  const senderId = getDingTalkSenderId(data)
  if (isDingTalkDirectMessage(data)) {
    return senderId ? `dingtalk:dm:${senderId}` : null
  }
  return data.conversationId ? `dingtalk:group:${data.conversationId}` : null
}

export function extractDingTalkText(data: DingTalkRobotMessage): string {
  if (typeof data.text?.content === 'string') return data.text.content.trim()
  if (typeof data.markdown?.text === 'string') return data.markdown.text.trim()

  const content = resolveContentObject(data.content)
  if (typeof content?.text === 'string') return content.text.trim()
  if (Array.isArray(content?.richText)) {
    return content.richText
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return ''
        const text = (item as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      })
      .join('')
      .trim()
  }

  return ''
}

export function extractDingTalkAttachments(data: DingTalkRobotMessage): DingTalkAttachmentCandidate[] {
  const content = resolveContentObject(data.content)
  const candidates: DingTalkAttachmentCandidate[] = []

  if (data.msgtype === 'picture') {
    const url = stringValue(content?.pictureUrl)
    const downloadCode = stringValue(content?.downloadCode)
    if (url || downloadCode) candidates.push({ kind: 'image', url, downloadCode })
  } else if (data.msgtype === 'file') {
    const downloadCode = stringValue(content?.downloadCode)
    const fileName = stringValue(content?.fileName) || 'dingtalk-file'
    if (downloadCode) candidates.push({ kind: 'file', downloadCode, fileName })
  } else if (data.msgtype === 'richText') {
    const richText = Array.isArray(content?.richText) ? content.richText : []
    for (const item of richText) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const pictureUrl = stringValue(record.pictureUrl)
      const downloadCode = stringValue(record.downloadCode)
      if (pictureUrl || downloadCode) {
        candidates.push({ kind: 'image', url: pictureUrl, downloadCode })
      }
    }
  }

  return candidates
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function resolveContentObject(raw: unknown): Record<string, any> | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as Record<string, any>
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null
  } catch {
    return null
  }
}
