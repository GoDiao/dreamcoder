import { memo } from 'react'
import { MarkdownRenderer, StreamingMarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MessageActionBar, type MessageBranchAction } from './MessageActionBar'
import { InlineImageGallery } from './InlineImageGallery'

type Props = {
  content: string
  isStreaming?: boolean
  incremental?: boolean
  branchAction?: MessageBranchAction
  /** The reply's actions, shown under its last text: copy takes the whole reply. Omitted on earlier texts. */
  replyCopyText?: string
}

export const AssistantMessage = memo(function AssistantMessage({ content, isStreaming, incremental, branchAction, replyCopyText }: Props) {
  if (!content.trim()) return null

  const documentLayout = shouldUseDocumentLayout(content)

  return (
    <div className="group mb-5 flex justify-start">
      <div
        data-message-shell="assistant"
        data-layout={documentLayout ? 'document' : 'plain'}
        className="flex w-full min-w-0 max-w-full flex-col items-start gap-1.5"
      >
        <div className="w-full min-w-0 text-ui-message leading-[1.75] text-[var(--color-text-primary)]">
          {incremental ? (
            <StreamingMarkdownRenderer
              content={content}
              variant={documentLayout ? 'document' : 'default'}
              className={MESSAGE_PROSE_CLASSES}
            />
          ) : (
            <MarkdownRenderer
              content={content}
              variant={documentLayout ? 'document' : 'default'}
              className={MESSAGE_PROSE_CLASSES}
            />
          )}
          {!isStreaming && <InlineImageGallery text={content} />}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-shimmer bg-[var(--color-brand)] align-text-bottom" />
          )}
        </div>

        {replyCopyText !== undefined ? (
          <MessageActionBar
            copyText={isStreaming ? undefined : replyCopyText}
            copyLabel="Copy reply"
            branchAction={branchAction}
            align="start"
          />
        ) : null}
      </div>
    </div>
  )
})

/** Replies read as plain text at message size, without a card around them. */
const MESSAGE_PROSE_CLASSES = '!text-ui-message !leading-[1.75] prose-p:!text-ui-message prose-p:!leading-[1.75] prose-li:!text-ui-message'

function shouldUseDocumentLayout(content: string) {
  const normalized = content.trim()
  if (!normalized) return false

  if (/```/.test(normalized)) return true
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(normalized)) return true

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  return paragraphs.length >= 2 || normalized.split('\n').filter((line) => line.trim()).length >= 8
}
