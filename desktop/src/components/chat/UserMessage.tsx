import { memo } from 'react'
import type { UIAttachment } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { MessageActionBar, type MessageBranchAction } from './MessageActionBar'

type Props = {
  content: string
  attachments?: UIAttachment[]
  branchAction?: MessageBranchAction
}

export const UserMessage = memo(function UserMessage({ content, attachments, branchAction }: Props) {
  const hasText = content.trim().length > 0

  return (
    <div className="group mb-5 flex justify-end">
      <div
        data-message-shell="user"
        className="flex min-w-0 w-full max-w-[82%] flex-col items-end gap-2 sm:max-w-[78%] lg:max-w-[72%]"
      >
        {attachments && attachments.length > 0 && (
          <AttachmentGallery attachments={attachments} variant="message" />
        )}

        {hasText && (
          <div
            className="min-w-0 max-w-full bg-[var(--color-surface-user-msg)] px-4 py-3 text-sm leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words rounded-[18px] rounded-tr-[4px] rounded-br-[18px] rounded-bl-[18px]"
          >
            {content}
          </div>
        )}

        {hasText && (
          <MessageActionBar
            copyText={content}
            copyLabel="Copy prompt"
            branchAction={branchAction}
            align="end"
          />
        )}
      </div>
    </div>
  )
})
