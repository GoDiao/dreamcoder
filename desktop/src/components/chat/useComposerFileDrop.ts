import { useCallback, useRef, useState, type DragEvent } from 'react'
import {
  dataTransferHasFiles,
  dataTransferToComposerAttachments,
  type ComposerAttachment,
} from '../../lib/composerAttachments'

type UseComposerFileDropOptions = {
  disabled?: boolean
  onAttachments: (attachments: ComposerAttachment[]) => void
  onError?: (error: unknown) => void
}

export function useComposerFileDrop({
  disabled = false,
  onAttachments,
  onError,
}: UseComposerFileDropOptions) {
  const [isDragActive, setIsDragActive] = useState(false)
  const dragDepthRef = useRef(0)

  const onDragEnter = useCallback((event: DragEvent) => {
    if (disabled || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    dragDepthRef.current += 1
    setIsDragActive(true)
  }, [disabled])

  const onDragOver = useCallback((event: DragEvent) => {
    if (disabled || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragActive(true)
  }, [disabled])

  const onDragLeave = useCallback((event: DragEvent) => {
    if (disabled || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragActive(false)
  }, [disabled])

  const onDrop = useCallback((event: DragEvent) => {
    if (disabled || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragActive(false)

    void dataTransferToComposerAttachments(event.dataTransfer)
      .then((attachments) => {
        if (attachments.length > 0) onAttachments(attachments)
      })
      .catch((error) => {
        onError?.(error)
      })
  }, [disabled, onAttachments, onError])

  return {
    isDragActive,
    dragHandlers: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
}
