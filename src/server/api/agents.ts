import { AgentService } from '../services/agentService.js'
import { taskService } from '../services/taskService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { resetTaskList } from '../../utils/tasks.js'
import {
  resolveAgentModelDisplay,
  resolveAgentOverrides,
  type ResolvedAgent,
} from '../../tools/AgentTool/agentDisplay.js'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
  type AgentDefinition as SharedAgentDefinition,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getCwd } from '../../utils/cwd.js'

const agentService = new AgentService()

export async function handleAgentsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[1]

    if (resource === 'tasks') {
      return await handleTasksApi(req, segments)
    }

    return await handleAgents(req, url, segments)
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleAgents(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const method = req.method
  const agentName = segments[2] ? decodeURIComponent(segments[2]) : undefined

  if (method === 'GET' && !agentName) {
    const cwd = url.searchParams.get('cwd') || getCwd()
    const { activeAgents, allAgents } = await getAgentDefinitionsWithOverrides(cwd)
    const resolvedAgents = resolveAgentOverrides(allAgents, activeAgents)

    return Response.json({
      activeAgents: activeAgents.map(agent => serializeActiveAgent(agent, true)),
      allAgents: resolvedAgents.map(serializeResolvedAgent),
    })
  }

  if (method === 'GET' && agentName) {
    const agent = await agentService.getAgent(agentName)
    if (!agent) {
      throw ApiError.notFound(`Agent not found: ${agentName}`)
    }
    return Response.json({ agent })
  }

  if (method === 'POST' && !agentName) {
    const body = await parseJsonBody(req)
    if (!body.name || typeof body.name !== 'string') {
      throw ApiError.badRequest('Missing or invalid "name" in request body')
    }
    await agentService.createAgent({
      name: body.name as string,
      description: body.description as string | undefined,
      model: body.model as string | undefined,
      tools: body.tools as string[] | undefined,
      systemPrompt: body.systemPrompt as string | undefined,
      color: body.color as string | undefined,
    })
    clearAgentDefinitionsCache()
    return Response.json({ ok: true }, { status: 201 })
  }

  if (method === 'PUT' && agentName) {
    const body = await parseJsonBody(req)
    await agentService.updateAgent(agentName, body as Record<string, unknown>)
    clearAgentDefinitionsCache()
    const updated = await agentService.getAgent(agentName)
    return Response.json({ agent: updated })
  }

  if (method === 'DELETE' && agentName) {
    await agentService.deleteAgent(agentName)
    clearAgentDefinitionsCache()
    return Response.json({ ok: true })
  }

  throw new ApiError(
    405,
    `Method ${method} not allowed on /api/agents${agentName ? `/${agentName}` : ''}`,
    'METHOD_NOT_ALLOWED',
  )
}

async function handleTasksApi(
  req: Request,
  segments: string[],
): Promise<Response> {
  const sub = segments[2]

  if (sub === 'lists') {
    const taskListId = segments[3]
    const taskId = segments[4]

    if (req.method === 'POST' && taskListId && taskId === 'reset') {
      await resetTaskList(taskListId)
      return Response.json({ ok: true })
    }

    if (req.method !== 'GET') {
      throw new ApiError(
        405,
        `Method ${req.method} not allowed on /api/tasks/lists`,
        'METHOD_NOT_ALLOWED',
      )
    }

    if (taskListId && taskId) {
      const task = await taskService.getTask(taskListId, taskId)
      if (!task) throw ApiError.notFound(`Task not found: ${taskListId}/${taskId}`)
      return Response.json({ task })
    }

    if (taskListId) {
      const tasks = await taskService.getTasksForList(taskListId)
      return Response.json({ tasks })
    }

    const lists = await taskService.listTaskLists()
    return Response.json({ lists })
  }

  if (req.method !== 'GET') {
    throw new ApiError(
      405,
      `Method ${req.method} not allowed on /api/tasks`,
      'METHOD_NOT_ALLOWED',
    )
  }

  const tasks = await taskService.listTasks()
  return Response.json({ tasks })
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

type ApiAgentDefinition = {
  agentType: string
  description?: string
  model?: string
  modelDisplay?: string
  tools?: string[]
  systemPrompt?: string
  color?: string
  source: SharedAgentDefinition['source']
  baseDir?: string
  isActive: boolean
}

type ApiResolvedAgentDefinition = ApiAgentDefinition & {
  overriddenBy?: SharedAgentDefinition['source']
}

function serializeActiveAgent(
  agent: SharedAgentDefinition,
  isActive: boolean,
): ApiAgentDefinition {
  return {
    agentType: agent.agentType,
    description: agent.whenToUse,
    model: agent.model,
    modelDisplay: resolveAgentModelDisplay(agent),
    tools: agent.tools,
    systemPrompt: agent.getSystemPrompt.length === 0 ? agent.getSystemPrompt() : undefined,
    color: agent.color,
    source: agent.source,
    baseDir: agent.baseDir,
    isActive,
  }
}

function serializeResolvedAgent(agent: ResolvedAgent): ApiResolvedAgentDefinition {
  return {
    ...serializeActiveAgent(agent, !agent.overriddenBy),
    overriddenBy: agent.overriddenBy,
  }
}
