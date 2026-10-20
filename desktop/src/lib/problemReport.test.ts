import { describe, expect, it } from 'vitest'
import type { ProblemReport } from '../api/diagnostics'
import { buildBugReportUrl, buildProblemReportText } from './problemReport'

const report: ProblemReport = {
  appVersion: '0.6.0',
  os: { platform: 'darwin', label: 'macOS', release: '25.6.0', arch: 'arm64' },
  provider: 'OpenRouter',
  recentErrors: [
    { timestamp: '2026-10-20T00:01:00.000Z', type: 'api_error', summary: 'Bearer [REDACTED] rejected\n for ~/project' },
  ],
}

describe('problem report', () => {
  it('previews exactly the fields that get copied', () => {
    expect(buildProblemReportText(report)).toBe([
      'DreamCoder version: 0.6.0',
      'OS: macOS 25.6.0 (arm64)',
      'Provider: OpenRouter',
      '',
      'Recent errors (newest first):',
      '- 2026-10-20T00:01:00.000Z api_error: Bearer [REDACTED] rejected for ~/project',
    ].join('\n'))
    expect(buildProblemReportText({ ...report, recentErrors: [] })).toContain('Recent errors: none recorded')
  })

  it('puts only the template and version into the issue URL', () => {
    const url = new URL(buildBugReportUrl(report))
    expect(url.origin + url.pathname).toBe('https://github.com/GoDiao/dreamcoder/issues/new')
    expect([...url.searchParams.keys()]).toEqual(['template', 'version'])
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('0.6.0')
    expect(url.toString()).not.toContain('REDACTED')
    expect(url.toString()).not.toContain('project')
    expect(url.toString()).not.toContain('OpenRouter')
  })

  it('drops a version that is not a plain version string', () => {
    const url = new URL(buildBugReportUrl({ appVersion: '/Users/someone secret' }))
    expect(url.searchParams.has('version')).toBe(false)
  })
})
