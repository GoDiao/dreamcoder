import { Button } from '../shared/ui/button'
import { TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceLine, TraceIcon, TraceTitle, TraceDescription } from '../shared/ui/trace'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../shared/ui/collapsible'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { memo, useEffect, useState } from 'react'
import { Bot, BookMarked, Check, ChevronDown, ChevronRight, CircleAlert, CircleDot, Settings, Square } from 'lucide-react'
import { ToolCallBlock } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Modal } from '../shared/Modal'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { AGENT_LIFECYCLE_TYPES } from '../../types/team'
import { getCuaToolDisplay } from '../../lib/cuaToolDisplay'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>
type ThinkingMessage = Extract<UIMessage, { type: 'thinking' }>
type ActivityStep = ToolCall | ThinkingMessage
type MemoryToolAction = 'saved' | 'referenced'

type MemoryToolFile = {
  path: string
  label: string
  action: MemoryToolAction
  lineHint?: string
  preview?: string
}

type MemoryToolActivity = {
  action: MemoryToolAction
  files: MemoryToolFile[]
}

type Props = {
  toolCalls: ToolCall[]
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  steps?: ActivityStep[]
  activeThinkingId?: string | null
  isStreaming?: boolean
}

const TOOL_VERBS: Record<string, (count: number, t: (key: TranslationKey, params?: Record<string, string | number>) => string) => string> = {
  Read: (n, t) => n === 1 ? t('toolGroup.readOne') : t('toolGroup.readMany', { count: n }),
  Write: (n, t) => n === 1 ? t('toolGroup.createdOne') : t('toolGroup.createdMany', { count: n }),
  Edit: (n, t) => n === 1 ? t('toolGroup.editedOne') : t('toolGroup.editedMany', { count: n }),
  Bash: (n, t) => n === 1 ? t('toolGroup.ranOne') : t('toolGroup.ranMany', { count: n }),
  Glob: (_n, t) => t('toolGroup.foundFiles'),
  Grep: (n, t) => n === 1 ? t('toolGroup.searchedOne') : t('toolGroup.searchedMany', { count: n }),
  Agent: (n, t) => n === 1 ? t('toolGroup.agentOne') : t('toolGroup.agentMany', { count: n }),
  WebSearch: (_n, t) => t('toolGroup.searchedWeb'),
  WebFetch: (n, t) => n === 1 ? t('toolGroup.fetchedOne') : t('toolGroup.fetchedMany', { count: n }),
}

function generateSummary(
  toolCalls: ToolCall[],
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  thinkingCount = 0,
): string {
  const counts = new Map<string, number>()
  for (const tc of toolCalls) {
    counts.set(tc.toolName, (counts.get(tc.toolName) ?? 0) + 1)
  }

  const parts: string[] = []
  for (const [name, count] of counts) {
    const verbFn = TOOL_VERBS[name]
    const label = getCuaToolDisplay(name, undefined, t)?.title ?? name
    parts.push(verbFn ? verbFn(count, t) : `${label} (${count})`)
  }
  if (thinkingCount > 0) {
    parts.push(thinkingCount === 1 ? t('toolGroup.thoughtOne') : t('toolGroup.thoughtMany', { count: thinkingCount }))
  }

  return parts.join(', ')
}

function toolCallHasError(
  toolCall: ToolCall,
  resultMap: Map<string, ToolResult>,
  childToolCallsByParent: Map<string, ToolCall[]>,
): boolean {
  const result = resultMap.get(toolCall.toolUseId)
  if (result?.isError) return true

  return (childToolCallsByParent.get(toolCall.toolUseId) ?? []).some((childToolCall) =>
    toolCallHasError(childToolCall, resultMap, childToolCallsByParent),
  )
}

function groupHasErrors(
  toolCalls: ToolCall[],
  resultMap: Map<string, ToolResult>,
  childToolCallsByParent: Map<string, ToolCall[]>,
): boolean {
  const succeeded = (toolCall: ToolCall) =>
    resultMap.has(toolCall.toolUseId) && !toolCallHasError(toolCall, resultMap, childToolCallsByParent)
  return toolCalls.some((toolCall, index) =>
    toolCallHasError(toolCall, resultMap, childToolCallsByParent)
    && !toolCalls.slice(index + 1).some((later) => later.toolName === toolCall.toolName && succeeded(later)),
  )
}

