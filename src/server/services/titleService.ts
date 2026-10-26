import { ProviderService } from './providerService.js'
import { SettingsService } from './settingsService.js'
import { sessionService } from './sessionService.js'
import { cleanSessionTitleSource, hasSessionTitleMarkup } from '../../utils/sessionTitleText.js'
import { resolveUpstreamTarget, sendToUpstream } from '../upstream/client.js'

const TITLE_MAX_LEN = 50
const TITLE_MAX_OUTPUT_TOKENS = 100
const TITLE_LOG_EXCERPT_LEN = 200

const TITLE_SYSTEM_PROMPT = `Generate a concise, sentence-case title (3-7 words) that captures the main topic or goal of this coding session. The title should be clear enough that the user recognizes the session in a list. Use sentence case: capitalize only the first word and proper nouns.

Return JSON with a single "title" field.

Good examples:
{"title": "Fix login button on mobile"}
{"title": "Add OAuth authentication"}
{"title": "Debug failing CI tests"}
{"title": "Refactor API client error handling"}

Bad (too vague): {"title": "Code changes"}
Bad (too long): {"title": "Investigate and fix the issue where the login button does not respond on mobile devices"}
Bad (wrong case): {"title": "Fix Login Button On Mobile"}`

export function deriveTitle(raw: string): string | undefined {
  const clean = cleanSessionTitleSource(raw)
  const firstSentence = /^(.*?[.!?。！？])\s/.exec(clean)?.[1] ?? clean
  const flat = firstSentence.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return flat.length > TITLE_MAX_LEN
    ? flat.slice(0, TITLE_MAX_LEN - 1) + '\u2026'
    : flat
}

function excerptForLog(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TITLE_LOG_EXCERPT_LEN ? flat.slice(0, TITLE_LOG_EXCERPT_LEN) + '\u2026' : flat
}

export async function generateTitle(
  conversationText: string,
  providerId?: string | null,
  selectedModel?: string,
  sessionId?: string,
): Promise<string | null> {
  const trimmed = cleanSessionTitleSource(conversationText)
  if (!trimmed) return null

  let loggedProviderId = providerId ?? undefined
  let loggedModel = selectedModel
  const fail = (reason: string): null => {
    console.warn(
      `[Title] No AI title for session ${sessionId ?? 'unknown'} (provider ${loggedProviderId ?? 'none'}, model ${loggedModel ?? 'none'}): ${reason}`,
    )
    return null
  }

  try {
    const providerService = new ProviderService()
    if (providerId === null) return fail('no provider')

    let resolvedProvider = providerId
      ? await providerService.getProvider(providerId)
      : null

    if (!resolvedProvider) {
      const { activeId, providers } = await providerService.listProviders()
      resolvedProvider = activeId
        ? providers.find((provider) => provider.id === activeId) ?? null
        : null
    }

    if (!resolvedProvider) return fail('no provider')
    loggedProviderId = resolvedProvider.id
    const target = resolveUpstreamTarget(resolvedProvider)
    if (!target.baseUrl || (!target.apiKey && target.authStrategy !== 'dual_dummy')) {
      return fail('provider has no base URL or API key')
    }
    const titleModel = resolvedProvider.fastModel || selectedModel || resolvedProvider.models[0]?.id
    loggedModel = titleModel
    if (!titleModel) return fail('no model to use')

    const shouldDisableThinking = await shouldDisableThinkingForTitle()
    const result = await sendToUpstream(target, {
      model: titleModel,
      max_tokens: TITLE_MAX_OUTPUT_TOKENS,
      system: TITLE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed.slice(0, 2000) }],
      ...(shouldDisableThinking && { thinking: { type: 'disabled' } }),
    }, { timeoutMs: 15_000 })

    if (!result.ok) {
      return fail(excerptForLog(result.error))
    }
    if (!('message' in result)) return fail('upstream returned a stream')
    const block = result.message.content.find((b) => b.type === 'text')
    const text = block?.type === 'text' ? block.text : undefined
    if (!text) return fail('no text in reply')

    const title = parseGeneratedTitleText(text)
    return title ?? fail(`reply is not a title: ${excerptForLog(text)}`)
  } catch (error) {
    return fail(`unexpected error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function parseGeneratedTitleText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const parsed = parseTitleFromStructuredText(trimmed)
  if (parsed) return normalizeTitle(parsed)

  if (looksLikeStructuredTitleFragment(trimmed)) return null

  return normalizeTitle(trimmed)
}

function parseTitleFromStructuredText(text: string): string | null {
  const candidates = new Set<string>([text])
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim()
  if (fenced) candidates.add(fenced)

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(text.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of [...candidates]) {
    const unescaped = candidate.replace(/\\"/g, '"').replace(/\\n/g, '\n')
    if (unescaped !== candidate) candidates.add(unescaped)
  }

  for (const candidate of candidates) {
    const title = parseTitleJson(candidate)
    if (title) return title
  }

  return null
}

function parseTitleJson(candidate: string): string | null {
  try {
    const parsed = JSON.parse(candidate)
    if (typeof parsed === 'string') {
      return parseTitleFromStructuredText(parsed)
    }
    if (parsed && typeof parsed === 'object' && typeof (parsed as { title?: unknown }).title === 'string') {
      return (parsed as { title: string }).title
    }
  } catch {
    return null
  }
  return null
}

function normalizeTitle(title: string): string | null {
  const clean = cleanSessionTitleSource(title)
  if (
    !clean ||
    clean.length > 60 ||
    looksLikeStructuredTitleFragment(clean) ||
    hasSessionTitleMarkup(clean)
  ) return null
  return clean
}

function looksLikeStructuredTitleFragment(text: string): boolean {
  return (
    text.includes('```') ||
    text.includes('{') ||
    text.includes('}') ||
    /\\?"title\\?"\s*:/.test(text)
  )
}

async function shouldDisableThinkingForTitle(): Promise<boolean> {
  const settings = await new SettingsService().getUserSettings()
  return settings.alwaysThinkingEnabled === false
}

export async function saveAiTitle(sessionId: string, title: string): Promise<boolean> {
  if (await sessionService.getCustomTitle(sessionId)) {
    return false
  }
  await sessionService.appendAiTitle(sessionId, title)
  return true
}
