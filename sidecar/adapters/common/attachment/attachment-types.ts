import type { AttachmentRef } from '../ws-bridge.js'
export type { AttachmentRef }

export type ImPlatform = 'feishu' | 'telegram' | 'wechat' | 'dingtalk'

export interface LocalAttachment {
  kind: 'image' | 'file'
  name: string
  path: string
  size: number
  mimeType: string
  buffer: Buffer
}

export interface PendingUpload {
  id: string
  source:
    | { kind: 'base64'; data: string; mime: string }
    | { kind: 'path'; path: string; mime?: string }
    | { kind: 'url'; url: string; mime?: string }
  alt?: string
}
