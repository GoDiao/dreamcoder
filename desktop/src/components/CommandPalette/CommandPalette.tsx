import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSessionSearch } from '../../hooks/useSessionSearch'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { SessionListItem } from '../../types/session'

export function CommandPalette() {
  const open = useUIStore((state) => state.activeModal === 'command-palette')
  return open ? <CommandPaletteContent /> : null
}

function CommandPaletteContent() {
  const t = useTranslation()
  const close = useUIStore((state) => state.closeModal)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  const { results, isLoading, error, retry } = useSessionSearch(query)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLLIElement>(null)
  const composingRef = useRef(false)
  const id = useId()
  const index = Math.min(selectedIndex, Math.max(0, results.length - 1))
  const selected = results[index]

  useLayoutEffect(() => {
    const previousFocus = document.activeElement
    inputRef.current?.focus()
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) {
        inputRef.current?.focus()
      }
    }
    document.addEventListener('focusin', keepFocusInside)
    return () => {
      document.removeEventListener('focusin', keepFocusInside)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [index, selected?.id])

  function openSession(session: SessionListItem) {
    // Older matches may not be in the sidebar's first page. Keep their workspace metadata available.
    useSessionStore.setState((state) => ({
      sessions: state.sessions.some((item) => item.id === session.id)
        ? state.sessions.map((item) => item.id === session.id ? { ...item, ...session } : item)
        : [...state.sessions, session],
    }))
    useTabStore.getState().openTab(session.id, session.title)
    useChatStore.getState().connectToSession(session.id)
    close()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    if ((event.metaKey || event.ctrlKey) && (event.key === 'n' || event.key === '.')) {
      event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('input, button')
      if (!focusable?.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    } else if (event.target === inputRef.current) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (results.length) setSelectedIndex((index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (selected) openSession(selected)
      }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onKeyDown={handleKeyDown}>
      <div
        data-testid="command-palette-backdrop"
        className="motion-modal-backdrop absolute inset-0 bg-[var(--color-overlay-scrim)]"
        data-state={visible ? 'open' : 'closed'}
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="motion-modal-panel glass-panel relative flex max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[var(--radius-xl)]"
        data-state={visible ? 'open' : 'closed'}
      >
        <h2 id={`${id}-title`} className="sr-only">{t('commandPalette.title')}</h2>
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-[var(--color-text-tertiary)]">search</span>
          <input
            ref={inputRef}
            role="combobox"
            aria-label={t('commandPalette.placeholder')}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={`${id}-results`}
            aria-activedescendant={selected ? `${id}-option-${index}` : undefined}
            aria-describedby={`${id}-hint`}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('commandPalette.placeholder')}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0) }}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
          <button type="button" onClick={close} aria-label={t('commandPalette.close')} className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-[var(--color-border-focus)]">Esc</button>
        </div>
        <div className="min-h-0 overflow-y-auto p-2">
          <p className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">{t(query.trim() ? 'commandPalette.results' : 'commandPalette.recent')}</p>
          {isLoading && <p role="status" className="p-5 text-sm text-[var(--color-text-secondary)]">{t('commandPalette.loading')}</p>}
          {error && <div role="alert" className="p-5 text-sm text-[var(--color-text-secondary)]">
            <p>{t('commandPalette.loadFailed')}</p>
            <button type="button" onClick={retry} className="mt-3 rounded px-3 py-2 text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">{t('common.retry')}</button>
          </div>}
          {!isLoading && !error && results.length === 0 && <p role="status" className="p-5 text-sm text-[var(--color-text-secondary)]">{t(query.trim() ? 'sidebar.noMatching' : 'sidebar.noSessions')}</p>}
          <ul id={`${id}-results`} role="listbox" aria-label={t('commandPalette.results')} aria-busy={isLoading}>
            {results.map((session, resultIndex) => <li
              key={session.id}
              id={`${id}-option-${resultIndex}`}
              ref={resultIndex === index ? selectedRef : undefined}
              role="option"
              aria-selected={resultIndex === index}
              onMouseMove={() => setSelectedIndex(resultIndex)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openSession(session)}
              className={`cursor-pointer rounded-lg px-3 py-3 ${resultIndex === index ? 'bg-[var(--color-surface-hover)]' : ''}`}
            >
              <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{session.title || t('sidebar.newSession')}</div>
              {session.lastAssistantMessage && <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{session.lastAssistantMessage}</p>}
              {(session.workDir || session.projectPath) && <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{session.workDir || session.projectPath}</p>}
            </li>)}
          </ul>
        </div>
        <p id={`${id}-hint`} className="border-t border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-text-tertiary)]">{t('commandPalette.hint')}</p>
      </div>
    </div>,
    document.body,
  )
}
