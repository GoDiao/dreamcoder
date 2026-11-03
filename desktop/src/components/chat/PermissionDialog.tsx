import { Check, BadgeCheck, ChevronDown, FolderOpen, Search, ShieldCheck, X } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../shared/ui/card'
import { CodeBlock, CodeBlockContent, CodeBlockLine } from '../shared/ui/code-block'
import { CodeViewer } from './CodeViewer'
import { getToolIcon } from './toolIcons'
import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Button } from '../shared/ui/button'
import { AwaitingApprovalBadge } from './AwaitingApprovalBadge'
import { DiffViewer } from './DiffViewer'
import { getCuaToolDisplay } from '../../lib/cuaToolDisplay'
import type { PermissionGuardrailDetails, PermissionResolution } from '../../types/chat'

type Props = {
  sessionId?: string | null
  requestId: string
  toolName: string
  input: unknown
  description?: string
  guardrail?: PermissionGuardrailDetails
  resolution?: PermissionResolution
}

function extractToolDetails(toolName: string, input: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string): { primary: string; secondary?: string } {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}

  switch (toolName) {
    case 'Bash': {
      const cmd = typeof obj.command === 'string' ? obj.command : ''
      const desc = typeof obj.description === 'string' ? obj.description : undefined
      return { primary: cmd, secondary: desc }
    }
    case 'Edit': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath, secondary: obj.old_string ? t('permission.replacingContent') : undefined }
    }
    case 'Write': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Read': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Glob':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Grep':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Agent':
      return { primary: typeof obj.description === 'string' ? obj.description : '' }
    case 'WebSearch':
      return { primary: typeof obj.query === 'string' ? obj.query : '' }
    case 'WebFetch':
      return { primary: typeof obj.url === 'string' ? obj.url : '' }
    default:
      return { primary: typeof input === 'string' ? input : JSON.stringify(input, null, 2) }
  }
}

function getPermissionTitle(toolName: string, input: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
  const fileName = filePath ? filePath.split('/').pop() || filePath : ''

  switch (toolName) {
    case 'Edit':
    case 'Write':
      return fileName ? t('permission.allowEditFile', { toolName, fileName }) : t('permission.allowEditFileGeneric', { toolName: toolName.toLowerCase() })
    case 'Bash':
      return t('permission.allowBash')
    default:
      return t('permission.allowTool', { toolName })
  }
}

