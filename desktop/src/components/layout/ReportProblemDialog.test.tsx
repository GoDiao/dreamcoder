import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => key,
}))

const mocks = vi.hoisted(() => ({
  getProblemReport: vi.fn(),
  exportBundle: vi.fn(),
  revealExport: vi.fn(),
  copyTextToClipboard: vi.fn(),
  openExternalUrl: vi.fn(),
  addToast: vi.fn(),
}))

vi.mock('../../api/diagnostics', () => ({
  diagnosticsApi: {
    getProblemReport: mocks.getProblemReport,
    exportBundle: mocks.exportBundle,
    revealExport: mocks.revealExport,
  },
}))
vi.mock('../chat/clipboard', () => ({ copyTextToClipboard: mocks.copyTextToClipboard }))
vi.mock('../../lib/externalUrl', () => ({ openExternalUrl: mocks.openExternalUrl }))
vi.mock('../../stores/uiStore', () => ({
  useUIStore: (select: (s: { addToast: typeof mocks.addToast }) => unknown) => select({ addToast: mocks.addToast }),
}))

import { ReportProblemDialog } from './ReportProblemDialog'

const report = {
  appVersion: '0.6.0',
  os: { platform: 'darwin', label: 'macOS', release: '25.6.0', arch: 'arm64' },
  provider: 'OpenRouter',
  recentErrors: [{ timestamp: '2026-10-20T00:00:00.000Z', type: 'api_error', summary: 'Bearer [REDACTED] rejected' }],
}

describe('ReportProblemDialog', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.getProblemReport.mockResolvedValue(report)
    mocks.copyTextToClipboard.mockResolvedValue(true)
  })

  it('copies exactly the text it previews', async () => {
    render(<ReportProblemDialog open onClose={() => {}} />)
    const preview = await screen.findByLabelText('reportProblem.previewLabel')
    await waitFor(() => expect(preview).toHaveTextContent('DreamCoder version: 0.6.0'))

    fireEvent.click(screen.getByRole('button', { name: 'reportProblem.copy' }))
    await waitFor(() => expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(preview.textContent))
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })

  it('opens the bug template with only the version in the link', async () => {
    render(<ReportProblemDialog open onClose={() => {}} />)
    await screen.findByText(/DreamCoder version: 0.6.0/)
    fireEvent.click(screen.getByRole('button', { name: 'reportProblem.openIssue' }))

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      'https://github.com/GoDiao/dreamcoder/issues/new?template=bug_report.yml&version=0.6.0',
    )
  })

  it('exports the full bundle and reveals it', async () => {
    mocks.exportBundle.mockResolvedValue({ bundle: { path: '/x/bundle.json.gz', fileName: 'bundle.json.gz', bytes: 1 } })
    mocks.revealExport.mockResolvedValue({ ok: true })
    render(<ReportProblemDialog open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'reportProblem.exportBundle' }))

    await waitFor(() => expect(mocks.revealExport).toHaveBeenCalledWith('bundle.json.gz'))
  })
})
