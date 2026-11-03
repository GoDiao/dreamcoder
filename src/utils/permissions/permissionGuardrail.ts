import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeProvidersIndex } from '../../server/services/providerRuntimeEnv.js'
import type { SavedDecisionProvider } from '../../server/types/provider.js'
import type { PermissionGuardrailPreset } from '../../types/permissionGuardrail.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getPermissionGuardrailSettings } from '../settings/settings.js'

const MAX_INPUT_CHARS = 1500
const REQUEST_TIMEOUT_MS = 5000
export const PERMISSION_GUARDRAIL_PRIVACY_NOTICE_VERSION = 1

const POLICY =
  'Ask the user first if the call could delete or overwrite data, discard uncommitted work, change system, security, account or permission settings, read, copy or send secrets, credentials or private data, send data to or change remote services, install or run code from untrusted sources, or do something the user did not ask for. Otherwise allow reads, searches, builds, tests and requested edits.'

const CALIBRATED_AUTO_ALLOW_MODELS = new Set<string>()

export type PermissionGuardrailEvaluation = {
  behavior: 'allow' | 'ask'
  providerId: string
  modelId: string
  preset: PermissionGuardrailPreset
  score: number | null
}

type PermissionGuardrailInput = {
  toolName: string
  input: Record<string, unknown>
  messages: unknown[]
}

export function isPermissionGuardrailAutoAllowCalibrated(
  provider: SavedDecisionProvider,
  modelId: string,
): boolean {
  return CALIBRATED_AUTO_ALLOW_MODELS.has(`${provider.apiFormat}:${modelId}`)
}

export async function evaluatePermissionGuardrail(
  expectedPreset: PermissionGuardrailPreset,
  value: PermissionGuardrailInput,
): Promise<PermissionGuardrailEvaluation | null> {
  const settings = getPermissionGuardrailSettings()
  if (
    !settings?.enabled ||
    settings.preset !== expectedPreset ||
    !settings.providerId ||
    !settings.modelId
  ) {
    return null
  }

  const provider = readDecisionProvider(settings.providerId)
  if (!provider || !provider.models.some((model) => model.id === settings.modelId)) {
    return fallback(settings.providerId, settings.modelId, expectedPreset)
  }
  if (
    provider.deployment === 'hosted' &&
    settings.privacyNoticeVersion < PERMISSION_GUARDRAIL_PRIVACY_NOTICE_VERSION
  ) {
    return fallback(provider.id, settings.modelId, expectedPreset)
  }
  if (!provider.apiKey && provider.apiFormat !== 'ollama_chat') {
    return fallback(provider.id, settings.modelId, expectedPreset)
  }
  let input: string
  try {
    input = renderInput(value)
  } catch {
    return fallback(provider.id, settings.modelId, expectedPreset)
  }

  const score = await requestAskProbability(provider, settings.modelId, input)
  if (score === null) return fallback(provider.id, settings.modelId, expectedPreset)

  const behavior = resolvePermissionGuardrailProviderBehavior(
    provider,
    settings.modelId,
    expectedPreset,
    score,
    settings.threshold,
  )

  return {
    behavior,
    providerId: provider.id,
    modelId: settings.modelId,
    preset: expectedPreset,
    score,
  }
}

export function resolvePermissionGuardrailProviderBehavior(
  provider: SavedDecisionProvider,
  modelId: string,
  preset: PermissionGuardrailPreset,
  pAsk: number,
  threshold: number,
): 'allow' | 'ask' {
  if (
    preset === 'fewerPrompts' &&
    !isPermissionGuardrailAutoAllowCalibrated(provider, modelId)
  ) {
    return 'ask'
  }
  return resolvePermissionGuardrailBehavior(preset, pAsk, threshold)
}

export function resolvePermissionGuardrailBehavior(
  preset: PermissionGuardrailPreset,
  pAsk: number,
  threshold: number,
): 'allow' | 'ask' {
  return preset === 'fewerPrompts'
    ? 1 - pAsk >= threshold ? 'allow' : 'ask'
    : pAsk >= threshold ? 'ask' : 'allow'
}

function fallback(
  providerId: string,
  modelId: string,
  preset: PermissionGuardrailPreset,
): PermissionGuardrailEvaluation {
  return { behavior: 'ask', providerId, modelId, preset, score: null }
}

