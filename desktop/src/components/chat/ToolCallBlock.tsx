import { CodeBlock, CodeBlockContent, CodeBlockLine, CodeBlockActions } from '../shared/ui/code-block'
import { Button } from '../shared/ui/button'
import { Trace, TraceCollapsible, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'
import { CollapsibleContent } from '../shared/ui/collapsible'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { memo, useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { getToolIcon } from './toolIcons'
import { CodeViewer } from './CodeViewer'
import { DiffViewer } from './DiffViewer'
import { CopyButton } from '../shared/CopyButton'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import type { AgentTaskNotification } from '../../types/chat'
import { getCuaToolDisplay, humanizeCuaResult, isCuaPermissionError } from '../../lib/cuaToolDisplay'
import { useUIStore } from '../../stores/uiStore'
import { ToolResultImages, extractToolResultImages } from './ToolResultImages'
import { parseUiPageResult } from '../../lib/uiPageBridge'

type Props = {
  toolName: string
  input: unknown
  result?: { content: unknown; isError: boolean } | null
  agentTaskNotification?: AgentTaskNotification
  compact?: boolean
  isPending?: boolean
  partialInput?: string
}

const WRITER_PREVIEW_MAX_LINES = 120
const WRITER_PREVIEW_MAX_CHARS = 30000

export const ToolCallBlock = memo(function ToolCallBlock({ toolName, input, result: rawResult, compact = false, isPending = false, partialInput }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const isCua = toolName.startsWith('mcp__cua__')
  // cua results can quote internal tool names (e.g. permission rejections); show display titles instead.
  const result = useMemo(() => (isCua ? humanizeCuaResult(rawResult, t) : rawResult), [isCua, rawResult, t])
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const cua = useMemo(() => getCuaToolDisplay(toolName, input, t), [input, toolName, t])
  const IconComponent = getToolIcon(toolName, cua?.icon)
  const title = cua ? cua.title : toolName
  const filePath = !cua && typeof obj.file_path === 'string' ? obj.file_path : ''
  const summary = filePath ? filePath.split('/').pop() : cua ? cua.summary : getToolSummary(toolName, obj, t)
  const outputSummary = getToolResultSummary(
    toolName,
    result?.content,
    result?.isError ?? false,
    t,
  )
  const pendingSummary = isPending && !result
    ? getPendingSummary(toolName, t)
    : ''

  const resultImages = useMemo(() => extractToolResultImages(result?.content), [result?.content])
  const showCuaSettingsLink = useMemo(() => isCuaPermissionError(toolName, rawResult), [rawResult, toolName])
  const streamingPreview = useMemo(
    () => (isPending && partialInput ? renderStreamingInput(toolName, partialInput, t) : null),
    [isPending, partialInput, toolName, t],
  )
  const diff = useMemo(() => renderDiff(toolName, obj), [obj, toolName])
  const inputView = useMemo(() => (diff || streamingPreview ? null : getInputView(toolName, obj, cua !== null)), [cua, diff, obj, streamingPreview, toolName])
  // Read results are whole files; the transcript shows the call, not the contents.
  const outputText = toolName === 'Read' || diff ? null : stripAnsi(extractTextContent(result?.content) ?? '').trimEnd() || null
  const expandable = Boolean(diff || streamingPreview || inputView || outputText || resultImages.length > 0)

  const line = (
    <TraceLine status={pendingSummary ? 'running' : result?.isError ? 'error' : undefined} className="min-h-7 w-full">
      <TraceIcon><IconComponent size={14} /></TraceIcon>
      <TraceTitle className="shrink-0">{title}</TraceTitle>
      {summary ? (
        <HintTooltip content={summary}><span className="min-w-0 flex-1 truncate font-mono text-2xs text-subtle-foreground">
          {summary}
        </span></HintTooltip>
      ) : null}
      {pendingSummary ? (
        <TraceDescription>{pendingSummary}</TraceDescription>
      ) : result && outputSummary ? (
        <HintTooltip content={outputSummary}><span
          className={`min-w-0 max-w-[45%] truncate text-3xs ${
            result.isError
              ? 'text-destructive'
              : 'text-subtle-foreground'
          }`}
        >
          {outputSummary}
        </span></HintTooltip>
      ) : null}
      {result?.isError && (
        <AlertCircle size={14} className="shrink-0 text-destructive" />
      )}
    </TraceLine>
  )

  const cuaSettingsLink = showCuaSettingsLink && (
    <div className="pb-1 pl-5.5 text-xs">
      <Button variant="link" size="inline"
        type="button"
        onClick={() => useUIStore.getState().openSettings('computerUse')}
        className="select-none"
      >
        {t('cuaTool.openSettings')}
      </Button>
    </div>
  )

  return (
    <Trace className={compact ? 'mb-0' : 'mb-2'}>
      {expandable ? (
        <TraceCollapsible open={expanded} onOpenChange={setExpanded}>
          <TraceCollapsibleTrigger className="w-full select-none">{line}</TraceCollapsibleTrigger>
          {cuaSettingsLink}
          <CollapsibleContent>
            <div className="mb-1 mt-1 space-y-2 pl-5.5">
              <ToolResultImages images={resultImages} />
              {diff}
              {streamingPreview}
              {(inputView || outputText) && (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {inputView && <ToolInputSection view={inputView} obj={obj} t={t} />}
                  {outputText && (
                    <div className={`${inputView ? 'border-t border-border/60' : ''} ${result?.isError ? 'bg-destructive-surface/40' : ''}`}>
                      <ToolSection copyText={outputText} t={t}>
                        <CodeBlockContent wrap className="max-h-[360px]">
                          <span className={result?.isError ? 'text-destructive' : 'text-muted-foreground'}>{outputText}</span>
                        </CodeBlockContent>
                      </ToolSection>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </TraceCollapsible>
      ) : (
        <>
          {line}
          {cuaSettingsLink}
        </>
      )}
    </Trace>
  )
})

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

type InputView = {
  /** Shown as `$ text` for shell commands, plain otherwise. */
  kind: 'command' | 'text' | 'json'
  text: string
  note?: string
  /** True when obj has fields the view leaves out, so the raw input is worth offering. */
  hasMore: boolean
}

// The most useful input field per tool; anything else stays behind "Show full input".
const PRIMARY_INPUT_FIELD: Record<string, string> = {
  Read: 'file_path',
  Glob: 'pattern',
  Grep: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Skill: 'skill',
}

function getInputView(toolName: string, obj: Record<string, unknown>, isCua: boolean): InputView | null {
  const keys = Object.keys(obj)
  if (keys.length === 0) return null

  if (toolName === 'Bash' && typeof obj.command === 'string') {
    const note = typeof obj.description === 'string' ? obj.description : undefined
    return { kind: 'command', text: obj.command, note, hasMore: keys.some((key) => key !== 'command' && key !== 'description') }
  }

  const field = isCua ? undefined : PRIMARY_INPUT_FIELD[toolName]
  const value = field ? obj[field] : undefined
  if (field && typeof value === 'string') {
    return { kind: 'text', text: value, hasMore: keys.some((key) => key !== field) }
  }

  return { kind: 'json', text: JSON.stringify(obj, null, 2), hasMore: false }
}

function ToolInputSection({ view, obj, t }: { view: InputView; obj: Record<string, unknown>; t: Translate }) {
  const [showRaw, setShowRaw] = useState(false)
  const rawText = JSON.stringify(obj, null, 2)

  return (
    <ToolSection copyText={showRaw ? rawText : view.text} t={t}>
      <CodeBlockContent wrap className="max-h-[240px]">
        <CodeBlockLine>
        {view.note && (
          <span className="block text-subtle-foreground">{`# ${view.note}`}</span>
        )}
        {view.kind === 'command' && (
          <span className="select-none text-primary">$ </span>
        )}
        {view.text}
        </CodeBlockLine>
      </CodeBlockContent>
      {view.hasMore && (
        <>
          <div className="px-3 pb-2">
            <Button variant="link-muted" size="inline"
              type="button"
              onClick={() => setShowRaw((value) => !value)}
              className="select-none"
            >
              {showRaw ? t('tool.hideFullInput') : t('tool.showFullInput')}
            </Button>
          </div>
          {showRaw && (
            <div className="border-t border-dashed border-border/60">
              <CodeBlockContent wrap className="max-h-[240px]">
                <span className="text-muted-foreground">{rawText}</span>
              </CodeBlockContent>
            </div>
          )}
        </>
      )}
    </ToolSection>
  )
}

function ToolSection({ copyText, t, children }: { copyText: string; t: Translate; children: React.ReactNode }) {
  return (
    <CodeBlock size="sm">
      {children}
      <CodeBlockActions><CopyButton
        text={copyText}
        label={t('tool.copy')}
        copiedLabel={t('tool.copied')}
      /></CodeBlockActions>
    </CodeBlock>
  )
}

function renderDiff(toolName: string, obj: Record<string, unknown>) {
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if (toolName === 'Edit' && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if (toolName === 'Write' && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  return null
}

function renderStreamingInput(toolName: string, partialInput: string, t: Translate) {
  if (toolName === 'Write') {
    const writerContent = extractPartialJsonStringField(partialInput, 'content')
    if (writerContent) {
      return renderWriterPreview(writerContent, t)
    }
  }
  return renderPartialInput(partialInput, t)
}

function extractPartialJsonStringField(source: string, field: string): string | null {
  const key = `"${field}"`
  const keyIndex = source.indexOf(key)
  if (keyIndex < 0) return null
  const colonIndex = source.indexOf(':', keyIndex + key.length)
  if (colonIndex < 0) return null

  let index = colonIndex + 1
  while (index < source.length && /\s/.test(source[index] ?? '')) index += 1
  if (source[index] !== '"') return null
  index += 1

  let value = ''
  while (index < source.length) {
    const char = source[index]
    if (char === '"') return value
    if (char !== '\\') {
      value += char
      index += 1
      continue
    }

    const escaped = source[index + 1]
    if (escaped === undefined) break
    switch (escaped) {
      case 'n':
        value += '\n'
        index += 2
        break
      case 'r':
        value += '\r'
        index += 2
        break
      case 't':
        value += '\t'
        index += 2
        break
      case 'b':
        value += '\b'
        index += 2
        break
      case 'f':
        value += '\f'
        index += 2
        break
      case '"':
      case '\\':
      case '/':
        value += escaped
        index += 2
        break
      case 'u': {
        const hex = source.slice(index + 2, index + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(Number.parseInt(hex, 16))
          index += 6
        } else {
          index = source.length
        }
        break
      }
      default:
        value += escaped
        index += 2
        break
    }
  }
  return value
}

function renderWriterPreview(
  content: string,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const lines = content.split('\n')
  const totalLines = lines.length
  const visibleLines = lines.length > WRITER_PREVIEW_MAX_LINES
    ? lines.slice(-WRITER_PREVIEW_MAX_LINES)
    : lines
  let visibleContent = visibleLines.join('\n')
  const charTruncated = visibleContent.length > WRITER_PREVIEW_MAX_CHARS
  if (charTruncated) {
    visibleContent = visibleContent.slice(-WRITER_PREVIEW_MAX_CHARS)
  }
  const lineWindowed = totalLines > visibleLines.length
  const isWindowed = lineWindowed || charTruncated

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border select-none px-3 py-2 text-3xs uppercase tracking-widest text-subtle-foreground">
        <span>{t?.('tool.writerPreview') ?? 'Writer'}</span>
        {isWindowed ? (
          <span className="normal-case tracking-normal">
            {t?.('tool.writerPreviewLatest', { visible: visibleLines.length, total: totalLines }) ?? `Showing latest ${visibleLines.length} of ${totalLines} lines`}
          </span>
        ) : null}
      </div>
      <div className="bg-code text-code-foreground">
        <CodeBlockContent wrap className="max-h-[420px]">
          {visibleContent}
        </CodeBlockContent>
      </div>
    </div>
  )
}

function renderPartialInput(
  partialInput: string,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border select-none px-3 py-2 text-3xs uppercase tracking-widest text-subtle-foreground">
        {t?.('tool.partialInput') ?? 'Partial input'}
      </div>
      <CodeViewer code={partialInput} language="json" maxLines={8} />
    </div>
  )
}

function getPendingSummary(
  toolName: string,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (toolName === 'Write') return t?.('tool.generatingContent') ?? 'Generating content'
  if (toolName === 'Edit' || toolName === 'MultiEdit') return t?.('tool.preparingEdit') ?? 'Preparing edit'
  return t?.('tool.preparingTool') ?? 'Preparing tool'
}

function getToolResultSummary(
  toolName: string,
  content: unknown,
  isError: boolean,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const text = extractTextContent(content)
  if (!text) return ''

  if (isError) {
    const firstLine = text
      .split('\n')
      .map((line) => stripAnsi(line).replace(/\s+/g, ' ').trim())
      .find(Boolean)

    if (!firstLine) {
      return t?.('tool.error') ?? 'Error'
    }

    return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 72)}…`
  }

  if (toolName === 'Bash') return ''
  if (toolName === 'ShowUI') {
    const page = parseUiPageResult(content)
    return page ? (t?.('uiPage.revision', { title: page.title, revision: page.revision }) ?? `${page.title} · rev ${page.revision}`) : ''
  }

  const lineCount = text.split('\n').length
  if (lineCount > 1) {
    return t?.('tool.linesOutput', { count: lineCount }) ?? `${lineCount} lines output`
  }

  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= 36) return compact
  return `${compact.slice(0, 36)}…`
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '')
}

function getToolSummary(toolName: string, obj: Record<string, unknown>, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  switch (toolName) {
    case 'Bash':
      return typeof obj.command === 'string' ? obj.command : ''
    case 'Read':
      return t?.('tool.readFileContents') ?? 'Read file contents'
    case 'Write':
      return typeof obj.content === 'string'
        ? (t?.('tool.linesCreated', { count: obj.content.split('\n').length }) ?? `${obj.content.split('\n').length} lines created`)
        : (t?.('tool.createFile') ?? 'Create file')
    case 'Edit':
      return typeof obj.old_string === 'string' && typeof obj.new_string === 'string'
        ? changedLineSummary(obj.old_string, obj.new_string, t)
        : (t?.('tool.updateFileContents') ?? 'Update file contents')
    case 'Glob':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Grep':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Agent':
      return typeof obj.description === 'string' ? obj.description : ''
    case 'ShowUI':
      return getShowUiSummary(obj, t)
    default:
      return ''
  }
}

function getShowUiSummary(obj: Record<string, unknown>, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  if (obj.catalog === true) return t?.('tool.showUi.catalog') ?? 'List components'
  if (Array.isArray(obj.describe)) {
    const kinds = obj.describe.filter((kind): kind is string => typeof kind === 'string').join(', ')
    return t?.('tool.showUi.describe', { kinds }) ?? `Read the format of ${kinds}`
  }
  if ('blocks' in obj) return t?.('tool.showUi.create') ?? 'Create a page'
  if ('operations' in obj) return t?.('tool.showUi.update') ?? 'Update a page'
  return t?.('tool.showUi.read') ?? 'Read a page'
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk: any) => (typeof chunk === 'string' ? chunk : chunk?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return null
}

function changedLineSummary(oldString: string, newString: string, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  let changed = 0
  const max = Math.max(oldLines.length, newLines.length)

  for (let index = 0; index < max; index += 1) {
    if ((oldLines[index] ?? '') !== (newLines[index] ?? '')) {
      changed += 1
    }
  }

  return t?.('tool.linesChanged', { count: changed }) ?? `${changed} lines changed`
}