function isToolCallResolved(
  toolCall: ToolCall,
  resultMap: Map<string, ToolResult>,
  childToolCallsByParent: Map<string, ToolCall[]>,
): boolean {
  if (!resultMap.has(toolCall.toolUseId)) return false

  return (childToolCallsByParent.get(toolCall.toolUseId) ?? []).every((childToolCall) =>
    isToolCallResolved(childToolCall, resultMap, childToolCallsByParent),
  )
}

function hasUnresolvedToolCalls(
  toolCalls: ToolCall[],
  resultMap: Map<string, ToolResult>,
  childToolCallsByParent: Map<string, ToolCall[]>,
): boolean {
  return toolCalls.some((toolCall) =>
    !isToolCallResolved(toolCall, resultMap, childToolCallsByParent),
  )
}

export const ToolCallGroup = memo(function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  steps = toolCalls,
  activeThinkingId = null,
  isStreaming,
}: Props) {
  const memoryActivity = getMemoryToolActivity(toolCalls, resultMap)
  if (memoryActivity) {
    const memoryToolCalls = toolCalls.filter(isMemoryToolCall)
    const regularToolCalls = toolCalls.filter((toolCall) => !isMemoryToolCall(toolCall))
    const regularSteps = steps.filter((step) => step.type === 'thinking' || !isMemoryToolCall(step))
    if (regularSteps.length > 0) {
      return (
        <div className="mb-2 space-y-2">
          <MemoryToolActivityGroup
            activity={memoryActivity}
            toolCalls={memoryToolCalls}
            resultMap={resultMap}
            childToolCallsByParent={childToolCallsByParent}
            isStreaming={isStreaming}
          />
          <ToolCallGroupContent
            toolCalls={regularToolCalls}
            resultMap={resultMap}
            childToolCallsByParent={childToolCallsByParent}
            agentTaskNotifications={agentTaskNotifications}
            steps={regularSteps}
            activeThinkingId={activeThinkingId}
            isStreaming={isStreaming}
          />
        </div>
      )
    }
    return (
      <MemoryToolActivityGroup
        activity={memoryActivity}
        toolCalls={memoryToolCalls}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        isStreaming={isStreaming}
      />
    )
  }

  return (
    <ToolCallGroupContent
      toolCalls={toolCalls}
      resultMap={resultMap}
      childToolCallsByParent={childToolCallsByParent}
      agentTaskNotifications={agentTaskNotifications}
      steps={steps}
      activeThinkingId={activeThinkingId}
      isStreaming={isStreaming}
    />
  )
})

function ToolCallGroupContent({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  steps = toolCalls,
  activeThinkingId = null,
  isStreaming,
}: Props) {
  const allAgents = toolCalls.length > 0 && toolCalls.every((toolCall) => toolCall.toolName === 'Agent')

  if (allAgents) {
    return (
      <AgentToolGroup
        toolCalls={toolCalls}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        agentTaskNotifications={agentTaskNotifications}
        isStreaming={isStreaming}
      />
    )
  }

  if (toolCalls.length === 1 && steps.length === 1) {
    const tc = toolCalls[0]!
    return (
      <ToolCallTree
        toolCall={tc}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
      />
    )
  }

  return (
    <ToolCallGroupMulti
      toolCalls={toolCalls}
      resultMap={resultMap}
      childToolCallsByParent={childToolCallsByParent}
      agentTaskNotifications={agentTaskNotifications}
      steps={steps}
      activeThinkingId={activeThinkingId}
      isStreaming={isStreaming}
    />
  )
}

