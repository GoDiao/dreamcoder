import type { ReactNode } from 'react'
import { useOverlayReturnFocus } from '../../hooks/useOverlayReturnFocus'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog'
import { Spinner } from './ui/spinner'

type ConfirmDialogProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  body: ReactNode
  confirmLabel: string
  cancelLabel: string
  confirmVariant?: 'default' | 'destructive'
  loading?: boolean
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, cancelLabel, confirmVariant = 'destructive', loading = false }: ConfirmDialogProps) {
  const focus = useOverlayReturnFocus()
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !loading) onClose() }}>
      <AlertDialogContent {...focus} onEscapeKeyDown={(event) => { if (loading) event.preventDefault() }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild><div>{body}</div></AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant={confirmVariant} disabled={loading} aria-busy={loading || undefined} onClick={(event) => { event.preventDefault(); void onConfirm() }}>{loading && <Spinner data-icon="inline-start" aria-hidden="true" />}{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
