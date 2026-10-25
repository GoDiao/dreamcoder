import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { onFileDrop, type FileDropPosition } from '../../lib/shell'
import { isTauriRuntime } from '../../lib/desktopRuntime'
import {
  dataTransferHasFiles,
  dataTransferToComposerAttachments,
  pathsToComposerAttachments,
  type ComposerAttachment,
} from '../../lib/composerAttachments'

type UseComposerFileDropOptions = {
  disabled?: boolean
  panelRef: RefObject<HTMLElement | null>
  onAttachments: (attachments: ComposerAttachment[]) => void
  onError?: (error: unknown) => void
}

function isPointInsideElement(element: HTMLElement | null, position: FileDropPosition): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return (
    position.x >= rect.left &&
    position.x <= rect.right &&
    position.y >= rect.top &&
    position.y <= rect.bottom
  )
}

export function useComposerFileDrop({
  disabled = false,
  panelRef,
  onAttachments,
  onError,
}: UseComposerFileDropOptions) {
  const [isDragActive, setIsDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const disabledRef = useRef(disabled)
  const onAttachmentsRef = useRef(onAttachments)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    onAttachmentsRef.current = onAttachments
  }, [onAttachments])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    if (!isTauriRuntime()) return

    let disposed = false
    let unlisten: (() => void) | undefined

    void onFileDrop((event) => {
      if (disposed) return

      const payload = event.payload
      if (payload.type === 'cancel' || payload.type === 'leave') {
        dragDepthRef.current = 0
        setIsDragActive(false)
        return
      }

      const isInside = isPointInsideElement(panelRef.current, payload.position)
      if (payload.type === 'enter' || payload.type === 'over') {
        setIsDragActive(!disabledRef.current && isInside)
        return
      }

      dragDepthRef.current = 0
      setIsDragActive(false)
      if (disabledRef.current || !isInside) return

      const attachments = pathsToComposerAttachments(payload.paths)
      if (attachments.length > 0) onAttachmentsRef.current(attachments)
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten()
          return
        }
        unlisten = nextUnlisten
      })
      .catch((error) => {
        onErrorRef.current?.(error)
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [panelRef])

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
