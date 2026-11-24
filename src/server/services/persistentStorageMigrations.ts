import * as fs from 'fs/promises'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { ModelContextWindowSchema } from '../../utils/model/modelRules.js'

export const CURRENT_PROVIDER_INDEX_SCHEMA_VERSION = 2

type MigrationReport = {
  migratedEntries: string[]
  failures: string[]
}

type JsonObject = Record<string, unknown>
type LegacyProviderModel = {
  id: string
  name?: string
}
type LegacyRootProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: LegacyProviderModel[]
  isActive?: boolean
  notes?: string
}

const RETIRED_MANAGED_ENV_KEYS = [
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS',
  'DREAMCODER_SEND_DISABLED_THINKING',
] as const

const LEGACY_PRESET_CONTEXT_WINDOWS: Record<string, Record<string, number>> = {
  deepseek: {
    'deepseek-v4-pro': 1_000_000,
    'deepseek-v4-flash': 1_000_000,
    'deepseek-chat': 1_000_000,
    'deepseek-reasoner': 1_000_000,
  },
  kimi: {
    'kimi-k2.6': 262_144,
    'kimi-k2.5': 262_144,
  },
  zhipuglm: {
    'glm-5.1': 200_000,
    'glm-5-turbo': 200_000,
    'glm-4.5-air': 128_000,
  },
}

const LEGACY_CLI_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-7': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-chat': 1_000_000,
  'deepseek-reasoner': 1_000_000,
  'kimi-k2.6': 262_144,
  'kimi-k2.5': 262_144,
  'kimi-k2-0905-preview': 262_144,
  'kimi-k2-turbo-preview': 262_144,
  'kimi-k2-thinking': 262_144,
  'kimi-k2-thinking-turbo': 262_144,
  'minimax-m2.7': 204_800,
  'minimax-m2.7-highspeed': 204_800,
  'minimax-m2.5': 204_800,
  'minimax-m2.5-highspeed': 204_800,
  'minimax-m2.1': 204_800,
  'minimax-m2.1-highspeed': 204_800,
  'minimax-m2': 204_800,
  'glm-5.1': 200_000,
  'glm-5': 200_000,
  'glm-5-turbo': 200_000,
  'glm-4.7': 200_000,
  'glm-4.6': 200_000,
  'glm-4.5': 128_000,
  'glm-4.5-air': 128_000,
}

const LEGACY_CLI_CONTEXT_WINDOW_PATTERNS: Array<[RegExp, number]> = [
  [/^anthropic\/claude-opus-4\.7\b/i, 1_000_000],
  [/^anthropic\/claude-sonnet-4\.6\b/i, 200_000],
  [/^anthropic\/claude-haiku-4\.5\b/i, 200_000],
  [/^openai\/gpt-4\.1\b/i, 1_047_576],
  [/^openai\/gpt-5(?:[.-]\d+)?\b/i, 400_000],
  [/^google\/gemini-(?:2\.0|2\.5|3)/i, 1_048_576],
  [/^gemini-(?:2\.0|2\.5|3)/i, 1_048_576],
  [/^qwen\/qwen3\.5-(?:plus|flash)\b/i, 1_000_000],
  [/^qwen3\.5-(?:plus|flash)\b/i, 1_000_000],
  [/^qwen\/qwen3-max\b/i, 262_144],
  [/^qwen3-max\b/i, 262_144],
  [/qwen-long/i, 10_000_000],
]

let migrationPromise: Promise<MigrationReport> | null = null
let migrationConfigDir: string | null = null

function getConfigDir(): string {
  return getClaudeConfigHomeDir()
}

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isLegacyProviderModels(value: unknown): value is JsonObject {
  return (
    isRecord(value) &&
    typeof value.main === 'string' &&
    typeof value.haiku === 'string' &&
    typeof value.sonnet === 'string' &&
    typeof value.opus === 'string'
  )
}