function MemoryToolActivityGroup({
  activity,
  toolCalls,
  resultMap,
  childToolCallsByParent,
  isStreaming,
}: {
  activity: MemoryToolActivity
  toolCalls: ToolCall[]
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  isStreaming?: boolean
}) {
  const [expanded, setExpanded] = useState(activity.action === 'saved')
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const t = useTranslation()
  const titleKey = activity.action === 'saved'
    ? 'chat.memorySavedFromToolsTitle'
    : 'chat.memoryReferencedTitle'
  const visibleFiles = activity.files.slice(0, 4)
  const hiddenCount = Math.max(0, activity.files.length - visibleFiles.length)

  useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])

  return (
    <div className="mb-2">
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        data-testid="memory-tool-activity-card"
        className="overflow-hidden rounded-lg border border-[var(--color-memory-border)] bg-[var(--color-memory-surface)]"
      >
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="row"
            type="button"
            className="px-3 py-2 hover:bg-[var(--color-surface-hover)]/50"
          >
            <ChevronRight size={15} className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-data-[state=open]/button:rotate-90" aria-hidden="true" />
            <BookMarked size={15} className="shrink-0 text-[var(--color-memory-accent)]" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
              {t(titleKey, { count: activity.files.length })}
            </span>
            {isStreaming ? (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-memory-accent)] animate-pulse-dot" />
            ) : null}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-[var(--color-border)]/55 px-3 py-2.5">
            <div className="space-y-1.5">
              {visibleFiles.map((file) => (
                <HintTooltip key={file.path} content={file.path}><Button variant="ghost" size="row"
                  type="button"
                  aria-label={file.path}
                  onClick={() => openMemorySettings(file.path)}
                  className="group items-start gap-2 rounded-md px-2 py-1.5"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-[var(--color-memory-border)] bg-[var(--color-memory-icon-bg)] text-[var(--color-text-tertiary)] group-hover:text-[var(--color-memory-accent)]">
                    <Settings size={12} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                        {file.label}
                      </span>
                      {file.lineHint ? (
                        <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">
                          {file.lineHint}
                        </span>
                      ) : null}
                    </span>
                    {file.preview ? (
                      <span className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                        {file.preview}
                      </span>
                    ) : null}
                  </span>
                </Button></HintTooltip>
              ))}
              {hiddenCount > 0 ? (
                <div className="px-2 py-1 text-[12px] text-[var(--color-text-tertiary)]">
                  {t('chat.memoryMoreFiles', { count: hiddenCount })}
                </div>
              ) : null}
            </div>

            <Button variant="ghost"
              type="button"
              onClick={() => setDetailsExpanded((value) => !value)}
              className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              {detailsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {t('chat.memoryTechnicalDetails')}
            </Button>

            {detailsExpanded ? (
              <div className="mt-2 space-y-1">
                {toolCalls.map((toolCall) => (
                  <ToolCallTree
                    key={toolCall.id}
                    toolCall={toolCall}
                    resultMap={resultMap}
                    childToolCallsByParent={childToolCallsByParent}
                    compact
                  />
                ))}
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function AgentToolGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  isStreaming,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const t = useTranslation()
  const statuses = toolCalls.map((toolCall) =>
    getAgentStatus({
      hasResult: resultMap.has(toolCall.toolUseId),
      isError: !!resultMap.get(toolCall.toolUseId)?.isError,
      isLaunchResult: isAgentLaunchResult(resultMap.get(toolCall.toolUseId)?.content),
      isStreaming: !!isStreaming && !resultMap.has(toolCall.toolUseId),
      childCount: (childToolCallsByParent.get(toolCall.toolUseId) ?? []).length,
      taskStatus: agentTaskNotifications[toolCall.toolUseId]?.status,
    }),
  )
  const isAnyRunning = statuses.some((status) => status === 'running' || status === 'starting')
  const errorPresent = statuses.some((status) => status === 'failed')
  const allComplete = statuses.every((status) => status === 'done')
  const anyStopped = statuses.some((status) => status === 'stopped')

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true)
    }
  }, [isStreaming])

  return (
    <TraceCollapsible open={expanded} onOpenChange={setExpanded} className="mb-2">
      <TraceCollapsibleTrigger className="min-h-7 w-full gap-2 text-ui-aux">
        {isAnyRunning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)] animate-pulse-dot" aria-hidden="true" />}
        {!isAnyRunning && errorPresent && <CircleAlert size={14} aria-hidden="true" className="shrink-0 text-[var(--color-error)]" />}
        {!isAnyRunning && !errorPresent && allComplete && <Check size={14} aria-hidden="true" className="shrink-0 text-[var(--color-success)]" />}
        {!isAnyRunning && !errorPresent && !allComplete && !anyStopped && <CircleDot size={13} aria-hidden="true" className="shrink-0" />}
        {!isAnyRunning && !errorPresent && !allComplete && anyStopped && <Square size={12} aria-hidden="true" className="shrink-0" />}
        <TraceLine status={isAnyRunning ? 'running' : errorPresent ? 'error' : undefined}><TraceTitle>
          {toolCalls.length === 1 ? t('toolGroup.agentOne') : t('toolGroup.agentMany', { count: toolCalls.length })}
        </TraceTitle></TraceLine>
        {isAnyRunning && (
          <span className="shrink-0 text-[var(--color-text-tertiary)] before:mr-1 before:content-['·']">{t('agentStatus.running')}</span>
        )}
      </TraceCollapsibleTrigger>

      <CollapsibleContent>
        <div className="relative mt-2 pl-5">
          <div className="absolute bottom-6 left-[11px] top-4 w-px rounded-full bg-[var(--color-border)]/45" />
          <div className="space-y-2">
            {toolCalls.map((toolCall) => (
              <div key={toolCall.id} className="relative pl-7">
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <div className="absolute left-[11px] top-1/2 h-px w-4 -translate-y-1/2 bg-[var(--color-border)]/45" />
                  <div className="absolute left-[8px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[var(--color-border)]/65 bg-[var(--color-surface-container-lowest)] shadow-[0_0_0_2px_var(--color-surface)]" />
                </div>
                <AgentCallCard
                  toolCall={toolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  agentTaskNotification={agentTaskNotifications[toolCall.toolUseId]}
                  isStreaming={isStreaming && !resultMap.has(toolCall.toolUseId)}
                />
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </TraceCollapsible>
  )
}

function ToolCallGroupMulti({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  steps = toolCalls,
  activeThinkingId = null,
  isStreaming,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const summary = generateSummary(toolCalls, t, steps.length - toolCalls.length)
  const errorPresent = groupHasErrors(toolCalls, resultMap, childToolCallsByParent)
  const hasUnresolvedTools = hasUnresolvedToolCalls(toolCalls, resultMap, childToolCallsByParent)
  const isRunning = !!isStreaming || hasUnresolvedTools || activeThinkingId !== null

  return (
    <TraceCollapsible open={expanded} onOpenChange={setExpanded} className="mb-2">
      <TraceCollapsibleTrigger className="min-h-7 w-full gap-2 text-ui-aux">
        {!isRunning && !errorPresent && <Check size={14} aria-hidden="true" className="shrink-0 text-[var(--color-success)]" />}
        {!isRunning && errorPresent && <CircleAlert size={14} aria-hidden="true" className="shrink-0 text-[var(--color-error)]" />}
        {isRunning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)] animate-pulse-dot" aria-hidden="true" />}
        <TraceLine status={isRunning ? 'running' : errorPresent ? 'error' : undefined}><TraceTitle>{summary}</TraceTitle></TraceLine>
      </TraceCollapsibleTrigger>

      <TraceCollapsibleContent className="ml-[6px] mt-1.5 space-y-1 pl-[18px]">
        {steps.map((step) => step.type === 'thinking'
          ? <ThinkingBlock key={step.id} content={step.content} isActive={step.id === activeThinkingId} />
          : (
            <ToolCallTree
              key={step.id}
              toolCall={step}
              resultMap={resultMap}
              childToolCallsByParent={childToolCallsByParent}
              compact
            />
          ))}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function AgentCallCard({
  toolCall,
  resultMap,
  childToolCallsByParent,
  agentTaskNotification,
  isStreaming = false,
}: {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotification?: AgentTaskNotification
  isStreaming?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const t = useTranslation()
  const input = toolCall.input && typeof toolCall.input === 'object'
    ? toolCall.input as Record<string, unknown>
    : {}
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []
  const isLaunchResult = isAgentLaunchResult(result?.content)
  const recentToolCalls = childToolCalls.slice(-2)
  const status = getAgentStatus({
    hasResult: !!result,
    isError: !!result?.isError,
    isLaunchResult,
    isStreaming,
    childCount: childToolCalls.length,
    taskStatus: agentTaskNotification?.status,
  })
  const statusClassName = getAgentStatusClassName(status)
  const statusLabel = getAgentStatusLabel(status, t)
  const taskSummary = agentTaskNotification?.summary?.trim() || ''
  const taskResult = agentTaskNotification?.result?.trim() || ''
  const errorText =
    status === 'failed'
      ? taskSummary || (result?.isError ? getAgentErrorSummary(result.content) : '')
      : result?.isError
        ? getAgentErrorSummary(result.content)
        : ''
  const fullOutputText =
    result && !result.isError && !isLaunchResult && !isAgentLifecycleResult(result.content)
      ? extractAgentDisplayText(result.content).trim()
      : ''
  const terminalTaskReport = status === 'done' || status === 'stopped' ? taskResult : ''
  const terminalTaskSummary = status === 'done' || status === 'stopped' ? taskSummary : ''
  const previewText = terminalTaskReport || fullOutputText || terminalTaskSummary
  const outputSummary = previewText ? getAgentOutputSummary(previewText) : ''
  const description = typeof input.description === 'string' ? input.description : ''

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="overflow-hidden rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-surface-container-lowest)]">
      <div className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]/50">
        <TraceIcon><Bot /></TraceIcon>
        <div className="min-w-0 flex-1">
          <TraceLine status={status === 'running' || status === 'starting' ? 'running' : status === 'failed' ? 'error' : undefined}>
            <TraceTitle>Agent</TraceTitle>
            {description && (
              <TraceDescription className="min-w-0 shrink truncate">{description}</TraceDescription>
            )}
          </TraceLine>
          {!expanded && outputSummary && (
            <div className="mt-1 line-clamp-2 text-[11px] text-[var(--color-text-tertiary)]">
              {outputSummary}
            </div>
          )}
          {!expanded && !outputSummary && recentToolCalls.length > 0 && (
            <div className="mt-1 space-y-1">
              {recentToolCalls.map((recentToolCall) => (
                <div
                  key={recentToolCall.id}
                  className="truncate text-[11px] text-[var(--color-text-tertiary)]"
                >
                  {formatRecentToolUseSummary(recentToolCall, resultMap, t)}
                </div>
              ))}
            </div>
          )}
          {!expanded && !outputSummary && !recentToolCalls.length && errorText && (
            <div className="mt-1 truncate text-[11px] text-[var(--color-error)]">
              {errorText}
            </div>
          )}
        </div>
        {outputSummary && (
          <Button variant="ghost"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setPreviewOpen(true)
            }}
            className="shrink-0 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            {t('agentStatus.viewResult')}
          </Button>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClassName}`}>
          {statusLabel}
        </span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm"
            type="button"
            className="rounded-full text-[var(--color-outline)] hover:bg-[var(--color-surface-hover)]"
            aria-label={t(expanded ? 'agentStatus.collapse' : 'agentStatus.expand')}
          >
            <ChevronDown className="group-data-[state=open]/button:rotate-180" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="border-t border-[var(--color-border)]/60 px-3 py-3">
          {errorText && (
            <div className="mb-3 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/60 px-3 py-2 text-[11px] text-[var(--color-error)]">
              {errorText}
            </div>
          )}
          {childToolCalls.length > 0 ? (
            <div className="space-y-1">
              {childToolCalls.map((childToolCall) => (
                <ToolCallTree
                  key={childToolCall.id}
                  toolCall={childToolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  compact
                />
              ))}
            </div>
          ) : outputSummary ? (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              {t('agentStatus.noActivity')}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              {status === 'starting' ? t('agentStatus.starting') : t('agentStatus.noActivity')}
            </div>
          )}
        </div>
      </CollapsibleContent>
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={description || t('agentStatus.resultTitle')}
        width={900}
      >
        <div className="max-h-[70vh] overflow-y-auto">
          <MarkdownRenderer content={previewText || errorText} />
        </div>
      </Modal>
    </Collapsible>
  )
}

function ToolCallTree({
  toolCall,
  resultMap,
  childToolCallsByParent,
  compact = false,
}: {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  compact?: boolean
}) {
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []

  return (
    <div className={compact ? 'space-y-1' : ''}>
      <ToolCallBlock
        toolName={toolCall.toolName}
        input={toolCall.input}
        result={result ? { content: result.content, isError: result.isError } : null}
        compact={compact}
        isPending={toolCall.isPending}
        partialInput={toolCall.partialInput}
      />
      {childToolCalls.length > 0 && (
        <div className={compact ? 'ml-4 border-l border-[var(--color-border)]/60 pl-3' : 'mb-2 ml-16 border-l border-[var(--color-border)]/60 pl-3'}>
          <div className="space-y-1">
            {childToolCalls.map((childToolCall) => (
              <ToolCallTree
                key={childToolCall.id}
                toolCall={childToolCall}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function openMemorySettings(path?: string) {
  const ui = useUIStore.getState()
  if (path) ui.setPendingMemoryPath(path)
  ui.openSettings('memory')
}

function getMemoryToolActivity(
  toolCalls: ToolCall[],
  resultMap: Map<string, ToolResult>,
): MemoryToolActivity | null {
  const filesByPath = new Map<string, MemoryToolFile>()
  let sawSave = false

  for (const toolCall of toolCalls) {
    if (toolCall.isPending) continue
    const path = getToolFilePath(toolCall.input)
    if (!path || !isMemoryMarkdownPath(path)) continue

    const isSave = isMemoryWriteTool(toolCall.toolName)
    const isReference = toolCall.toolName === 'Read'
    if (!isSave && !isReference) continue
    sawSave ||= isSave

    const result = resultMap.get(toolCall.toolUseId)
    const preview = extractMemoryPreview(result?.content)
    const current = filesByPath.get(path)
    filesByPath.set(path, {
      path,
      label: memoryFileLabel(path),
      action: isSave ? 'saved' : (current?.action ?? 'referenced'),
      lineHint: preview.lineHint || current?.lineHint,
      preview: preview.text || current?.preview,
    })
  }

  if (filesByPath.size === 0) return null
  return {
    action: sawSave ? 'saved' : 'referenced',
    files: [...filesByPath.values()],
  }
}

function isMemoryToolCall(toolCall: ToolCall): boolean {
  if (toolCall.isPending) return false
  const path = getToolFilePath(toolCall.input)
  if (!path || !isMemoryMarkdownPath(path)) return false
  return toolCall.toolName === 'Read' || isMemoryWriteTool(toolCall.toolName)
}

function isMemoryWriteTool(toolName: string): boolean {
  return toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit'
}

function getToolFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const filePath = record.file_path ?? record.path
  return typeof filePath === 'string' ? filePath : null
}

function isMemoryMarkdownPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized.endsWith('.md') && normalized.includes('/memory/')
}

function memoryFileLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

function extractMemoryPreview(content: unknown): { text?: string; lineHint?: string } {
  const raw = extractTextContent(content)
  if (!raw) return {}
  const lineHint = extractLineHint(raw)
  const lines = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\s*/, '').trim())
    .filter(Boolean)

  let inFrontmatter = false
  for (const line of lines) {
    if (line === '---') {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (inFrontmatter) continue
    const normalized = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()
    if (!normalized || normalized === '---') continue
    if (/^(file|lines?|total)\b/i.test(normalized)) continue
    return {
      text: normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized,
      lineHint,
    }
  }
  return { lineHint }
}

function extractLineHint(text: string): string | undefined {
  const match = text.match(/(\d+)\s+lines?\b/i) ?? text.match(/(\d+)\s+行/)
  return match?.[1] ? `${match[1]} lines` : undefined
}

type AgentStatus = 'starting' | 'running' | 'done' | 'failed' | 'stopped'
type AgentTaskStatus = AgentTaskNotification['status']

function getAgentStatus({
  hasResult,
  isError,
  isLaunchResult,
  isStreaming,
  childCount,
  taskStatus,
}: {
  hasResult: boolean
  isError: boolean
  isLaunchResult: boolean
  isStreaming: boolean
  childCount: number
  taskStatus?: AgentTaskStatus
}): AgentStatus {
  if (taskStatus === 'failed') return 'failed'
  if (taskStatus === 'stopped') return 'stopped'
  if (taskStatus === 'completed') return 'done'
  if (hasResult && isError && !isLaunchResult) return 'failed'
  if (hasResult && !isLaunchResult) return 'done'
  if (isStreaming || childCount > 0 || isLaunchResult) return 'running'
  return 'starting'
}

function getAgentStatusLabel(
  status: AgentStatus,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  switch (status) {
    case 'failed':
      return t('agentStatus.failed')
    case 'stopped':
      return t('agentStatus.stopped')
    case 'done':
      return t('agentStatus.done')
    case 'running':
      return t('agentStatus.running')
    case 'starting':
    default:
      return t('agentStatus.starting')
  }
}

function getAgentStatusClassName(status: AgentStatus): string {
  switch (status) {
    case 'failed':
      return 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
    case 'stopped':
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
    case 'done':
      return 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
    case 'running':
      return 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
    case 'starting':
    default:
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
  }
}

function formatRecentToolUseSummary(
  toolCall: ToolCall,
  resultMap: Map<string, ToolResult>,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const input = toolCall.input && typeof toolCall.input === 'object'
    ? toolCall.input as Record<string, unknown>
    : {}
  const result = resultMap.get(toolCall.toolUseId)
  const suffix = result?.isError ? ' • failed' : result ? ' • done' : ' • running'

  switch (toolCall.toolName) {
    case 'Bash':
      return `Bash · ${typeof input.command === 'string' ? input.command : ''}${suffix}`
    case 'Read':
      return `Read · ${typeof input.file_path === 'string' ? input.file_path.split('/').pop() : 'file'}${suffix}`
    case 'Glob':
      return `Glob · ${typeof input.pattern === 'string' ? input.pattern : ''}${suffix}`
    case 'Grep':
      return `Grep · ${typeof input.pattern === 'string' ? input.pattern : ''}${suffix}`
    case 'Agent':
      return `Agent · ${typeof input.description === 'string' ? input.description : ''}${suffix}`
    default: {
      const cua = getCuaToolDisplay(toolCall.toolName, toolCall.input, t)
      if (cua) return `${cua.title}${cua.summary ? ` · ${cua.summary}` : ''}${suffix}`
      return `${toolCall.toolName}${suffix}`
    }
  }
}

function getAgentErrorSummary(content: unknown): string {
  const text = extractTextContent(content).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.includes(`Agent type 'Explore' not found`)) {
    return 'Explore agent unavailable in this session'
  }
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function getAgentOutputSummary(content: string): string {
  const text = content.replace(/\s+\n/g, '\n').trim()
  if (!text) return ''
  return text.length > 220 ? `${text.slice(0, 220)}...` : text
}

function extractAgentDisplayText(content: unknown): string {
  return stripAgentResultMetadata(formatAgentStructuredResult(content) || extractTextContent(content))
}

function formatAgentStructuredResult(content: unknown): string {
  const structured = parseStructuredAgentContent(content)
  if (!structured || Array.isArray(structured)) return ''

  const results = structured.results
  if (!Array.isArray(results) || results.length === 0) return ''

  const items = results
    .map((result, index) => formatAgentStructuredResultItem(result, index))
    .filter(Boolean)

  return items.join('\n')
}

function parseStructuredAgentContent(content: unknown): Record<string, unknown> | unknown[] | null {
  if (typeof content === 'string') {
    return parseStructuredAgentText(content)
  }

  if (Array.isArray(content)) {
    return parseStructuredAgentText(extractTextContent(content))
  }

  if (content && typeof content === 'object') {
    if ('results' in content) return content as Record<string, unknown>

    const extracted = extractTextContent(content)
    return extracted ? parseStructuredAgentText(extracted) : null
  }

  return null
}

function parseStructuredAgentText(text: string): Record<string, unknown> | unknown[] | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> | unknown[] : null
  } catch {
    return null
  }
}

function formatAgentStructuredResultItem(result: unknown, index: number): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    const text = extractTextContent(result).trim()
    return text ? `${index + 1}. ${text}` : ''
  }

  const record = result as Record<string, unknown>
  const location = formatAgentResultLocation(record)
  const context = getStringField(record, 'context')
  const snippet = getStringField(record, 'snippet')
  const message = getStringField(record, 'message') || getStringField(record, 'text') || getStringField(record, 'summary')
  const nestedItems = Array.isArray(record.items) ? record.items : []

  if (nestedItems.length > 0) {
    const label = getStringField(record, 'risk') || getStringField(record, 'title') || message || 'Grouped results'
    const lines = [`${index + 1}. ${formatAgentGroupLabel(label)}`]
    if (context) lines.push(`   - ${context}`)
    if (snippet) lines.push(`   - ${snippet}`)

    nestedItems
      .map(formatAgentStructuredNestedItem)
      .filter(Boolean)
      .forEach((item) => {
        lines.push(
          item
            .split('\n')
            .map((line, lineIndex) => `${lineIndex === 0 ? '   - ' : '     '}${line}`)
            .join('\n'),
        )
      })

    return lines.join('\n')
  }

  const lines = [`${index + 1}. ${location ? formatInlineCode(location) : 'Result'}`]

  if (message) lines.push(`   - ${message}`)
  if (context) lines.push(`   - ${context}`)
  if (snippet) lines.push(`   - ${snippet}`)

  return lines.join('\n')
}

function formatAgentStructuredNestedItem(item: unknown): string {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return extractTextContent(item).trim()
  }

  const record = item as Record<string, unknown>
  const location = formatAgentResultLocation(record)
  const context = getStringField(record, 'context')
  const snippet = getStringField(record, 'snippet')
  const message = getStringField(record, 'message') || getStringField(record, 'text') || getStringField(record, 'summary')
  const headingParts = [location ? formatInlineCode(location) : '', message].filter(Boolean)
  const lines = [headingParts.join(' - ') || 'Result']

  if (context) lines.push(context)
  if (snippet) lines.push(snippet)

  return lines.join('\n')
}

function formatAgentGroupLabel(label: string): string {
  const normalized = label.trim()
  if (!normalized) return 'Grouped results'
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
}

function formatAgentResultLocation(record: Record<string, unknown>): string {
  const file = getStringField(record, 'file')
  if (!file) return ''
  const line = typeof record.line === 'number' ? record.line : null
  return line !== null ? `${file}:${line}` : file
}

function getStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function formatInlineCode(value: string): string {
  return `\`${value.replace(/`/g, '\\`')}\``
}

function stripAgentResultMetadata(text: string): string {
  return text
    .replace(/^\s*agentId:.*(?:\r?\n)?/gm, '')
    .replace(/<usage>[\s\S]*?<\/usage>/g, '')
    .replace(/^\s*(?:total_tokens|tool_uses|duration_ms):\s*\d+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isAgentLaunchResult(content: unknown): boolean {
  const text = extractTextContent(content).trim()
  if (!text) return false

  return (
    text.startsWith('Async agent launched successfully.') ||
    text.startsWith('Remote agent launched in CCR.') ||
    (text.startsWith('Spawned successfully.') &&
      text.includes('The agent is now running and will receive instructions via mailbox.')) ||
    text.includes('The agent is working in the background. You will be notified automatically when it completes.') ||
    text.includes('The agent is running remotely. You will be notified automatically when it completes.')
  )
}

function isAgentLifecycleResult(content: unknown): boolean {
  const text = extractTextContent(content).trim()
  if (!text) return false
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed.type === 'string' && AGENT_LIFECYCLE_TYPES.has(parsed.type)) {
        return true
      }
    } catch {
    }
  }
  return false
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (typeof chunk === 'string') return chunk
        if (chunk && typeof chunk === 'object' && 'text' in chunk) {
          return typeof chunk.text === 'string' ? chunk.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    if (
      'status' in content &&
      (content as Record<string, unknown>).status === 'completed' &&
      Array.isArray((content as Record<string, unknown>).content)
    ) {
      return extractTextContent((content as Record<string, unknown>).content)
    }
    }
  if (content && typeof content === 'object') {
    return JSON.stringify(content)
  }
  return ''
}
