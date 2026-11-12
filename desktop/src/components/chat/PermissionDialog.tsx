import { Check, BadgeCheck, ChevronDown, FolderOpen, Search, ShieldCheck, X } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../shared/ui/card'
import { CodeBlock, CodeBlockContent, CodeBlockLine } from '../shared/ui/code-block'
import { CodeViewer } from './CodeViewer'
import { getToolIcon } from './toolIcons'
import { useState, type ReactNode } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { boardForProject, useKanbanStore } from '../../stores/kanbanStore'
import { useSessionStore } from '../../stores/sessionStore'
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
  alwaysAsks?: boolean
  resolution?: PermissionResolution
}

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

type SpecialDisplay = { title: string; primary: string; secondary?: string; preview?: ReactNode }

type KanbanRole = 'owner' | 'reviewer'

type KanbanAssign = {
  card: number
  role: KanbanRole
  target: { kind: 'self' } | { kind: 'new' } | { kind: 'session'; sessionId: string }
}

const KANBAN_ASSIGN_TITLE: Record<KanbanRole, TranslationKey> = {
  owner: 'permission.allowKanbanAssign.owner',
  reviewer: 'permission.allowKanbanAssign.reviewer',
}

const KANBAN_START_TITLE: Record<KanbanRole, TranslationKey> = {
  owner: 'permission.allowStartSessionForCard.owner',
  reviewer: 'permission.allowStartSessionForCard.reviewer',
}

const KANBAN_ROLE_NOTE: Record<KanbanRole, TranslationKey> = {
  owner: 'permission.kanbanRole.owner',
  reviewer: 'permission.kanbanRole.reviewer',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function kanbanRole(value: unknown): KanbanRole | null {
  return value === 'owner' || value === 'reviewer' ? value : null
}

function kanbanAssign(toolName: string, input: unknown): KanbanAssign | null {
  const obj = record(input)
  if (toolName === 'StartSession') return typeof obj.card === 'number' ? { card: obj.card, role: kanbanRole(obj.role) ?? 'owner', target: { kind: 'new' } } : null
  if (toolName !== 'KanbanUpdate') return null
  const command = record(obj.command)
  const role = kanbanRole(command.role)
  if (command.type !== 'assign' || typeof command.card !== 'number' || !role) return null
  if (command.target === 'self') return { card: command.card, role, target: { kind: 'self' } }
  const sessionId = record(command.target).sessionId
  return typeof sessionId === 'string' ? { card: command.card, role, target: { kind: 'session', sessionId } } : null
}

function kanbanCancel(toolName: string, input: unknown): { card: number; reason: string | null } | null {
  if (toolName !== 'KanbanUpdate') return null
  const command = record(record(input).command)
  if (command.type !== 'cancel' || typeof command.card !== 'number') return null
  return { card: command.card, reason: typeof command.reason === 'string' && command.reason.trim() ? command.reason : null }
}

function kanbanAcceptance(toolName: string, input: unknown): { card: number; items: string[] } | null {
  if (toolName !== 'KanbanUpdate') return null
  const command = record(record(input).command)
  if (command.type !== 'edit_card' || typeof command.card !== 'number' || !Array.isArray(command.acceptance)) return null
  return { card: command.card, items: command.acceptance.filter((item): item is string => typeof item === 'string') }
}

function AcceptanceChange({ before, after, t }: { before: readonly string[] | null; after: readonly string[]; t: Translate }) {
  const removed = before?.filter((item) => !after.includes(item)) ?? []
  const tag = (key: TranslationKey) => <span className="shrink-0 rounded bg-[var(--color-surface-container-high)] px-1.5 text-[10px] text-[var(--color-text-secondary)]">{t(key)}</span>
  return (
    <ul className="flex flex-col gap-1 text-xs text-[var(--color-text-primary)]">
      {after.map((item) => (
        <li key={`after-${item}`} className="flex items-start gap-2">
          {before && !before.includes(item) ? tag('permission.kanbanAcceptance.added') : <span aria-hidden="true" className="mt-[5px] size-1.5 shrink-0 rounded-full bg-[var(--color-text-tertiary)]" />}
          <span>{item}</span>
        </li>
      ))}
      {removed.map((item) => (
        <li key={`removed-${item}`} className="flex items-start gap-2 text-[var(--color-text-tertiary)]">
          {tag('permission.kanbanAcceptance.removed')}
          <span className="line-through">{item}</span>
        </li>
      ))}
    </ul>
  )
}

function kanbanAssignTitle(assign: KanbanAssign, targetTitle: string | null, t: Translate): string {
  const { target } = assign
  if (target.kind === 'new') return t(KANBAN_START_TITLE[assign.role], { card: assign.card })
  const who = target.kind === 'self' ? t('permission.kanbanAssign.self') : targetTitle || target.sessionId
  return t(KANBAN_ASSIGN_TITLE[assign.role], { card: assign.card, target: who })
}

function extractToolDetails(toolName: string, input: unknown, t: Translate): { primary: string; secondary?: string } {
  const obj = record(input)

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
    case 'KanbanCreate':
      return { primary: typeof obj.title === 'string' ? obj.title : '', secondary: typeof obj.description === 'string' && obj.description ? obj.description : undefined }
    default: {
      const raw = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
      return { primary: raw === '{}' ? '' : raw }
    }
  }
}

