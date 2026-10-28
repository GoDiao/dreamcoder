import { useTranslation } from '../../i18n'
import { memo } from 'react'
import type { UIAttachment } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { MessageActionBar, type MessageBranchAction } from './MessageActionBar'

type Props = {
  content: string
  attachments?: UIAttachment[]
  branchAction?: MessageBranchAction
  timestamp?: number
}

export const UserMessage = memo(function UserMessage({ content, attachments, branchAction, timestamp }: Props) {
  const t = useTranslation()
  const hasText = content.trim().length > 0

  return (
    <div className="group mb-5 flex w-full min-w-0 flex-row-reverse">
      <div
        data-message-shell="user"
        className="flex min-w-0 w-full max-w-[82%] flex-col items-end gap-2 wrap-break-word sm:max-w-[78%] lg:max-w-[72%]"
      >
        {attachments && attachments.length > 0 && (
          <AttachmentGallery attachments={attachments} variant="message" />
        )}

        {hasText && (
          <div className="w-fit max-w-full min-w-0 self-end overflow-hidden rounded-xl rounded-br-sm border border-transparent bg-[var(--color-surface-user-msg)] px-4 py-2.5 text-ui-body leading-[1.7] text-[var(--color-text-primary)] whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word]">
            {content}
          </div>
        )}

        {hasText && (
          <MessageActionBar
            copyText={content}
            copyLabel={t('chat.copyPrompt')}
            branchAction={branchAction}
            align="end"
            timestamp={timestamp}
          />
        )}
      </div>
    </div>
  )
})
