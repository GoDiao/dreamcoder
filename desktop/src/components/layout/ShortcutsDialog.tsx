import { Modal } from '../shared/Modal'
import { Kbd } from '../shared/ui/kbd'
import { useTranslation, type TranslationKey } from '../../i18n'

type Shortcut = { keys: string[]; label: TranslationKey }
type ShortcutGroup = { title: TranslationKey; items: Shortcut[] }

/** Mirrors the handlers in hooks/useKeyboardShortcuts.ts, ChatInput and the sidebar batch mode. */
function buildShortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: 'shortcuts.groupGeneral',
      items: [
        { keys: [mod, 'K'], label: 'shortcuts.commandPalette' },
        { keys: [mod, 'N'], label: 'shortcuts.newSession' },
        { keys: [mod, '.'], label: 'shortcuts.stopGeneration' },
        { keys: ['Esc'], label: 'shortcuts.closeDialog' },
      ],
    },
    {
      title: 'shortcuts.groupComposer',
      items: [
        { keys: ['Enter'], label: 'shortcuts.send' },
        { keys: ['Shift', 'Enter'], label: 'shortcuts.newline' },
      ],
    },
    {
      title: 'shortcuts.groupView',
      items: [
        { keys: [mod, '+'], label: 'shortcuts.zoomIn' },
        { keys: [mod, '-'], label: 'shortcuts.zoomOut' },
        { keys: [mod, '0'], label: 'shortcuts.zoomReset' },
      ],
    },
    {
      title: 'shortcuts.groupBatch',
      items: [
        { keys: [mod, 'A'], label: 'shortcuts.batchSelectAll' },
        { keys: ['Esc'], label: 'shortcuts.batchExit' },
      ],
    },
  ]
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslation()
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const groups = buildShortcutGroups(isMac ? '⌘' : 'Ctrl')

  return (
    <Modal open={open} onClose={onClose} title={t('sidebar.shortcuts')} width={460}>
      <div className="space-y-5" data-testid="shortcuts-dialog">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="mb-1 text-ui-aux font-semibold text-[var(--color-text-tertiary)]">{t(group.title)}</h3>
            <dl>
              {group.items.map((item) => (
                <div
                  key={item.label}
                  className="flex min-h-[36px] items-center justify-between gap-4 border-b border-[var(--color-border-separator)] last:border-b-0"
                >
                  <dt className="text-ui-nav text-[var(--color-text-primary)]">{t(item.label)}</dt>
                  <dd className="flex flex-shrink-0 items-center gap-1">
                    {item.keys.map((key) => (
                      <Kbd
                        key={key}
                        className="min-w-[22px]"
                      >
                        {key}
                      </Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
