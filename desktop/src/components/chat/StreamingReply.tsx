import { memo, useLayoutEffect, useRef } from 'react'
import { useSessionField } from '../../stores/chatStore'
import { AssistantMessage } from './AssistantMessage'

type Props = {
  sessionId: string | null | undefined
  onGrow?: () => void
}

export const StreamingReply = memo(function StreamingReply({ sessionId, onGrow }: Props) {
  const streamingText = useSessionField(sessionId, 'streamingText') ?? ''
  const isStreaming = useSessionField(sessionId, 'chatState') === 'streaming'

  const previousTextRef = useRef(streamingText)

  useLayoutEffect(() => {
    if (previousTextRef.current === streamingText) return
    previousTextRef.current = streamingText
    if (streamingText) onGrow?.()
  }, [onGrow, streamingText])

  if (!streamingText.trim()) return null
  return <AssistantMessage content={streamingText} isStreaming={isStreaming} incremental />
})
