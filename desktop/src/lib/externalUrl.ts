import { isTauriRuntime } from './desktopRuntime'
import { openExternalLink } from './shell'

export function openExternalUrl(url: string): void {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  void openExternalLink(url)
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}