function isProviderModels(value: unknown): value is LegacyProviderModel[] {
  return Array.isArray(value) && value.every(isLegacyProviderModel)
}

function isSavedProvider(value: unknown): value is JsonObject {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.presetId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.baseUrl === 'string' &&
    (isLegacyProviderModels(value.models) || isProviderModels(value.models))
  )
}

function isLegacyProviderModel(value: unknown): value is LegacyProviderModel {
  return isRecord(value) && typeof value.id === 'string'
}

function isLegacyRootProvider(value: unknown): value is LegacyRootProvider {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.baseUrl === 'string' &&
    typeof value.apiKey === 'string' &&
    Array.isArray(value.models) &&
    value.models.every(isLegacyProviderModel)
  )
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

async function readJsonFile(filePath: string): Promise<{ missing: boolean; value: unknown; raw: string }> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return { missing: false, value: JSON.parse(raw), raw }
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return { missing: true, value: undefined, raw: '' }
    }
    throw error
  }
}

async function backupFile(filePath: string, suffix: string): Promise<void> {
  const backupPath = `${filePath}.${suffix}-${Date.now()}-${randomBytes(3).toString('hex')}`
  await fs.copyFile(filePath, backupPath)
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${Date.now()}-${randomBytes(3).toString('hex')}`
  try {
    await fs.writeFile(tmpPath, stableStringify(value), 'utf-8')
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {})
    throw error
  }
}

async function quarantineMalformedFile(filePath: string): Promise<void> {
  const invalidPath = `${filePath}.invalid-${Date.now()}-${randomBytes(3).toString('hex')}`
  await fs.rename(filePath, invalidPath)
}

function legacyCliContextWindow(modelId: string): number | undefined {
  const key = modelId.trim().replace(/\[1m\]$/i, '').replace(/:1m$/i, '').toLowerCase()
  return LEGACY_CLI_CONTEXT_WINDOWS[key]
    ?? LEGACY_CLI_CONTEXT_WINDOW_PATTERNS.find(([pattern]) => pattern.test(key))?.[1]
}

function isLegacyDefaultContextWindow(presetId: unknown, modelId: string, window: number): boolean {
  const presetWindows = typeof presetId === 'string' ? LEGACY_PRESET_CONTEXT_WINDOWS[presetId] : undefined
  return presetWindows?.[modelId] === window || legacyCliContextWindow(modelId) === window
}

function migrateModelContextWindows(provider: JsonObject): JsonObject {
  if (!Object.hasOwn(provider, 'modelContextWindows')) return provider
  const { modelContextWindows, ...rest } = provider
  const overrides: JsonObject = isRecord(rest.modelOverrides) ? { ...rest.modelOverrides } : {}
  for (const [modelId, value] of Object.entries(isRecord(modelContextWindows) ? modelContextWindows : {})) {
    const window = ModelContextWindowSchema.safeParse(value)
    if (!window.success || isLegacyDefaultContextWindow(provider.presetId, modelId, window.data)) continue
    const existing = overrides[modelId]
    overrides[modelId] = { contextWindow: window.data, ...(isRecord(existing) ? existing : {}) }
  }
  return Object.keys(overrides).length > 0 ? { ...rest, modelOverrides: overrides } : rest
}

function migrateProvidersIndex(value: unknown): JsonObject {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return {
      schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
      activeId: null,
      providers: [],
    }
  }

  const { activeProviderId: _legacyActiveProviderId, ...rest } = value
  const providers = value.providers.filter(isSavedProvider).map(migrateModelContextWindows).map((provider): JsonObject => {
    if (isProviderModels(provider.models)) {
      return {
        ...provider,
        models: dedupeModels(provider.models),
        ...(typeof provider.fastModel === 'string' && provider.models.some((model) => model.id === provider.fastModel)
          ? { fastModel: provider.fastModel }
          : {}),
      }
    }

    const legacyModels = provider.models as JsonObject
    const models = dedupeModels(['main', 'sonnet', 'opus', 'haiku'].map((role) => ({
      id: typeof legacyModels[role] === 'string' ? legacyModels[role] as string : '',
    })))
    const main = typeof legacyModels.main === 'string' ? legacyModels.main : ''
    const haiku = typeof legacyModels.haiku === 'string' ? legacyModels.haiku : ''
    return {
      ...provider,
      models,
      ...(haiku && haiku !== main ? { fastModel: haiku } : {}),
    }
  })
  const rawActiveId =
    typeof value.activeId === 'string'
      ? value.activeId
      : typeof _legacyActiveProviderId === 'string'
        ? _legacyActiveProviderId
        : null
  const activeId = rawActiveId && providers.some((provider) => provider.id === rawActiveId)
    ? rawActiveId
    : null

  return {
    ...rest,
    schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
    activeId,
    providers,
  }
}

function dedupeModels(models: LegacyProviderModel[]): LegacyProviderModel[] {
  const seen = new Set<string>()
  return models.flatMap((model) => {
    const id = model.id.trim()
    if (!id || seen.has(id)) return []
    seen.add(id)
    const name = model.name?.trim()
    return [{ id, ...(name ? { name } : {}) }]
  })
}

function migrateManagedSettings(value: unknown): JsonObject {
  if (!isRecord(value)) return {}
  if (value.env !== undefined && !isRecord(value.env)) {
    return { ...value, env: {} }
  }
  if (isRecord(value.env) && RETIRED_MANAGED_ENV_KEYS.some((key) => Object.hasOwn(value.env as JsonObject, key))) {
    const env = { ...value.env }
    for (const key of RETIRED_MANAGED_ENV_KEYS) delete env[key]
    return { ...value, env }
  }
  return value
}

async function migrateJsonEntry(
  filePath: string,
  entryName: string,
  report: MigrationReport,
  migrate: (value: unknown) => JsonObject,
): Promise<void> {
  try {
    const current = await readJsonFile(filePath)
    if (current.missing) return

    const migrated = migrate(current.value)
    if (stableStringify(migrated) === stableStringify(current.value)) return

    await backupFile(filePath, 'bak-before-migration')
    await writeJsonFile(filePath, migrated)
    report.migratedEntries.push(entryName)
  } catch (error) {
    if (error instanceof SyntaxError) {
      try {
        await quarantineMalformedFile(filePath)
        await writeJsonFile(filePath, {})
        report.migratedEntries.push(entryName)
        return
      } catch (recoveryError) {
        report.failures.push(`${entryName}: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
        return
      }
    }

    report.failures.push(`${entryName}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function legacyProviderModelId(
  provider: LegacyRootProvider,
  preferredModelId: unknown,
): string {
  if (
    typeof preferredModelId === 'string' &&
    provider.models.some((model) => model.id === preferredModelId)
  ) {
    return preferredModelId
  }

  return provider.models[0]?.id ?? ''
}

function migrateLegacyRootProvidersConfig(value: unknown): JsonObject | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return null
  }

  const providers = value.providers
    .filter(isLegacyRootProvider)
    .map((provider) => {
      const main = legacyProviderModelId(provider, value.activeModel)
      const models = dedupeModels([
        ...provider.models.filter((model) => model.id === main),
        ...provider.models.filter((model) => model.id !== main),
      ])
      return {
        id: provider.id,
        presetId: 'custom',
        name: provider.name,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        apiFormat: 'anthropic',
        models,
        ...(provider.notes !== undefined && { notes: provider.notes }),
      }
    })

  if (providers.length === 0) {
    return null
  }

  const activeLegacyProvider = value.providers
    .filter(isLegacyRootProvider)
    .find((provider) =>
      provider.isActive === true ||
      (typeof value.activeModel === 'string' &&
        provider.models.some((model) => model.id === value.activeModel)),
    )
  const activeId =
    activeLegacyProvider && providers.some((provider) => provider.id === activeLegacyProvider.id)
      ? activeLegacyProvider.id
      : null

  return {
    schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
    activeId,
    providers,
  }
}

function buildManagedSettingsForMigratedProvider(provider: JsonObject | undefined): JsonObject | null {
  if (!provider || !isProviderModels(provider.models)) return null
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : ''
  const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl : ''
  const main = provider.models[0]?.id ?? ''
  if (!apiKey || !baseUrl || !main) return null
  const fast = typeof provider.fastModel === 'string' && provider.models.some((model) => model.id === provider.fastModel)
    ? provider.fastModel
    : main

  return {
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
      ANTHROPIC_SMALL_FAST_MODEL: fast,
      ANTHROPIC_DEFAULT_SONNET_MODEL: main,
      ANTHROPIC_DEFAULT_OPUS_MODEL: main,
    },
  }
}

async function migrateLegacyRootProviders(
  configDir: string,
  dreamcoderDir: string,
  report: MigrationReport,
): Promise<void> {
  const targetPath = path.join(dreamcoderDir, 'providers.json')
  try {
    await fs.access(targetPath)
    return
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') {
      report.failures.push(`dreamcoder/providers.json: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
  }

  const legacyPath = path.join(configDir, 'providers.json')

  try {
    const legacy = await readJsonFile(legacyPath)
    if (legacy.missing) return

    const migrated = migrateLegacyRootProvidersConfig(legacy.value)
    if (!migrated) return

    await writeJsonFile(targetPath, migrated)
    report.migratedEntries.push('providers.json -> dreamcoder/providers.json')

    const settingsPath = path.join(dreamcoderDir, 'settings.json')
    const settings = await readJsonFile(settingsPath).catch(() => ({ missing: false, value: undefined, raw: '' }))
    if (!settings.missing) return

    const activeId = typeof migrated.activeId === 'string' ? migrated.activeId : null
    const activeProvider = Array.isArray(migrated.providers)
      ? migrated.providers.find((provider) => isRecord(provider) && provider.id === activeId)
      : undefined
    const managedSettings = buildManagedSettingsForMigratedProvider(
      isRecord(activeProvider) ? activeProvider : undefined,
    )
    if (managedSettings) {
      await writeJsonFile(settingsPath, managedSettings)
      report.migratedEntries.push('providers.json -> dreamcoder/settings.json')
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      report.failures.push(`providers.json: ${error.message}`)
      return
    }
    report.failures.push(`providers.json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function runPersistentStorageMigrations(configDir: string): Promise<MigrationReport> {
  const report: MigrationReport = { migratedEntries: [], failures: [] }
  const dreamcoderDir = path.join(configDir, 'dreamcoder')

  await migrateLegacyRootProviders(configDir, dreamcoderDir, report)

  await migrateJsonEntry(
    path.join(dreamcoderDir, 'providers.json'),
    'dreamcoder/providers.json',
    report,
    migrateProvidersIndex,
  )
  await migrateJsonEntry(
    path.join(dreamcoderDir, 'settings.json'),
    'dreamcoder/settings.json',
    report,
    migrateManagedSettings,
  )

  return report
}

export function ensurePersistentStorageUpgraded(): Promise<MigrationReport> {
  const configDir = getConfigDir()
  if (!migrationPromise || migrationConfigDir !== configDir) {
    migrationConfigDir = configDir
    migrationPromise = runPersistentStorageMigrations(configDir)
  }
  return migrationPromise
}

/** Runs the migrations again, for files copied in after startup (Import from Claude Code). */
export function rerunPersistentStorageMigrations(): Promise<MigrationReport> {
  migrationPromise = null
  return ensurePersistentStorageUpgraded()
}

export function resetPersistentStorageMigrationsForTests(): void {
  migrationPromise = null
  migrationConfigDir = null
}
