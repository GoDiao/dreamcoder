import type { KanbanActor } from '@protocol'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { linkTarget, type LinkTarget } from './board'

function openLink(panelId: string, target: LinkTarget, projectRoot: string) {
  const panel = useWorkspacePanelStore.getState()
  if (target.kind === 'file') {
    panel.openTab(panelId, { kind: 'file', path: target.path, sessionId: target.sessionId })
    return
  }
  void panel.openUrl(panelId, target.url, projectRoot)
}

export function CardLinks({ panelId, projectRoot, links, author }: { panelId: string; projectRoot: string; links: readonly string[]; author: KanbanActor }) {
  if (!links.length) return null
  return (
    <span className="flex flex-col gap-0.5">
      {links.map((link) => {
        const target = linkTarget(link, author)
        return target ? (
          <button
            key={link}
            type="button"
            onClick={() => openLink(panelId, target, projectRoot)}
            className="truncate text-left font-mono text-[12px] text-[var(--color-brand)] hover:underline"
          >
            {link}
          </button>
        ) : (
          <span key={link} className="truncate font-mono text-[12px] text-[var(--color-text-secondary)]">{link}</span>
        )
      })}
    </span>
  )
}
