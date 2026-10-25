import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(__dirname, 'index.html'), 'utf-8')
const guard = readFileSync(join(__dirname, 'public', 'startup-guard.js'), 'utf-8')

describe('desktop index startup diagnostics', () => {
  it('installs a non-module startup watchdog before the app module loads', () => {
    const watchdogIndex = html.indexOf('<script src="/startup-guard.js"></script>')
    const moduleIndex = html.indexOf('type="module"')

    expect(watchdogIndex).toBeGreaterThan(0)
    expect(moduleIndex).toBeGreaterThan(watchdogIndex)
    expect(guard).toContain('__DREAMCODER_SHOW_STARTUP_ERROR__')
    expect(guard).toContain('__DREAMCODER_BOOTSTRAPPED__')
    expect(guard).toContain('Desktop startup failed')
  })

  it('diagnoses module resource failures and boot timeouts outside React', () => {
    expect(guard).toContain('Startup resource failed to load:')
    expect(guard).toContain('Desktop app did not finish bootstrapping within')
  })

  it('loads every script from a file so the desktop content security policy allows it', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/)
  })
})