function readDecisionProvider(id: string): SavedDecisionProvider | null {
  try {
    const path = join(getClaudeConfigHomeDir(), 'dreamcoder', 'providers.json')
    const index = normalizeProvidersIndex(JSON.parse(readFileSync(path, 'utf-8')))
    return index?.decisionProviders.find((provider) => provider.id === id) ?? null
  } catch {
    return null
  }
}

function renderInput(value: PermissionGuardrailInput): string {
  const userRequest = findLatestUserText(value.messages)
  const text = [
    `User request:\n${userRequest || '(not available)'}`,
    `Tool call to decide on:\n${value.toolName} ${JSON.stringify(value.input)}`,
    `Working directory: ${process.cwd()}`,
  ].join('\n\n')
  return clipMiddle(text, MAX_INPUT_CHARS).toWellFormed()
}

function findLatestUserText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const entry = asRecord(messages[index])
    const message = asRecord(entry?.message) ?? entry
    if (message?.role !== 'user') continue
    const content = message.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) continue
    const text = content
      .flatMap((block): string[] => {
        const record = asRecord(block)
        return record?.type === 'text' && typeof record.text === 'string'
          ? [record.text]
          : []
      })
      .join('\n')
    if (text) return text
  }
  return ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const marker = ` [... ${text.length - max} chars cut ...] `
  const keep = Math.max(0, max - marker.length)
  const head = Math.ceil(keep * 0.7)
  return text.slice(0, head) + marker + text.slice(text.length - (keep - head))
}

async function requestAskProbability(
  provider: SavedDecisionProvider,
  modelId: string,
  input: string,
): Promise<number | null> {
  try {
    const response = await fetch(requestEndpoint(provider), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody(provider, modelId, input)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return parsePermissionGuardrailAskProbability(provider, await response.json())
  } catch {
    return null
  }
}

function requestEndpoint(provider: SavedDecisionProvider): string {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  if (provider.apiFormat === 'ollama_chat') return `${baseUrl}/api/chat`
  if (provider.apiFormat === 'openai_chat') return `${baseUrl}/chat/completions`
  return `${baseUrl}/decisions`
}

function requestBody(
  provider: SavedDecisionProvider,
  modelId: string,
  input: string,
): Record<string, unknown> {
  const instructions = `Should the agent ask the user before running this tool call?\n\nPolicy: ${POLICY}`
  if (provider.apiFormat === 'openai_decisions') {
    return {
      model: modelId,
      input,
      questions: [{ type: 'predicate', name: 'ask', instructions }],
    }
  }
  if (provider.apiFormat === 'openrouter_decisions') {
    return {
      model: modelId,
      state: { situation: input },
      questions: {
        ask: {
          type: 'noul',
          instructions,
          criteria: {
            true: 'Ask the user first.',
            false: 'Run it without asking.',
          },
        },
      },
    }
  }
  const prompt = `Policy: ${POLICY}\n\n${input}\n\nReturn JSON with an integer risk from 0 to 100.`
  if (provider.apiFormat === 'ollama_chat') {
    return {
      model: modelId,
      stream: false,
      format: {
        type: 'object',
        properties: { risk: { type: 'integer', minimum: 0, maximum: 100 } },
        required: ['risk'],
      },
      messages: [{ role: 'user', content: prompt }],
    }
  }
  return {
    model: modelId,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  }
}

export function parsePermissionGuardrailAskProbability(
  provider: SavedDecisionProvider,
  payload: unknown,
): number | null {
  const record = asRecord(payload)
  if (!record) return null
  if (provider.apiFormat === 'openai_decisions') {
    const answers = Array.isArray(record.answers) ? record.answers : []
    const answer = answers.map(asRecord).find((value) => value?.name === 'ask')
    return probability(answer?.probability)
  }
  if (provider.apiFormat === 'openrouter_decisions') {
    const answers = asRecord(record.answers)
    return probability(asRecord(answers?.ask)?.noul)
  }
  const content = provider.apiFormat === 'ollama_chat'
    ? asRecord(record.message)?.content
    : asRecord((Array.isArray(record.choices) ? asRecord(record.choices[0]) : null)?.message)?.content
  if (typeof content !== 'string') return null
  try {
    const risk = asRecord(JSON.parse(content))?.risk
    return typeof risk === 'number' && risk >= 0 && risk <= 100 ? risk / 100 : null
  } catch {
    return null
  }
}

function probability(value: unknown): number | null {
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : null
}
