import { api } from './client'

export const browserApi = {
  suspendEmulation: (sessionId: string, tabId: string) =>
    api.post<{ changed: boolean }>('/api/browser/emulation/suspend', { sessionId, tabId }),

  resumeEmulation: (sessionId: string, tabId: string) =>
    api.post<{ changed: boolean }>('/api/browser/emulation/resume', { sessionId, tabId }),
}
