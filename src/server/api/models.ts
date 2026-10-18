import { SettingsService } from '../services/settingsService.js'
import { ProviderService } from '../services/providerService.js'
import { attributionHeaderEnvForModel } from '../services/attributionHeaderPolicy.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

const DEFAULT_MODELS = [
  {
    id: 'claude-opus-4-7',
    name: 'Opus 4.7',
    description: 'Most capable for ambitious work',
    context: '1m',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    description: 'Most efficient for everyday tasks',
    context: '200k',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Haiku 4.5',
    description: 'Fastest for quick answers',
    context: '200k',
  },
] as const

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const

const DEFAULT_MODEL = 'claude-opus-4-7'
const DEFAULT_EFFORT = 'medium'

const settingsService = new SettingsService()
const providerService = new ProviderService()

type ApiModelInfo = {
  id: string
  name: string
  description: string
  context: string
}

function addUniqueModel(
  models: ApiModelInfo[],
  model: ApiModelInfo | null,
): void {
  if (!model || !model.id.trim()) {
    return
  }

  if (models.some(existing => existing.id === model.id)) {
    return
  }

  models.push(model)
}

function buildProviderModelList(models: {
  main: string
  haiku: string
  sonnet: string
  opus: string
}): ApiModelInfo[] {
  const modelList: ApiModelInfo[] = []

  addUniqueModel(modelList, {
    id: models.main,
    name: models.main,
    description: 'Main model',
    context: '',
  })
  addUniqueModel(modelList, models.haiku
    ? {
        id: models.haiku,
        name: models.haiku,
        description: 'Haiku model',
        context: '',
      }
    : null)
  addUniqueModel(modelList, models.sonnet
    ? {
        id: models.sonnet,
        name: models.sonnet,
        description: 'Sonnet model',
        context: '',
      }
    : null)
  addUniqueModel(modelList, models.opus
    ? {
        id: models.opus,
        name: models.opus,
        description: 'Opus model',
        context: '',
      }
    : null)

  return modelList
}

function getEnvConfiguredAnthropicModels(): ApiModelInfo[] {
  return buildProviderModelList({
    main: process.env.ANTHROPIC_MODEL?.trim() || '',
    haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim() || '',
    sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() || '',
    opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() || '',
  })
}

function getStandaloneModelList(): ApiModelInfo[] {
  const models = [...getEnvConfiguredAnthropicModels()]

  if (models.length === 0) {
    models.push(...DEFAULT_MODELS)
  }

  return models
}

function normalizeEffortLevel(value: unknown): (typeof EFFORT_LEVELS)[number] {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value as (typeof EFFORT_LEVELS)[number])
    ? value as (typeof EFFORT_LEVELS)[number]
    : DEFAULT_EFFORT
}

export async function handleModelsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[1]
    const sub = segments[2]

    if (resource === 'effort') {
      return await handleEffort(req)
    }

    switch (sub) {
      case undefined:
        if (req.method !== 'GET') throw methodNotAllowed(req.method)
        return await handleModelsList()

      case 'current':
        return await handleCurrentModel(req)

      default:
        throw ApiError.notFound(`Unknown models endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleModelsList(): Promise<Response> {
  const { providers, activeId } = await providerService.listProviders()
  const activeProvider = activeId ? providers.find((p) => p.id === activeId) : null
  if (activeProvider) {
    const modelList = buildProviderModelList(activeProvider.models)
    return Response.json({
      models: modelList,
      provider: { id: activeProvider.id, name: activeProvider.name },
    })
  }
  return Response.json({ models: getStandaloneModelList(), provider: null })
}

async function handleCurrentModel(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const { providers, activeId } = await providerService.listProviders()
    const activeProvider = activeId ? providers.find((p) => p.id === activeId) : null
    const settings = activeProvider
      ? await providerService.getManagedSettings()
      : await settingsService.getUserSettings()
    const explicitModel = (settings.model as string) || ''
    const contextTier = (settings.modelContext as string) || undefined
    const env = (settings.env as Record<string, string>) || {}
    const envModel = process.env.ANTHROPIC_MODEL?.trim() || ''

    let currentModelId: string
    let currentModelName: string

    if (activeProvider) {
      const providerEnvModel = env.ANTHROPIC_MODEL
      if (providerEnvModel && !explicitModel) {
        currentModelId = providerEnvModel
        currentModelName = providerEnvModel
      } else {
        currentModelId = explicitModel || providerEnvModel || activeProvider.models.main
        currentModelName = currentModelId
      }
    } else {
      currentModelId = explicitModel || envModel || DEFAULT_MODEL
      currentModelName = currentModelId
    }

    const lookupId = contextTier ? `${currentModelId}:${contextTier}` : currentModelId

    const availableModels = activeProvider
      ? buildProviderModelList(activeProvider.models)
      : getStandaloneModelList()

    const modelEntry = availableModels.find((m) => m.id === lookupId)
      || availableModels.find((m) => m.id === currentModelId)
      || {
        id: currentModelId,
        name: currentModelName,
        description: 'Custom model',
        context: contextTier || 'unknown',
      }

    return Response.json({ model: { ...modelEntry, context: contextTier || modelEntry.context } })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const modelId = body.modelId
    if (typeof modelId !== 'string' || !modelId) {
      throw ApiError.badRequest('Missing or invalid "modelId" in request body')
    }

    const colonIdx = modelId.indexOf(':')
    const baseId = colonIdx !== -1 ? modelId.slice(0, colonIdx) : modelId
    const contextTier = colonIdx !== -1 ? modelId.slice(colonIdx + 1) : undefined

    const updates: Record<string, unknown> = { model: baseId }
    if (contextTier) {
      updates.modelContext = contextTier
    } else {
      updates.modelContext = undefined
    }
    const { activeId } = await providerService.listProviders()
    if (activeId) {
      const currentManagedSettings = await providerService.getManagedSettings()
      const currentEnv =
        (currentManagedSettings.env as Record<string, string> | undefined) ?? {}
      await providerService.updateManagedSettings({
        ...updates,
        env: {
          ...currentEnv,
          ...attributionHeaderEnvForModel(baseId),
        },
      })
    } else {
      await settingsService.updateUserSettings(updates)
    }
    return Response.json({ ok: true, model: modelId })
  }

  throw methodNotAllowed(req.method)
}

async function handleEffort(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const settings = await settingsService.getUserSettings()
    const level = normalizeEffortLevel(settings.effort)
    return Response.json({ level, available: EFFORT_LEVELS })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const level = body.level
    if (typeof level !== 'string') {
      throw ApiError.badRequest('Missing or invalid "level" in request body')
    }
    if (!EFFORT_LEVELS.includes(level as (typeof EFFORT_LEVELS)[number])) {
      throw ApiError.badRequest(
        `Invalid effort level: "${level}". Valid levels: ${EFFORT_LEVELS.join(', ')}`,
      )
    }
    await settingsService.updateUserSettings({ effort: level })
    return Response.json({ ok: true, level })
  }

  throw methodNotAllowed(req.method)
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
