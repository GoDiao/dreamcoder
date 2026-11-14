import { api } from './client'

export type DiagnosticsBundle = {
  path: string
  fileName: string
  bytes: number
}

/** What "Report a problem" shows; built and redacted by the server (#132). */
export type ProblemReport = {
  appVersion: string
  os: { platform: string; label: string; release: string; arch: string }
  provider: string
  recentErrors: Array<{ timestamp: string; type: string; summary: string }>
}

export const diagnosticsApi = {
  getProblemReport: () => api.get<ProblemReport>('/api/diagnostics/report'),
  revealExport: (fileName: string) => api.post<{ ok: true }>('/api/diagnostics/reveal-export', { fileName }),
  exportBundle: () => api.post<{ bundle: DiagnosticsBundle }>('/api/diagnostics/export', undefined, { timeout: 60_000 }),
}
