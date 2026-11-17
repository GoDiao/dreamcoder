import { browserApi } from '../api/browser'
import type { TranslationKey } from '../i18n'
import { useBrowserStore } from '../stores/browserStore'
import { browserGuestSize, getBrowserGuestContentsId, runDeckCall } from './browserGuests'
import { DECK_VIEWPORT, deckEditingCall, deckModeCall } from './deckBridge'
import { formatBytes } from './formatBytes'
import { exportBrowserPage } from './shell'
import type { BrowserExportFormat, BrowserExportMessages, BrowserExportResult, BrowserExportViewport } from './shell/electronBridge'

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const FAILURE_KEYS = {
  entry: 'artifactExport.failed.entry',
  asset: 'artifactExport.failed.asset',
  total: 'artifactExport.failed.total',
  pageTooTall: 'artifactExport.failed.pageTooTall',
} as const

export function exportDialogMessages(t: Translate): BrowserExportMessages {
  return {
    externalLinks: t('artifactExport.externalLinks', { count: '{count}' }),
    proceed: t('artifactExport.proceed'),
    cancel: t('common.cancel'),
  }
}

function pngViewport(tabId: string, deck: boolean): BrowserExportViewport {
  if (deck) return DECK_VIEWPORT
  const size = browserGuestSize(tabId)
  if (!size) throw new Error('The page is not shown yet')
  return { ...size, wholePage: true }
}

export async function exportArtifactPage(input: {
  tabId: string
  sessionId: string | null
  format: BrowserExportFormat
  title: string
  messages: BrowserExportMessages
}): Promise<BrowserExportResult> {
  const webContentsId = getBrowserGuestContentsId(input.tabId)
  if (webContentsId === null) throw new Error('The page is not loaded yet')
  const deck = useBrowserStore.getState().pageByTab[input.tabId]?.deck != null
  if (deck && input.format === 'html') {
    await runDeckCall(input.tabId, deckEditingCall(false))
    await runDeckCall(input.tabId, deckModeCall('browse'))
  }
  const emulationSessionId = input.format === 'pdf' ? input.sessionId : null
  if (emulationSessionId) await browserApi.suspendEmulation(emulationSessionId, input.tabId)
  try {
    return await exportBrowserPage({
      webContentsId,
      format: input.format,
      suggestedName: input.title,
      messages: input.messages,
      ...(input.format === 'png' && { viewport: pngViewport(input.tabId, deck) }),
    })
  } finally {
    if (emulationSessionId) {
      await browserApi.resumeEmulation(emulationSessionId, input.tabId).catch((error: unknown) => {
        console.warn('[artifacts] Failed to restore the emulated view after exporting', error)
      })
    }
  }
}

export function describeExportResult(t: Translate, result: BrowserExportResult): { kind: 'success' | 'error'; message: string } | null {
  if (result.status === 'cancelled') return null
  if (result.status === 'saved') return { kind: 'success', message: t('artifactExport.saved', { path: result.path }) }
  if (result.reason === 'pageTooTall') return { kind: 'error', message: t(FAILURE_KEYS.pageTooTall, { limit: String(result.maxHeight) }) }
  const items = result.items.map((item) => `${item.url} (${formatBytes(item.bytes)})`).join(', ')
  return { kind: 'error', message: t(FAILURE_KEYS[result.reason], { limit: formatBytes(result.limitBytes), items }) }
}
