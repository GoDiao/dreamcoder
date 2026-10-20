import type { ProblemReport } from '../api/diagnostics'

export const BUG_REPORT_URL = 'https://github.com/GoDiao/dreamcoder/issues/new'

/** The diagnostics text the dialog previews and copies. It is in English because it goes into a GitHub issue. */
export function buildProblemReportText(report: ProblemReport): string {
  const lines = [
    `DreamCoder version: ${report.appVersion}`,
    `OS: ${report.os.label} ${report.os.release} (${report.os.arch})`,
    `Provider: ${report.provider}`,
    '',
  ]
  if (report.recentErrors.length === 0) {
    lines.push('Recent errors: none recorded')
  } else {
    lines.push('Recent errors (newest first):')
    for (const error of report.recentErrors) {
      lines.push(`- ${error.timestamp} ${error.type}: ${error.summary.replace(/\s+/g, ' ').trim()}`)
    }
  }
  return lines.join('\n')
}

/**
 * The new-issue URL for the bug template. GitHub documents URL prefill for text
 * fields only, so the `os` and `provider` dropdowns are left for the user and the
 * diagnostics never enter the URL.
 */
export function buildBugReportUrl(report: Pick<ProblemReport, 'appVersion'>): string {
  const params = new URLSearchParams({ template: 'bug_report.yml' })
  if (/^[0-9A-Za-z.+-]{1,32}$/.test(report.appVersion)) {
    params.set('version', report.appVersion)
  }
  return `${BUG_REPORT_URL}?${params.toString()}`
}
