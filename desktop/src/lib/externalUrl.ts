import { isTauriRuntime } from './desktopRuntime'

export function openExternalUrl(url: string): void {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  void import('@tauri-apps/plugin-shell')
    .then((mod) => mod.open(url))
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}
