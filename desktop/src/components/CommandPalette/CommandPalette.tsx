import { useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import type { SessionListItem } from '../../types/session'
import { useOverlayReturnFocus } from '../../hooks/useOverlayReturnFocus'
import { Dialog, DialogContent, DialogTitle } from '../shared/ui/dialog'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '../shared/ui/command'
import { Button } from '../shared/ui/button'
import { Kbd } from '../shared/ui/kbd'
import { Skeleton } from '../shared/ui/skeleton'
import { useSessionSearch } from '../../hooks/useSessionSearch'

export function CommandPalette() {
  const open = useUIStore((state) => state.activeModal === 'command-palette')
  return open ? <CommandPaletteContent /> : null
}

function CommandPaletteContent() {
  const t = useTranslation()
  const close = useUIStore((state) => state.closeModal)
  const [query, setQuery] = useState('')
  const { results, isLoading, error, retry } = useSessionSearch(query)
  const composing = useRef(false)
  const focus = useOverlayReturnFocus()

  function openSession(session: SessionListItem) {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.some((item) => item.id === session.id)
        ? state.sessions.map((item) => item.id === session.id ? { ...item, ...session } : item)
        : [...state.sessions, session],
    }))
    useTabStore.getState().openTab(session.id, session.title)
    useChatStore.getState().connectToSession(session.id)
    close()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent {...focus} showCloseButton={false} aria-describedby={undefined} onEscapeKeyDown={(event) => {
        if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault()
      }} className="w-full overflow-hidden p-0 sm:max-w-[600px]">
        <DialogTitle className="sr-only">{t('commandPalette.title')}</DialogTitle>
        <Command label={t('commandPalette.placeholder')} shouldFilter={false} loop onKeyDown={(event) => { if (event.key !== 'Tab') event.stopPropagation() }} onKeyDownCapture={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
              event.stopPropagation()
              if (event.key === 'Enter' || event.key === 'Escape') event.preventDefault()
            }
          }
          if ((event.metaKey || event.ctrlKey) && (event.key === 'n' || event.key === '.')) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}>
          <div className="flex items-center gap-2 border-b border-ui-border p-3">
            <div className="min-w-0 flex-1">
              <CommandInput aria-label={t('commandPalette.placeholder')} placeholder={t('commandPalette.placeholder')} value={query} onValueChange={setQuery} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
            </div>
            <Button variant="ghost" size="sm" onClick={close} aria-label={t('commandPalette.close')}><Kbd>Esc</Kbd></Button>
          </div>
          <CommandList aria-label={t('commandPalette.results')} aria-busy={isLoading} className="max-h-[60dvh] p-2">
            {isLoading && <div role="status" aria-label={t('commandPalette.loading')} className="flex flex-col gap-2 p-3"><span className="sr-only">{t('commandPalette.loading')}</span><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
            {error && <div role="alert" className="p-3 text-sm text-ui-muted-foreground"><p>{t('commandPalette.loadFailed')}</p><p className="mt-2 whitespace-pre-wrap break-words">{error.message}</p><Button variant="outline" className="mt-3" onClick={retry}>{t('common.retry')}</Button></div>}
            {!isLoading && !error && results.length === 0 && <p role="status" className="p-3 text-sm text-ui-muted-foreground">{t(query.trim() ? 'sidebar.noMatching' : 'sidebar.noSessions')}</p>}
            <CommandGroup heading={t(query.trim() ? 'commandPalette.results' : 'commandPalette.recent')}>
              {results.map((session) => <CommandItem key={session.id} value={session.id} onSelect={() => openSession(session)} className="block py-3">
                <div className="truncate text-sm font-medium">{session.title || t('sidebar.newSession')}</div>
                {session.lastAssistantMessage && <p className="mt-1 truncate text-xs text-ui-muted-foreground">{session.lastAssistantMessage}</p>}
                {(session.workDir || session.projectPath) && <p className="mt-1 truncate text-xs text-ui-muted-foreground">{session.workDir || session.projectPath}</p>}
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
          <p className="border-t border-ui-border px-4 py-3 text-xs text-ui-muted-foreground">{t('commandPalette.hint')}</p>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
