import { api } from './client'

export type DiagnosticSeverity = 'debug' | 'info' | 'warn' | 'error'

export type DiagnosticEvent = {
  id: string
  timestamp: string
  type: string
  severity: DiagnosticSeverity
  summary: string
  sessionId?: string
  details?: unknown
}

export type DiagnosticEventInput = {
  type: string
  severity?: DiagnosticSeverity
  summary: string
  sessionId?: string
  details?: unknown
}

export type DiagnosticsStatus = {
  logDir: string
  diagnosticsPath: string
  cliDiagnosticsPath: string
  runtimeErrorsPath: string
  exportDir: string
  retentionDays: number
  maxBytes: number
  totalBytes: number
  eventCount: number
  recentErrorCount: number
  lastEventAt: string | null
}

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
  getStatus: () => api.get<DiagnosticsStatus>('/api/diagnostics/status'),
  getEvents: (limit = 100) => api.get<{ events: DiagnosticEvent[] }>(`/api/diagnostics/events?limit=${limit}`),
  recordEvent: (event: DiagnosticEventInput) => api.post<{ ok: true }>('/api/diagnostics/events', event, { timeout: 5_000 }),
  exportBundle: () => api.post<{ bundle: DiagnosticsBundle }>('/api/diagnostics/export', undefined, { timeout: 60_000 }),
  openLogDir: () => api.post<{ ok: true }>('/api/diagnostics/open-log-dir'),
  clear: () => api.delete<{ ok: true }>('/api/diagnostics'),
}