function renderPermissionPreview(toolName: string, input: unknown) {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if (toolName === 'Edit' && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if (toolName === 'Write' && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  if (toolName === 'Bash' && typeof obj.command === 'string') {
    return (
      <CodeBlock size="sm">
        <CodeBlockContent wrap><CodeBlockLine><span className="select-none">$ </span>{obj.command}</CodeBlockLine></CodeBlockContent>
      </CodeBlock>
    )
  }

  return null
}

function resolutionLabelKey(resolution: PermissionResolution | undefined): TranslationKey {
  if (!resolution?.remote) return 'permission.responded'
  if (resolution.outcome === 'withdrawn') return 'permission.withdrawn'
  return resolution.outcome === 'allowed' ? 'permission.allowedElsewhere' : 'permission.deniedElsewhere'
}

export function PermissionDialog({ sessionId, requestId, toolName, input, description, guardrail, resolution }: Props) {
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const targetSessionId = sessionId ?? activeTabId
  const isPending = useChatStore((s) =>
    targetSessionId ? s.sessions[targetSessionId]?.pendingPermission?.requestId === requestId : false,
  )
  const t = useTranslation()
  const [showRaw, setShowRaw] = useState(false)

  const cua = getCuaToolDisplay(toolName, input, t)
  const Icon = getToolIcon(toolName, cua?.icon)
  const details = cua ? { primary: cua.summary } : extractToolDetails(toolName, input, t)
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  const preview = cua ? null : renderPermissionPreview(toolName, input)
  const title = cua ? cua.permissionTitle : getPermissionTitle(toolName, input, t)
  // CLI-supplied descriptions for MCP tools quote the raw `mcp__cua__…` name; hide those.
  const shownDescription = cua && description && /mcp__|\bMCP\b/i.test(description) ? undefined : description
  const DetailIcon = cua ? Icon : toolName === 'Glob' || toolName === 'Grep' ? Search : FolderOpen
  const allowRawToggle = !preview
  const guardrailScore = guardrail?.score === null
    ? t('chat.permissionGuardrail.scoreUnavailable')
    : guardrail
      ? t('chat.permissionGuardrail.score', { score: guardrail.score.toFixed(3) })
      : null

  return (
    <Card size="sm" className={`mb-4 gap-0 py-0 border ${
      isPending
        ? 'border-[var(--color-warning)] bg-[var(--color-surface-container-lowest)]'
        : 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-low)] opacity-70'
    }`}>
      <CardHeader className={`flex flex-row items-center gap-3 px-4 py-3 ${
        isPending
          ? 'bg-[var(--color-surface-container)]'
          : 'bg-[var(--color-surface-container-low)]'
      }`}>
        <Icon className="size-5 shrink-0 text-ui-muted-foreground" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle>{title}</CardTitle>
            {isPending && <AwaitingApprovalBadge />}
            {!isPending && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]">
                {t(resolutionLabelKey(resolution))}
              </span>
            )}
          </div>
          {shownDescription && (
            <CardDescription className="truncate">{shownDescription}</CardDescription>
          )}
        </div>
      </CardHeader>

      <CardContent className="border-t border-ui-border px-4 py-3">
        {guardrail && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-[var(--color-warning)]/35 bg-[var(--color-warning-container)]/35 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <div className="font-medium text-[var(--color-text-primary)]">
                {t('settings.permissionGuardrail.title')}
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span>{guardrail.modelId}</span>
                <span>{t(guardrail.preset === 'safetyNet'
                  ? 'settings.permissionGuardrail.safetyNet'
                  : 'settings.permissionGuardrail.fewerPrompts')}</span>
                <span>{t('chat.permissionGuardrail.decision', { decision: guardrail.decision })}</span>
                <span>{guardrailScore}</span>
              </div>
            </div>
          </div>
        )}
        {preview ? (
          <div className="space-y-2">
            {details.primary && toolName !== 'Bash' ? (
              <div className="flex items-center gap-2 rounded-md bg-[var(--color-surface-container)] px-3 py-2 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{details.primary}</span>
              </div>
            ) : null}
            {preview}
          </div>
        ) : details.primary ? (
          <div className="mb-2">
            <div className="flex items-center gap-2 rounded-md bg-[var(--color-surface-container)] px-3 py-2 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)]">
              <DetailIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{details.primary}</span>
            </div>
          </div>
        ) : null}

        {details.secondary && (
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{details.secondary}</p>
        )}

        {allowRawToggle && (
          <Button variant="ghost" size="xs" aria-expanded={showRaw}
            onClick={() => setShowRaw(!showRaw)}
            className="mt-2 flex cursor-pointer items-center gap-1 text-[11px] text-[var(--color-text-accent)] hover:underline"
          >
            <ChevronDown className={showRaw ? 'rotate-180' : undefined} aria-hidden="true" />
            {showRaw ? t('permission.hideDetails') : t('permission.showFullInput')}
          </Button>
        )}

        {allowRawToggle && showRaw && (
          <CodeViewer code={rawInput} language={typeof input === 'string' ? 'text' : 'json'} />
        )}
      </CardContent>

      {isPending && (
        <CardFooter className="gap-2 px-4 py-3">
          <Button
            size="sm"
            onClick={() => targetSessionId && respondToPermission(targetSessionId, requestId, true)}
          >
            <Check data-icon="inline-start" aria-hidden="true" />
            {t('permission.allow')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => targetSessionId && respondToPermission(targetSessionId, requestId, true, { rule: 'always' })}
          >
            <BadgeCheck data-icon="inline-start" aria-hidden="true" />
            {t('permission.allowForSession')}
          </Button>
          <div className="flex-1" />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => targetSessionId && respondToPermission(targetSessionId, requestId, false)}
          >
            <X data-icon="inline-start" aria-hidden="true" />
            {t('permission.deny')}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
