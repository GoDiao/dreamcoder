import React from 'react'
import { rawRecordDiagnosticEvent } from '../api/client'

let installed = false

export function installClientDiagnosticsCapture() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    void reportClientError('client_window_error', event.message || 'Window error', {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: normalizeError(event.error),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    void reportClientError('client_unhandled_rejection', summarizeUnknown(event.reason), {
      reason: normalizeError(event.reason),
    })
  })
}

export function reportReactError(error: unknown, errorInfo: React.ErrorInfo) {
  return reportClientError('client_react_error_boundary', summarizeUnknown(error), {
    error: normalizeError(error),
    componentStack: errorInfo.componentStack,
  })
}

function reportClientError(type: string, summary: string, details: Record<string, unknown>) {
  return rawRecordDiagnosticEvent({
    type,
    severity: 'error',
    summary,
    details: {
      url: window.location.href,
      userAgent: navigator.userAgent,
      ...details,
    },
  })
}

function summarizeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message || value.name
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeError(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  return value
}
