import type { TranslationKey } from '../i18n/locales/en'

/**
 * Display info for Computer Use tools served by cua-driver.
 *
 * cua-driver is registered in each CLI session as the stdio MCP server `cua`,
 * so its tools arrive as `mcp__cua__<tool>`. This module turns those raw names
 * into user-facing titles, icons, one-line summaries and permission titles.
 *
 * The map follows cua-driver 0.34.0 (`cua-driver describe <tool>`); recheck it
 * when the pinned cua version changes. Unmapped tools fall back to
 * "Computer Use · <tool_name>". Pure: no pid → app-name lookups.
 */

export const CUA_TOOL_PREFIX = 'mcp__cua__'

export type CuaToolIcon = 'pointer' | 'keyboard' | 'screen' | 'app' | 'browser' | 'clipboard' | 'other'

export type CuaToolDisplay = {
  /** Bare cua tool name, e.g. `click`. */
  tool: string
  title: string
  icon: CuaToolIcon
  /** One line built from params; '' when nothing useful. */
  summary: string
  permissionTitle: string
}

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string
type Params = Record<string, unknown>

type ToolSpec = {
  /** Short label key, e.g. "Click" / "点击". */
  label: TranslationKey
  /** Verb phrase key for "Allow Computer Use to {action}?". */
  action: TranslationKey
  icon: CuaToolIcon
  summary?: (p: Params, t: Translate) => string
}

const TEXT_PREVIEW_CHARS = 40

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function truncate(value: string, max = TEXT_PREVIEW_CHARS): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= max ? compact : `${compact.slice(0, max)}…`
}

function quoted(value: unknown): string {
  const text = typeof value === 'string' ? value : ''
  return text ? `"${truncate(text)}"` : ''
}

