import { z } from 'zod'
import { ProviderService } from '../services/providerService.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { DECISION_PROVIDER_PRESETS } from '../config/decisionProviderPresets.js'
import {
  CreateProviderSchema,
  UpdateProviderSchema,
  TestProviderSchema,
  DiscoverProviderModelsSchema,
  CreateDecisionProviderSchema,
  UpdateDecisionProviderSchema,
  TestDecisionProviderSchema,
  DiscoverDecisionProviderModelsSchema,
} from '../types/provider.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { diagnosticsService } from '../services/diagnosticsService.js'

const providerService = new ProviderService()

export async function handleProvidersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const id = segments[2]
    const action = segments[3]

    if (id === 'decisions') {
      return await handleDecisionProviders(req, segments)
    }

    if (id === 'test' && req.method === 'POST') {
      return await handleTestUnsaved(req)
    }

    if (id === 'models' && req.method === 'POST') {
      const body = await parseJsonBody(req)
      try {
        const input = DiscoverProviderModelsSchema.parse(body)
        return Response.json({ models: await providerService.discoverModels(input) })
      } catch (err) {
        if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
        throw err
      }
    }

    if (id === 'presets' && req.method === 'GET') {
      return Response.json({ presets: PROVIDER_PRESETS })
    }

    if (id === 'auth-status' && req.method === 'GET') {
      const status = await providerService.checkAuthStatus()
      return Response.json(status)
    }

    if (id === 'settings') {
      if (req.method === 'GET') {
        return Response.json(await providerService.getManagedSettings())
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody(req)
        await providerService.updateManagedSettings(body)
        return Response.json({ ok: true })
      }
      throw methodNotAllowed(req.method)
    }

    if (!id) {
      if (req.method === 'GET') {
        const { providers, activeId } = await providerService.listProviders()
        return Response.json({ providers, activeId })
      }
      if (req.method === 'POST') {
        return await handleCreate(req)
      }
      throw methodNotAllowed(req.method)
    }

    if (action === 'activate') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      await providerService.activateProvider(id)
      return Response.json({ ok: true })
    }

    if (action === 'test') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      let overrides: { baseUrl?: string; modelId?: string; apiFormat?: string; authStrategy?: string } | undefined
      try {
        const body = await req.json()
        if (body && typeof body === 'object') overrides = body as typeof overrides
      } catch { }
      const result = await providerService.testProvider(id, overrides)
      if (!result.connectivity.success) {
        void diagnosticsService.recordEvent({
          type: 'provider_test_failed',
          severity: 'warn',
          summary: result.connectivity.error || 'Provider test failed',
          details: {
            providerId: id,
            httpStatus: result.connectivity.httpStatus,
            apiFormat: overrides?.apiFormat,
            modelId: overrides?.modelId,
            connectivity: result.connectivity,
          },
        })
      }
      return Response.json({ result })
    }

    if (req.method === 'GET') {
      const provider = await providerService.getProvider(id)
      return Response.json({ provider })
    }
    if (req.method === 'PUT') {
      return await handleUpdate(req, id)
    }
    if (req.method === 'DELETE') {
      await providerService.deleteProvider(id)
      return Response.json({ ok: true })
    }

    throw methodNotAllowed(req.method)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(ApiError.badRequest(error.issues.map((issue) => issue.message).join('; ')))
    }
    return errorResponse(error)
  }
}

async function handleDecisionProviders(
  req: Request,
  segments: string[],
): Promise<Response> {
  const id = segments[3]
  const action = segments[4]

  if (id === 'presets' && req.method === 'GET') {
    return Response.json({ presets: DECISION_PROVIDER_PRESETS })
  }
  if (id === 'models' && req.method === 'POST') {
    const input = DiscoverDecisionProviderModelsSchema.parse(await parseJsonBody(req))
    return Response.json({ models: await providerService.discoverDecisionModels(input) })
  }
  if (id === 'test' && req.method === 'POST') {
    const input = TestDecisionProviderSchema.parse(await parseJsonBody(req))
    return Response.json({ result: await providerService.testDecisionProviderConfig(input) })
  }
  if (!id) {
    if (req.method === 'GET') {
      const { providers, activeId } = await providerService.listDecisionProviders()
      return Response.json({ providers, activeId })
    }
    if (req.method === 'POST') {
      const input = CreateDecisionProviderSchema.parse(await parseJsonBody(req))
      const provider = await providerService.addDecisionProvider(input)
      return Response.json({ provider }, { status: 201 })
    }
    throw methodNotAllowed(req.method)
  }
  if (action === 'activate') {
    if (req.method !== 'POST') throw methodNotAllowed(req.method)
    await providerService.activateDecisionProvider(id)
    return Response.json({ ok: true })
  }
  if (action === 'test') {
    if (req.method !== 'POST') throw methodNotAllowed(req.method)
    const body = await parseJsonBody(req).catch(() => ({}))
    const modelId = typeof body.modelId === 'string' ? body.modelId : undefined
    return Response.json({ result: await providerService.testDecisionProvider(id, modelId) })
  }
  if (req.method === 'GET') {
    return Response.json({ provider: await providerService.getDecisionProvider(id) })
  }
  if (req.method === 'PUT') {
    const input = UpdateDecisionProviderSchema.parse(await parseJsonBody(req))
    return Response.json({ provider: await providerService.updateDecisionProvider(id, input) })
  }
  if (req.method === 'DELETE') {
    await providerService.deleteDecisionProvider(id)
    return Response.json({ ok: true })
  }
  throw methodNotAllowed(req.method)
}

async function handleCreate(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = CreateProviderSchema.parse(body)
    const provider = await providerService.addProvider(input)
    return Response.json({ provider }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleUpdate(req: Request, id: string): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = UpdateProviderSchema.parse(body)
    const provider = await providerService.updateProvider(id, input)
    return Response.json({ provider })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleTestUnsaved(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = TestProviderSchema.parse(body)
    const result = await providerService.testProviderConfig(input)
    if (!result.connectivity.success) {
      void diagnosticsService.recordEvent({
        type: 'provider_test_failed',
        severity: 'warn',
        summary: result.connectivity.error || 'Provider test failed',
        details: {
          providerId: null,
          baseUrl: input.baseUrl,
          apiFormat: input.apiFormat,
          modelId: input.modelId,
          connectivity: result.connectivity,
        },
      })
    }
    return Response.json({ result })
  } catch (err) {
    if (!(err instanceof z.ZodError)) {
      void diagnosticsService.recordEvent({
        type: 'provider_test_failed',
        severity: 'warn',
        summary: err instanceof Error ? err.message : String(err),
        details: { providerId: null, error: err },
      })
    }
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
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
