import * as os from 'node:os'
import { version as packageVersion } from '../../../package.json'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import type { SavedProvider } from '../types/provider.js'
import { diagnosticsService } from './diagnosticsService.js'
import { ProviderService } from './providerService.js'

/**
 * What "Report a problem" shows and lets the user copy (#132). It holds no
 * provider URL, key or name, and every string passes the diagnostics redaction.
 */
export type ProblemReport = {
  appVersion: string
  os: { platform: string; label: string; release: string; arch: string }
  /** Matches an option of the `provider` dropdown in bug_report.yml. */
  provider: string
  recentErrors: Array<{ timestamp: string; type: string; summary: string }>
}

const MAX_ERRORS = 10
const MAX_SUMMARY_LENGTH = 300

/** Hosts we can name without sharing the URL itself. */
const KNOWN_HOSTS: Array<[suffix: string, label: string]> = [
  ['openrouter.ai', 'OpenRouter'],
  ['anthropic.com', 'Anthropic'],
  ['openai.com', 'OpenAI'],
]

export function describeProvider(provider: Pick<SavedProvider, 'presetId' | 'baseUrl' | 'apiFormat'> | null): string {
  if (!provider) return 'Other / N/A'
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === provider.presetId)
  if (preset && preset.id !== 'custom') return preset.name
  let host = ''
  try {
    host = new URL(provider.baseUrl).hostname
  } catch {
    host = ''
  }
  const known = KNOWN_HOSTS.find(([suffix]) => host === suffix || host.endsWith(`.${suffix}`))
  if (known) return known[1]
  return provider.apiFormat === 'anthropic' ? 'Custom (Anthropic-compatible)' : 'Custom (OpenAI-compatible)'
}

/** macOS's product version (os.release() is the Darwin kernel version there). */
function osRelease(): string {
  if (process.platform === 'darwin') {
    try {
      const result = Bun.spawnSync(['sw_vers', '-productVersion'], { stdout: 'pipe', stderr: 'ignore' })
      const version = result.stdout.toString().trim()
      if (result.exitCode === 0 && /^[0-9.]+$/.test(version)) return version
    } catch {
      // Fall back to the kernel version below.
    }
    return `Darwin ${os.release()}`
  }
  return os.release()
}

function describeOs(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

export async function buildProblemReport(
  providerService: Pick<ProviderService, 'listProviders'> = new ProviderService(),
): Promise<ProblemReport> {
  const { providers, activeId } = await providerService.listProviders()
  const active = providers.find((provider) => provider.id === activeId) ?? null
  const events = await diagnosticsService.readRecentEvents(500)
  const recentErrors = events
    .filter((event) => event.severity === 'error' || event.severity === 'warn')
    // readRecentEvents returns the newest first.
    .slice(0, MAX_ERRORS)
    .map((event) => ({
      timestamp: event.timestamp,
      type: diagnosticsService.sanitizeString(event.type, 128),
      // Events are redacted when written; redact again in case an older file was not.
      summary: diagnosticsService.sanitizeString(event.summary, MAX_SUMMARY_LENGTH),
    }))

  return {
    appVersion: process.env.APP_VERSION || packageVersion,
    os: {
      platform: process.platform,
      label: describeOs(process.platform),
      release: osRelease(),
      arch: process.arch,
    },
    provider: describeProvider(active),
    recentErrors,
  }
}
