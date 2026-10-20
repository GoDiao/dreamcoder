import { isTauriRuntime } from './desktopRuntime'

/**
 * macOS desktop window: the title bar is an overlay, so the traffic lights sit
 * on top of the page's top-left corner (placed by `trafficLightPosition` in
 * tauri.macos.conf.json). The page's title row lines up with them; see
 * `--titlebar-height` and `--traffic-lights-end` in globals.css.
 */
export function isMacOverlayTitlebar(): boolean {
  return isTauriRuntime() && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
}
