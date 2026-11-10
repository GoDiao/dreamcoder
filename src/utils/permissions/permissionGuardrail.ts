import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeProvidersIndex } from '../../server/services/providerRuntimeEnv.js'
import type { SavedDecisionProvider } from '../../server/types/provider.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { sideQuery } from '../sideQuery.js'
import { getAutoPermissionSettings } from '../settings/settings.js'

const MAX_INPUT_CHARS = 1500
const REQUEST_TIMEOUT_MS = 5000
export const AUTO_PERMISSION_PRIVACY_NOTICE_VERSION = 1

const POLICY =
  'Ask the user first if the call could delete or overwrite data, discard uncommitted work, change system, security, account or permission settings, read, copy or send secrets, credentials or private data, send data to or change remote services, install or run code from untrusted sources, or do something the user did not ask for. Otherwise allow reads, searches, builds, tests and requested edits.'

const DECISION_POLICIES = new Map([
  ['openai_decisions:gpt-6-luna', { threshold: 0.5, policyVersion: 1 }],
])

const AUTO_PERMISSION_TOOL = {
  name: 'auto_permission_decision',
  description: 'Decide whether the tool call can run or requires user confirmation',
  input_schema: {
    type: 'object' as const,
    properties: {
      behavior: { type: 'string', enum: ['allow', 'ask'] },
      reason: { type: 'string' },
    },
    required: ['behavior', 'reason'],
  },
}

export type AutoPermissionEvaluation = {
  behavior: 'allow' | 'ask'
  providerId: string
  modelId: string
  source: 'decisionProvider' | 'fastModel'
  score: number | null
  policyVersion: number
  reason?: string
}

type AutoPermissionInput = {
  toolName: string
  input: Record<string, unknown>
  messages: unknown[]
  signal?: AbortSignal
}

export function getDecisionPolicy(
  provider: SavedDecisionProvider,
  modelId: string,
): { threshold: number; policyVersion: number } | null {
  return DECISION_POLICIES.get(`${provider.apiFormat}:${modelId}`) ?? null
}

export async function evaluateAutoPermission(
  value: AutoPermissionInput,
): Promise<AutoPermissionEvaluation | null> {
  const settings = getAutoPermissionSettings()
  if (!settings) return null

  if (settings.providerId) {
    return evaluateDecisionProvider(settings, value)
  }

  const providerId = process.env.DREAMCODER_ACTIVE_PROVIDER_ID?.trim()
  const modelId = process.env.DREAMCODER_FAST_MODEL_ID?.trim()
  if (!providerId || !modelId) return null
  if (settings.privacyNoticeVersion < AUTO_PERMISSION_PRIVACY_NOTICE_VERSION) {
    return fallback(providerId, modelId, 'fastModel', 1, 'Privacy confirmation is required')
  }

  return evaluateFastModel(providerId, modelId, value)
}

async function evaluateDecisionProvider(
  settings: { providerId: string | null; modelId: string; privacyNoticeVersion: number },
  value: AutoPermissionInput,
): Promise<AutoPermissionEvaluation> {
  const providerId = settings.providerId ?? ''
  const provider = readDecisionProvider(providerId)
  if (!provider || !provider.models.some((model) => model.id === settings.modelId)) {
    return fallback(providerId, settings.modelId, 'decisionProvider', 0, 'Decision provider or model is unavailable')
  }

  const policy = getDecisionPolicy(provider, settings.modelId)
  if (!policy) {
    return fallback(provider.id, settings.modelId, 'decisionProvider', 0, 'The selected model does not have an Auto policy')
  }
  if (
    provider.deployment === 'hosted' &&
    settings.privacyNoticeVersion < AUTO_PERMISSION_PRIVACY_NOTICE_VERSION
  ) {
    return fallback(provider.id, settings.modelId, 'decisionProvider', policy.policyVersion, 'Privacy confirmation is required')
  }
  if (!provider.apiKey && provider.apiFormat !== 'ollama_chat') {
    return fallback(provider.id, settings.modelId, 'decisionProvider', policy.policyVersion, 'API key is missing')
  }

  let input: string
  try {
    input = renderInput(value)
  } catch {
    return fallback(provider.id, settings.modelId, 'decisionProvider', policy.policyVersion, 'Tool context could not be serialized')
  }

  const score = await requestAskProbability(provider, settings.modelId, input, value.signal)
  if (score === null) {
    return fallback(provider.id, settings.modelId, 'decisionProvider', policy.policyVersion, 'Decision request failed')
  }

  return {
    behavior: score >= policy.threshold ? 'ask' : 'allow',
    providerId: provider.id,
    modelId: settings.modelId,
    source: 'decisionProvider',
    score,
    policyVersion: policy.policyVersion,
  }
}

async function evaluateFastModel(
  providerId: string,
  modelId: string,
  value: AutoPermissionInput,
): Promise<AutoPermissionEvaluation> {
  try {
    const response = await sideQuery({
      querySource: 'auto_mode_critique',
      model: modelId,
      system: POLICY,
      skipSystemPromptPrefix: true,
      messages: [{ role: 'user', content: renderInput(value) }],
      tools: [AUTO_PERMISSION_TOOL],
      tool_choice: { type: 'tool', name: AUTO_PERMISSION_TOOL.name },
      max_tokens: 128,
      maxRetries: 0,
      signal: combineSignal(value.signal),
      temperature: 0,
      thinking: false,
    })
    const block = response.content.find((content) => content.type === 'tool_use')
    const parsed = parseFastModelDecision(block?.type === 'tool_use' ? block.input : null)
    if (!parsed) {
      return fallback(providerId, modelId, 'fastModel', 1, 'Decision response could not be parsed')
    }
    return {
      behavior: parsed.behavior,
      providerId,
      modelId,
      source: 'fastModel',
      score: null,
      policyVersion: 1,
      reason: parsed.reason,
    }
  } catch {
    return fallback(providerId, modelId, 'fastModel', 1, 'Decision request failed')
  }
}

export function parseFastModelDecision(
  value: unknown,
): { behavior: 'allow' | 'ask'; reason?: string } | null {
  const record = asRecord(value)
  if (record?.behavior !== 'allow' && record?.behavior !== 'ask') return null
  return {
    behavior: record.behavior,
    ...(typeof record.reason === 'string' && record.reason.trim()
      ? { reason: record.reason.trim() }
      : {}),
  }
}

function fallback(
  providerId: string,
  modelId: string,
  source: AutoPermissionEvaluation['source'],
  policyVersion: number,
  reason: string,
): AutoPermissionEvaluation {
  return {
    behavior: 'ask',
    providerId,
    modelId,
    source,
    score: null,
    policyVersion,
    reason,
  }
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

function renderInput(value: AutoPermissionInput): string {
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
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const response = await fetch(requestEndpoint(provider), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody(provider, modelId, input)),
      signal: combineSignal(signal),
    })
    if (!response.ok) return null
    return parsePermissionGuardrailAskProbability(provider, await response.json())
  } catch {
    return null
  }
}

function combineSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
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