function point(x: unknown, y: unknown): string {
  const px = num(x)
  const py = num(y)
  return px !== null && py !== null ? `(${px}, ${py})` : ''
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Click-like targets: element token wins over coordinates (cua prefers tokens). */
function pointerTarget(p: Params, t: Translate): string {
  if (str(p.element_token)) return t('cuaTool.summary.element')
  return point(p.x, p.y)
}

function pidSummary(p: Params, t: Translate): string {
  const pid = num(p.pid)
  return pid !== null ? t('cuaTool.summary.pid', { pid }) : ''
}

function appName(p: Params): string {
  return str(p.name) || str(p.bundle_id) || strList(p.urls)[0] || ''
}

function browserTarget(p: Params, t: Translate): string {
  if (str(p.ref)) return t('cuaTool.summary.pageElement', { ref: str(p.ref) })
  return point(p.x, p.y)
}

function joinParts(...parts: string[]): string {
  return parts.filter(Boolean).join(' · ')
}

const TOOL_SPECS: Record<string, ToolSpec> = {
  // Pointer
  click: { label: 'cuaTool.name.click', action: 'cuaTool.action.click', icon: 'pointer', summary: pointerTarget },
  double_click: { label: 'cuaTool.name.double_click', action: 'cuaTool.action.double_click', icon: 'pointer', summary: pointerTarget },
  right_click: { label: 'cuaTool.name.right_click', action: 'cuaTool.action.right_click', icon: 'pointer', summary: pointerTarget },
  drag: {
    label: 'cuaTool.name.drag',
    action: 'cuaTool.action.drag',
    icon: 'pointer',
    summary: (p) => {
      const from = point(p.from_x, p.from_y)
      const to = point(p.to_x, p.to_y)
      return from && to ? `${from} → ${to}` : from || to
    },
  },
  scroll: {
    label: 'cuaTool.name.scroll',
    action: 'cuaTool.action.scroll',
    icon: 'pointer',
    summary: (p) => {
      const direction = str(p.direction)
      const amount = num(p.amount)
      return joinParts(direction && amount !== null ? `${direction} × ${amount}` : direction, point(p.x, p.y))
    },
  },
  move_cursor: { label: 'cuaTool.name.move_cursor', action: 'cuaTool.action.move_cursor', icon: 'pointer', summary: (p) => point(p.x, p.y) },

  // Keyboard
  type_text: { label: 'cuaTool.name.type_text', action: 'cuaTool.action.type_text', icon: 'keyboard', summary: (p) => quoted(p.text) },
  press_key: {
    label: 'cuaTool.name.press_key',
    action: 'cuaTool.action.press_key',
    icon: 'keyboard',
    summary: (p) => [...strList(p.modifiers), str(p.key)].filter(Boolean).join('+'),
  },
  hotkey: { label: 'cuaTool.name.hotkey', action: 'cuaTool.action.hotkey', icon: 'keyboard', summary: (p) => strList(p.keys).join('+') },
  set_value: { label: 'cuaTool.name.set_value', action: 'cuaTool.action.set_value', icon: 'keyboard', summary: (p) => quoted(p.value) },

  // Reading the screen
  get_window_state: {
    label: 'cuaTool.name.get_window_state',
    action: 'cuaTool.action.get_window_state',
    icon: 'screen',
    summary: (p, t) => (str(p.query) ? quoted(p.query) : pidSummary(p, t)),
  },
  get_desktop_state: { label: 'cuaTool.name.get_desktop_state', action: 'cuaTool.action.get_desktop_state', icon: 'screen' },
  zoom: {
    label: 'cuaTool.name.zoom',
    action: 'cuaTool.action.zoom',
    icon: 'screen',
    summary: (p) => {
      const from = point(p.x1, p.y1)
      const to = point(p.x2, p.y2)
      return from && to ? `${from} – ${to}` : ''
    },
  },
  list_windows: { label: 'cuaTool.name.list_windows', action: 'cuaTool.action.list_windows', icon: 'screen', summary: pidSummary },
  get_accessibility_tree: { label: 'cuaTool.name.get_accessibility_tree', action: 'cuaTool.action.get_accessibility_tree', icon: 'screen' },
  get_screen_size: { label: 'cuaTool.name.get_screen_size', action: 'cuaTool.action.get_screen_size', icon: 'screen' },
  get_cursor_position: { label: 'cuaTool.name.get_cursor_position', action: 'cuaTool.action.get_cursor_position', icon: 'screen' },

  // Apps and windows
  list_apps: { label: 'cuaTool.name.list_apps', action: 'cuaTool.action.list_apps', icon: 'app' },
  launch_app: { label: 'cuaTool.name.launch_app', action: 'cuaTool.action.launch_app', icon: 'app', summary: (p) => appName(p) },
  kill_app: { label: 'cuaTool.name.kill_app', action: 'cuaTool.action.kill_app', icon: 'app', summary: pidSummary },
  bring_to_front: { label: 'cuaTool.name.bring_to_front', action: 'cuaTool.action.bring_to_front', icon: 'app', summary: pidSummary },
  set_window_frame: {
    label: 'cuaTool.name.set_window_frame',
    action: 'cuaTool.action.set_window_frame',
    icon: 'app',
    summary: (p) => {
      const w = num(p.width)
      const h = num(p.height)
      return joinParts(point(p.x, p.y), w !== null && h !== null ? `${w}×${h}` : '')
    },
  },
  invoke_menu: { label: 'cuaTool.name.invoke_menu', action: 'cuaTool.action.invoke_menu', icon: 'app', summary: (p) => strList(p.path).join(' › ') },

  // Clipboard
  clipboard_read: { label: 'cuaTool.name.clipboard_read', action: 'cuaTool.action.clipboard_read', icon: 'clipboard' },
  clipboard_write: {
    label: 'cuaTool.name.clipboard_write',
    action: 'cuaTool.action.clipboard_write',
    icon: 'clipboard',
    summary: (p) => quoted(p.text) || basename(str(p.image_path) || str(p.file_path)),
  },

  // Browser
  browser_navigate: { label: 'cuaTool.name.browser_navigate', action: 'cuaTool.action.browser_navigate', icon: 'browser', summary: (p) => str(p.url) },
  browser_click: { label: 'cuaTool.name.browser_click', action: 'cuaTool.action.browser_click', icon: 'browser', summary: browserTarget },
  browser_type: {
    label: 'cuaTool.name.browser_type',
    action: 'cuaTool.action.browser_type',
    icon: 'browser',
    summary: (p, t) => joinParts(quoted(p.text), str(p.ref) ? t('cuaTool.summary.pageElement', { ref: str(p.ref) }) : ''),
  },
  browser_pointer: {
    label: 'cuaTool.name.browser_pointer',
    action: 'cuaTool.action.browser_pointer',
    icon: 'browser',
    summary: (p, t) => joinParts(str(p.action), browserTarget(p, t)),
  },
  browser_dialog: { label: 'cuaTool.name.browser_dialog', action: 'cuaTool.action.browser_dialog', icon: 'browser', summary: (p) => str(p.action) },
  browser_set_input_files: {
    label: 'cuaTool.name.browser_set_input_files',
    action: 'cuaTool.action.browser_set_input_files',
    icon: 'browser',
    summary: (p) => strList(p.files).map(basename).join(', '),
  },
  browser_download: { label: 'cuaTool.name.browser_download', action: 'cuaTool.action.browser_download', icon: 'browser', summary: browserTarget },
  browser_prepare: { label: 'cuaTool.name.browser_prepare', action: 'cuaTool.action.browser_prepare', icon: 'browser' },
  get_browser_state: {
    label: 'cuaTool.name.get_browser_state',
    action: 'cuaTool.action.get_browser_state',
    icon: 'browser',
    summary: (p) => quoted(p.query),
  },
  page: {
    label: 'cuaTool.name.page',
    action: 'cuaTool.action.page',
    icon: 'browser',
    summary: (p) => joinParts(str(p.action), str(p.css_selector) || str(p.selector) || str(p.target_url_contains)),
  },

  check_permissions: { label: 'cuaTool.name.check_permissions', action: 'cuaTool.action.check_permissions', icon: 'other' },
}

/** Fallback summary for unmapped tools: params as-is, compacted to one line. */
function rawParamsSummary(p: Params): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(p)) {
    if (key === 'session' || value === undefined || value === null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${typeof value === 'string' ? truncate(value, 24) : String(value)}`)
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length}]`)
    }
  }
  return truncate(parts.join(' '), 60)
}

