import type { KanbanActor } from '@protocol'
import { Button } from '../shared/ui/button'
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
    <span className="flex flex-col items-start gap-0.5 text-xs">
      {links.map((link) => {
        const target = linkTarget(link, author)
        return target ? (
          <Button
            key={link}
            type="button"
            variant="link"
            size="inline-text"
            onClick={() => openLink(panelId, target, projectRoot)}
            className="max-w-full"
          >
            <span className="truncate font-mono">{link}</span>
          </Button>
        ) : (
          <span key={link} className="truncate font-mono text-xs text-muted-foreground">{link}</span>
        )
      })}
    </span>
  )
}
