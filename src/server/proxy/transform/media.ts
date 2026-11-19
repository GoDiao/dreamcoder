import type { ResolvedModelRules } from '../../types/modelRules.js'
import type { AnthropicContentBlock } from './types.js'

type ImageBlock = Extract<AnthropicContentBlock, { type: 'image' }>
type DocumentBlock = Extract<AnthropicContentBlock, { type: 'document' }>

export type MediaPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string }
  | { kind: 'file'; filename: string; fileData: string }

const PDF_MEDIA_TYPE = 'application/pdf'

function imageOmittedText(mediaType: string): string {
  return `[Image omitted (${mediaType}): this model does not accept image input.]`
}

const PDF_OMITTED_TEXT =
  '[PDF omitted: this model does not accept PDF input, so its content was not delivered. Read the file again with the pages parameter to get its pages as images.]'

function imagePart(block: ImageBlock, rules: ResolvedModelRules): MediaPart {
  if (!rules.input.image) return { kind: 'text', text: imageOmittedText(block.source.media_type) }
  return { kind: 'image', url: `data:${block.source.media_type};base64,${block.source.data}` }
}

function documentPart(block: DocumentBlock, rules: ResolvedModelRules): MediaPart {
  const { source } = block
  if (source.type === 'text') return { kind: 'text', text: source.data }
  if (source.type !== 'base64' || source.media_type !== PDF_MEDIA_TYPE) {
    return { kind: 'text', text: `[Document omitted: ${source.type === 'url' ? source.url : source.media_type} cannot be sent to this model.]` }
  }
  if (!rules.input.pdf) return { kind: 'text', text: PDF_OMITTED_TEXT }
  return { kind: 'file', filename: block.title || 'document.pdf', fileData: `data:${PDF_MEDIA_TYPE};base64,${source.data}` }
}

export function mediaPart(block: ImageBlock | DocumentBlock, rules: ResolvedModelRules): MediaPart {
  return block.type === 'image' ? imagePart(block, rules) : documentPart(block, rules)
}

export function toolResultParts(content: string | AnthropicContentBlock[], rules: ResolvedModelRules): MediaPart[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.map((block): MediaPart => {
    switch (block.type) {
      case 'text':
        return { kind: 'text', text: block.text }
      case 'image':
      case 'document':
        return mediaPart(block, rules)
      case 'tool_use':
        return { kind: 'text', text: `[nested tool_use: ${block.name}]` }
      case 'thinking':
        return { kind: 'text', text: '[nested thinking]' }
      default:
        return { kind: 'text', text: `[omitted content: ${(block as { type: string }).type}]` }
    }
  })
}

export function joinText(parts: MediaPart[]): string {
  return parts.flatMap(part => part.kind === 'text' ? [part.text] : []).join('\n')
}