export function isCuaTool(toolName: unknown): toolName is string {
  return typeof toolName === 'string' && toolName.startsWith(CUA_TOOL_PREFIX) && toolName.length > CUA_TOOL_PREFIX.length
}

export function getCuaToolDisplay(toolName: string, input: unknown, t: Translate): CuaToolDisplay | null {
  if (!isCuaTool(toolName)) return null
  const tool = toolName.slice(CUA_TOOL_PREFIX.length)
  const params: Params = input && typeof input === 'object' && !Array.isArray(input) ? (input as Params) : {}
  const spec = Object.prototype.hasOwnProperty.call(TOOL_SPECS, tool) ? TOOL_SPECS[tool] : undefined

  if (!spec) {
    return {
      tool,
      title: t('cuaTool.title', { action: tool }),
      icon: 'other',
      summary: safe(() => rawParamsSummary(params)),
      permissionTitle: t('cuaTool.permission.generic', { tool }),
    }
  }

  const summary = spec.summary ? safe(() => spec.summary!(params, t)) : ''
  const app = tool === 'launch_app' ? safe(() => appName(params)) : ''
  return {
    tool,
    title: t('cuaTool.title', { action: t(spec.label) }),
    icon: spec.icon,
    summary,
    permissionTitle: app
      ? t('cuaTool.permission.launchApp', { app })
      : t('cuaTool.permission.allow', { action: t(spec.action) }),
  }
}

function safe(fn: () => string): string {
  try {
    return fn() || ''
  } catch {
    return ''
  }
}

// cua-driver 0.34.0 reports missing macOS grants in its error text (e.g.
// "Screen Recording is NOT granted", "run `cua-driver permissions grant`").
const OS_PERMISSION_ERROR = /accessibility|screen recording|permissions grant|\btcc\b|not granted|permission_required/i
// DreamCoder's own "you haven't granted it yet" rejection is a session prompt, not an OS grant.
const SESSION_PERMISSION_REJECTION = /requested permissions? to use/i

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(chunk => (typeof chunk === 'string' ? chunk : (chunk as { text?: unknown })?.text))
      .filter((text): text is string => typeof text === 'string')
      .join('\n')
  }
  return ''
}

/** True when a cua tool failed because the system permissions are missing. */
export function isCuaPermissionError(
  toolName: string,
  result: { content: unknown; isError: boolean } | null | undefined,
): boolean {
  if (!isCuaTool(toolName) || !result?.isError) return false
  const text = resultText(result.content)
  return OS_PERMISSION_ERROR.test(text) && !SESSION_PERMISSION_REJECTION.test(text)
}

