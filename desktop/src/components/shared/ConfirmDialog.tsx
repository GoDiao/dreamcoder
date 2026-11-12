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
  confirmDisabled?: boolean
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, cancelLabel, confirmVariant = 'destructive', loading = false, confirmDisabled = false }: ConfirmDialogProps) {
  const focus = useOverlayReturnFocus()
  const focusField = (event: Event) => {
    focus.onOpenAutoFocus()
    const field = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])')
    if (!field) return
    event.preventDefault()
    field.focus()
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !loading) onClose() }}>
      <AlertDialogContent onOpenAutoFocus={focusField} onCloseAutoFocus={focus.onCloseAutoFocus} onEscapeKeyDown={(event) => { if (loading) event.preventDefault() }}>
        <AlertDialogHeader className="min-w-0">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="min-w-0 w-full" asChild><div>{body}</div></AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant={confirmVariant} disabled={loading || confirmDisabled} aria-busy={loading || undefined} onClick={(event) => { event.preventDefault(); void onConfirm() }}>{loading && <Spinner data-icon="inline-start" aria-hidden="true" />}{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
