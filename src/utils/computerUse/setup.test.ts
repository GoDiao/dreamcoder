import { describe, expect, it } from 'bun:test'
import tools from './fixtures/cua-driver-0.34.0-tools.json'
import { CUA_READONLY_TOOLS, setupCuaDriverMCP } from './setup.js'

const PRIVACY_ENV = {
  DO_NOT_TRACK: '1',
  CUA_TELEMETRY_ENABLED: '0',
  CUA_DRIVER_RS_UPDATE_CHECK: '0',
}

describe('setupCuaDriverMCP', () => {
  it('registers cua-driver as the cua stdio server', () => {
    const { mcpConfig } = setupCuaDriverMCP('/Applications/CuaDriver.app/Contents/MacOS/cua-driver', PRIVACY_ENV)
    expect(mcpConfig).toEqual({
      cua: {
        type: 'stdio',
        command: '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
        args: ['mcp'],
        env: PRIVACY_ENV,
        scope: 'dynamic',
      },
    })
  })

  it('allows exactly the read-only tools', () => {
    const { allowedTools } = setupCuaDriverMCP('/x/cua-driver', PRIVACY_ENV)
    expect(allowedTools).toEqual(CUA_READONLY_TOOLS.map(t => `mcp__cua__${t}`))
    for (const excluded of [
      'clipboard_read',
      'check_for_update',
      'check_permissions',
      'parse_visual_regions',
      'get_window_state',
      'get_desktop_state',
      'click',
      'type_text',
    ]) {
      expect(allowedTools).not.toContain(`mcp__cua__${excluded}`)
    }
  })
})

describe('CUA_READONLY_TOOLS against cua-driver 0.34.0 tools/list', () => {
  const byName = new Map(tools.tools.map(t => [t.name, t]))

  it('names only tools that exist and are annotated read-only', () => {
    for (const name of CUA_READONLY_TOOLS) {
      expect(byName.get(name)?.readOnlyHint).toBe(true)
    }
  })

  it('includes no tool that writes to a path the model chooses', () => {
    const fileParams = /(^|_)(file|path|dir|out)(_|$)|out_file|output_dir/
    for (const name of CUA_READONLY_TOOLS) {
      const params = byName.get(name)?.params ?? []
      expect(params.filter(p => fileParams.test(p))).toEqual([])
    }
  })
})
