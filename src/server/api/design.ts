import * as path from 'node:path'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { optionalString, readBody, requireString } from './requestBody.js'
import { artifactService } from '../services/artifactService.js'
import {
  readDesignSystemCatalog,
  resolveDesignSystemsDir,
} from '../../utils/designSystems.js'
import {
  designTemplateFolder,
  findDesignTemplate,
  readDesignTemplateCatalog,
  resolveDesignTemplatesDir,
} from '../../utils/designTemplates.js'

async function templatesDir(): Promise<string> {
  try {
    return await resolveDesignTemplatesDir()
  } catch (error) {
    throw ApiError.notFound(error instanceof Error ? error.message : String(error))
  }
}

async function systemsDir(): Promise<string> {
  try {
    return await resolveDesignSystemsDir()
  } catch (error) {
    throw ApiError.notFound(error instanceof Error ? error.message : String(error))
  }
}

async function createArtifact(req: Request): Promise<Response> {
  const body = await readBody(req)
  const designSystemId = optionalString(body, 'designSystemId')
  const created = await artifactService.createFromTemplate(requireString(body, 'project'), {
    templateId: requireString(body, 'templateId'),
    name: optionalString(body, 'name'),
    title: optionalString(body, 'title'),
    templatesDir: await templatesDir(),
    ...(designSystemId !== undefined && { designSystemId, systemsDir: await systemsDir() }),
  })
  return Response.json(created)
}

async function previewTarget(id: string): Promise<Response> {
  const dir = await templatesDir()
  const template = await findDesignTemplate(id, dir)
  if (!template) throw ApiError.notFound(`Template not found: ${id}`)
  const rootDir = designTemplateFolder(dir, template)
  return Response.json({ rootDir, filePath: path.join(rootDir, template.entry) })
}

export async function handleDesignApi(req: Request, _url: URL, segments: string[]): Promise<Response> {
  try {
    const [, , resource, id, action] = segments
    if (resource === 'artifacts' && id === undefined) {
      if (req.method !== 'POST') throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      return await createArtifact(req)
    }
    if (resource === 'templates') {
      if (req.method !== 'GET') throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      if (id === undefined) return Response.json(await readDesignTemplateCatalog(await templatesDir()))
      if (action === 'preview') return await previewTarget(id)
    }
    if (resource === 'systems' && id === 'catalog') {
      if (req.method !== 'GET') throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      return Response.json(await readDesignSystemCatalog(await systemsDir()))
    }
    throw ApiError.notFound(`Unknown design resource: ${segments.slice(2).join('/')}`)
  } catch (error) {
    return errorResponse(error)
  }
}
