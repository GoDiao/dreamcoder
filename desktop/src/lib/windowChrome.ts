import { isDesktopRuntime } from './desktopRuntime'

/**
 * macOS desktop window: the title bar is an overlay, so the traffic lights sit
 * on top of the page's top-left corner (placed by `trafficLightPosition` in
 * desktop/electron/main.ts). The page's title row lines up with them; see
 * `--titlebar-height` and `--traffic-lights-end` in globals.css.
 */
export function isMacOverlayTitlebar(): boolean {
  return isDesktopRuntime() && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
}
