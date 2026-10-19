import { describe, expect, it } from 'vitest'
import { getCuaToolDisplay, isCuaTool } from './cuaToolDisplay'
import { translate } from '../i18n'
import type { TranslationKey } from '../i18n'

const en = (key: TranslationKey, params?: Record<string, string | number>) => translate('en', key, params)
const zh = (key: TranslationKey, params?: Record<string, string | number>) => translate('zh', key, params)

describe('getCuaToolDisplay', () => {
  it('returns null for non-cua tools', () => {
    expect(getCuaToolDisplay('Bash', { command: 'ls' }, en)).toBeNull()
    expect(getCuaToolDisplay('mcp__github__create_issue', {}, en)).toBeNull()
    expect(getCuaToolDisplay('mcp__cua__', {}, en)).toBeNull()
    expect(isCuaTool('mcp__cua__click')).toBe(true)
  })

  it('describes click with coordinates or a UI element', () => {
    const byPoint = getCuaToolDisplay('mcp__cua__click', { pid: 42, x: 120, y: 220 }, en)!
    expect(byPoint).toMatchObject({
      tool: 'click',
      title: 'Computer Use · Click',
      icon: 'pointer',
      summary: '(120, 220)',
      permissionTitle: 'Allow Computer Use to click?',
    })
    const byToken = getCuaToolDisplay('mcp__cua__click', { pid: 42, x: 1, y: 2, element_token: 's0000abcd:3' }, en)!
    expect(byToken.summary).toBe('UI element')
    expect(getCuaToolDisplay('mcp__cua__double_click', { pid: 1, element_token: 's0000abcd:3' }, zh)!.summary).toBe('界面元素')
  })

  it('localizes titles and permission titles in Chinese', () => {
    const display = getCuaToolDisplay('mcp__cua__type_text', { text: 'hello' }, zh)!
    expect(display.title).toBe('Computer Use · 输入文本')
    expect(display.permissionTitle).toBe('允许 Computer Use 输入文本？')
    expect(getCuaToolDisplay('mcp__cua__get_window_state', { pid: 1, window_id: 2 }, zh)!.title).toBe('Computer Use · 读取窗口')
  })

  it('summarizes keyboard tools', () => {
    const long = 'a'.repeat(100)
    const typed = getCuaToolDisplay('mcp__cua__type_text', { text: long }, en)!
    expect(typed.icon).toBe('keyboard')
    expect(typed.summary).toBe(`"${'a'.repeat(40)}…"`)
    expect(getCuaToolDisplay('mcp__cua__press_key', { key: 'return', modifiers: ['cmd'] }, en)!.summary).toBe('cmd+return')
    expect(getCuaToolDisplay('mcp__cua__hotkey', { keys: ['cmd', 'shift', 't'] }, en)!.summary).toBe('cmd+shift+t')
  })

  it('names the app in launch_app permission titles', () => {
    const byName = getCuaToolDisplay('mcp__cua__launch_app', { name: 'Safari' }, en)!
    expect(byName).toMatchObject({ icon: 'app', summary: 'Safari', permissionTitle: 'Allow Computer Use to launch Safari?' })
    const byBundle = getCuaToolDisplay('mcp__cua__launch_app', { bundle_id: 'com.apple.Safari' }, zh)!
    expect(byBundle.permissionTitle).toBe('允许 Computer Use 启动 com.apple.Safari？')
    expect(getCuaToolDisplay('mcp__cua__launch_app', {}, en)!.permissionTitle).toBe('Allow Computer Use to launch an app?')
  })

  it('covers read, scroll, drag, browser and clipboard tools', () => {
    expect(getCuaToolDisplay('mcp__cua__get_desktop_state', {}, en)!.icon).toBe('screen')
    expect(getCuaToolDisplay('mcp__cua__zoom', { window_id: 1, x1: 0, y1: 0, x2: 10, y2: 20 }, en)!.summary).toBe('(0, 0) – (10, 20)')
    expect(getCuaToolDisplay('mcp__cua__scroll', { direction: 'down', amount: 3 }, en)!.summary).toBe('down × 3')
    expect(getCuaToolDisplay('mcp__cua__drag', { from_x: 1, from_y: 2, to_x: 3, to_y: 4 }, en)!.summary).toBe('(1, 2) → (3, 4)')
    const nav = getCuaToolDisplay('mcp__cua__browser_navigate', { url: 'https://example.com', tab_id: 't', target_id: 'x' }, en)!
    expect(nav).toMatchObject({ icon: 'browser', summary: 'https://example.com' })
    expect(getCuaToolDisplay('mcp__cua__browser_click', { ref: 'e12' }, en)!.summary).toBe('page element e12')
    expect(getCuaToolDisplay('mcp__cua__clipboard_write', { text: 'copied' }, en)!).toMatchObject({ icon: 'clipboard', summary: '"copied"' })
    expect(getCuaToolDisplay('mcp__cua__kill_app', { pid: 99 }, en)!.summary).toBe('PID 99')
  })

  it('falls back to the bare tool name for unmapped tools', () => {
    const display = getCuaToolDisplay('mcp__cua__start_recording', { output_dir: '/tmp/rec', session: 's1' }, en)!
    expect(display.title).toBe('Computer Use · start_recording')
    expect(display.icon).toBe('other')
    expect(display.summary).toBe('output_dir=/tmp/rec')
    expect(display.permissionTitle).toBe('Allow Computer Use to run start_recording?')
    expect(JSON.stringify(display)).not.toContain('mcp__')
  })

  it('never throws on missing or malformed input', () => {
    const inputs: unknown[] = [undefined, null, 'str', 42, [], { x: 'a', y: null }, { text: 5 }, { keys: 'cmd' }, { modifiers: [1, null], key: {} }, { name: ['x'] }]
    const tools = ['click', 'type_text', 'press_key', 'hotkey', 'launch_app', 'scroll', 'drag', 'zoom', 'browser_type', 'page', 'invoke_menu', 'clipboard_write', 'unknown_tool']
    for (const tool of tools) {
      for (const input of inputs) {
        const display = getCuaToolDisplay(`mcp__cua__${tool}`, input, en)
        expect(display).not.toBeNull()
        expect(typeof display!.summary).toBe('string')
      }
    }
    expect(getCuaToolDisplay('mcp__cua__click', { x: 'a', y: null }, en)!.summary).toBe('')
  })
})