function getPermissionTitle(toolName: string, input: unknown, alwaysAsks: boolean, t: Translate) {
  const obj = record(input)
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
  const fileName = filePath ? filePath.split('/').pop() || filePath : ''

  switch (toolName) {
    case 'Edit':
    case 'Write':
      return fileName ? t('permission.allowEditFile', { toolName, fileName }) : t('permission.allowEditFileGeneric', { toolName: toolName.toLowerCase() })
    case 'Bash':
      return t('permission.allowBash')
    case 'KanbanCreate':
      return t(alwaysAsks ? 'permission.allowKanbanBoard' : 'permission.allowKanbanCard')
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

export function PermissionDialog({ sessionId, requestId, toolName, input, description, guardrail, alwaysAsks, resolution }: Props) {
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const targetSessionId = sessionId ?? activeTabId
  const isPending = useChatStore((s) =>
    targetSessionId ? s.sessions[targetSessionId]?.pendingPermission?.requestId === requestId : false,
  )
  const t = useTranslation()
  const [showRaw, setShowRaw] = useState(false)
  const projectRoot = useSessionStore((s) => s.sessions.find((session) => session.id === targetSessionId)?.projectRoot)
  const assign = kanbanAssign(toolName, input)
  const cancel = kanbanCancel(toolName, input)
  const acceptance = kanbanAcceptance(toolName, input)
  const boardCard = assign?.card ?? cancel?.card ?? acceptance?.card ?? null
  const loadedCard = useKanbanStore((s) => {
    const board = boardCard === null ? null : boardForProject(s.boards, projectRoot)
    return board ? s.views[board.key]?.cards.find((card) => card.id === boardCard) ?? null : null
  })
  const boardCardTitle = loadedCard?.title ?? null
  const boardCardLabel = boardCard === null ? null : boardCardTitle ? `#${boardCard} ${boardCardTitle}` : `#${boardCard}`
  const assignTarget = useSessionStore((s) => {
    const target = assign?.target
    return target?.kind === 'session' ? s.sessions.find((session) => session.id === target.sessionId)?.title ?? null : null
  })

  const cua = getCuaToolDisplay(toolName, input, t)
  const Icon = getToolIcon(toolName, cua?.icon)
  const card = boardCardLabel ?? ''
  const special: SpecialDisplay | null = cua
    ? { title: cua.permissionTitle, primary: cua.summary }
    : assign
      ? { title: kanbanAssignTitle(assign, assignTarget, t), primary: card, secondary: t(KANBAN_ROLE_NOTE[assign.role]) }
      : cancel
        ? { title: t('permission.allowKanbanCancel', { card: cancel.card }), primary: card, secondary: cancel.reason ?? t('permission.kanbanCancel.note') }
        : acceptance
          ? {
              title: t('permission.allowKanbanAcceptance', { card: acceptance.card }),
              primary: card,
              secondary: t('permission.kanbanAcceptance.note'),
              preview: <AcceptanceChange before={isPending ? loadedCard?.acceptance ?? null : null} after={acceptance.items} t={t} />,
            }
          : null
  const details = special ?? extractToolDetails(toolName, input, t)
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  const preview = special ? special.preview ?? null : renderPermissionPreview(toolName, input)
  const title = special?.title ?? getPermissionTitle(toolName, input, alwaysAsks === true, t)
  // CLI-supplied descriptions for MCP tools quote the raw `mcp__cua__…` name; hide those.
  const shownDescription = cua && description && /mcp__|\bMCP\b/i.test(description) ? undefined : description
  const DetailIcon = cua ? Icon : toolName === 'Glob' || toolName === 'Grep' ? Search : FolderOpen
  const allowRawToggle = !preview && rawInput !== '{}'
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
                {t('settings.autoPermission.title')}
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span>{guardrail.modelId}</span>
                <span>{t(guardrail.source === 'decisionProvider'
                  ? 'chat.permissionGuardrail.decisionProvider'
                  : 'chat.permissionGuardrail.fastModel')}</span>
                <span>{t('chat.permissionGuardrail.decision', { decision: guardrail.decision })}</span>
                <span>{guardrailScore}</span>
                <span>{t('chat.permissionGuardrail.policyVersion', { version: String(guardrail.policyVersion) })}</span>
              </div>
              {guardrail.reason ? <div>{guardrail.reason}</div> : null}
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
          {!alwaysAsks && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => targetSessionId && respondToPermission(targetSessionId, requestId, true, { rule: 'always' })}
            >
              <BadgeCheck data-icon="inline-start" aria-hidden="true" />
              {t('permission.allowForSession')}
            </Button>
          )}
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
