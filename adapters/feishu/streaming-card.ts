import type * as Lark from '@larksuiteoapi/node-sdk'
import { FlushController, THROTTLE } from './flush-controller.js'
import {
  createCardEntity,
  sendCardAsMessage,
  streamCardContent,
  setCardStreamingMode,
  updateCardKitCard,
  STREAMING_ELEMENT_ID,
  withImCardRequestTimeout,
} from './cardkit.js'
import { isCardRateLimitError, isCardTableLimitError } from './card-errors.js'
import { optimizeMarkdownForFeishu, sanitizeTextForCard } from './markdown-style.js'

export function buildInitialStreamingCard(): Record<string, unknown> {
  return {
    schema: '2.0',
    config: {
      streaming_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: '☁️ *正在思考中...*',
          text_align: 'left',
          element_id: STREAMING_ELEMENT_ID,
        },
      ],
    },
  }
}

export function buildRenderedCard(renderedMarkdown: string): Record<string, unknown> {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: renderedMarkdown || ' ',
          text_align: 'left',
        },
      ],
    },
  }
}

export function buildErrorCard(message: string): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '❌ 出错了' },
      template: 'red',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: message || '未知错误',
        },
      ],
    },
  }
}

function truncateReasoningPreview(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return '...' + text.slice(text.length - maxLen + 3)
}

export type StreamingCardPhase =
  | 'idle'
  | 'creating'
  | 'streaming'
  | 'finalizing'
  | 'completed'
  | 'aborted'

export type StreamingCardDeps = {
  larkClient: Lark.Client
  chatId: string
  replyToMessageId?: string
}

type ToolStep = {
  id: string
  name: string
  status: 'running' | 'done'
}

const REASONING_PREVIEW_CHARS = 600

const STREAM_FAIL_DISABLE_THRESHOLD = 3

export class StreamingCard {
  private phase: StreamingCardPhase = 'idle'

  private cardId: string | null = null
  private messageId: string | null = null
  private sequence = 0
  private cardKitStreamActive = false
  private consecutiveStreamFailures = 0

  private accumulatedText = ''
  private lastFlushedText = ''
  private accumulatedReasoningText = ''
  private toolSteps: ToolStep[] = []

  private flushController: FlushController

  constructor(private readonly deps: StreamingCardDeps) {
    this.flushController = new FlushController(() => this.performFlush())
  }

  async ensureCreated(): Promise<void> {
    if (this.phase !== 'idle') return
    this.phase = 'creating'

    try {
      const cardId = await createCardEntity(
        this.deps.larkClient,
        buildInitialStreamingCard(),
      )
      const messageId = await sendCardAsMessage(
        this.deps.larkClient,
        this.deps.chatId,
        cardId,
        this.deps.replyToMessageId,
      )
      this.cardId = cardId
      this.messageId = messageId
      this.cardKitStreamActive = true
      this.sequence = 1
      this.phase = 'streaming'
      this.flushController.setCardMessageReady(true)
    } catch (cardKitErr) {
      console.warn(
        '[Feishu StreamingCard] CardKit create/send failed, falling back to im.message.patch:',
        cardKitErr instanceof Error ? cardKitErr.message : cardKitErr,
      )
      try {
        const fallbackResp = await withImCardRequestTimeout('im.message.create', () =>
          this.deps.larkClient.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: this.deps.chatId,
              msg_type: 'interactive',
              content: JSON.stringify(buildRenderedCard(' ')),
            },
          }),
        )
        const mid = fallbackResp.data?.message_id
        if (!mid) {
          throw new Error('fallback im.message.create returned no message_id')
        }
        this.cardId = null
        this.messageId = mid
        this.cardKitStreamActive = false
        this.phase = 'streaming'
        this.flushController.setCardMessageReady(true)
      } catch (fallbackErr) {
        console.error(
          '[Feishu StreamingCard] Fallback card creation also failed:',
          fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
        )
        this.phase = 'aborted'
        throw fallbackErr
      }
    }

    if (this.hasAnyContent()) {
      void this.flushController.throttledUpdate(this.currentThrottle())
    }
  }

  appendText(delta: string): void {
    if (!delta) return
    if (this.phase === 'completed' || this.phase === 'aborted') return
    this.accumulatedText += delta
    void this.flushController.throttledUpdate(this.currentThrottle())
  }

  appendReasoning(delta: string): void {
    if (!delta) return
    if (this.phase === 'completed' || this.phase === 'aborted') return
    this.accumulatedReasoningText += delta
    void this.flushController.throttledUpdate(this.currentThrottle())
  }

  startTool(toolUseId: string | undefined, toolName: string | undefined): void {
    if (this.phase === 'completed' || this.phase === 'aborted') return
    if (!toolName) return
    const id = toolUseId || `${toolName}#${this.toolSteps.length}`
    if (this.toolSteps.some((s) => s.id === id)) return
    this.toolSteps.push({ id, name: toolName, status: 'running' })
    void this.flushController.throttledUpdate(this.currentThrottle())
  }

  completeTool(toolUseId: string | undefined, toolName: string | undefined): void {
    if (this.phase === 'completed' || this.phase === 'aborted') return
    let step: ToolStep | undefined
    if (toolUseId) {
      step = this.toolSteps.find((s) => s.id === toolUseId)
    }
    if (!step && toolName) {
      for (let i = this.toolSteps.length - 1; i >= 0; i--) {
        const s = this.toolSteps[i]!
        if (s.name === toolName && s.status === 'running') {
          step = s
          break
        }
      }
    }
    if (!step) return
    if (step.status === 'done') return
    step.status = 'done'
    void this.flushController.throttledUpdate(this.currentThrottle())
  }

  private hasAnyContent(): boolean {
    return (
      this.accumulatedText.length > 0 ||
      this.accumulatedReasoningText.length > 0 ||
      this.toolSteps.length > 0
    )
  }

  async finalize(): Promise<void> {
    if (this.phase === 'completed' || this.phase === 'aborted') return
    if (this.phase === 'idle') {
      this.phase = 'completed'
      this.flushController.complete()
      return
    }
    this.phase = 'finalizing'
    this.flushController.cancelPendingFlush()
    await this.flushController.waitForFlush()

    const finalText = this.terminalText()
    try {
      if (this.cardId) {
        this.sequence += 1
        await setCardStreamingMode(
          this.deps.larkClient,
          this.cardId,
          false,
          this.sequence,
        )
        this.sequence += 1
        await updateCardKitCard(
          this.deps.larkClient,
          this.cardId,
          buildRenderedCard(finalText),
          this.sequence,
        )
      } else if (this.messageId) {
        await withImCardRequestTimeout('im.message.patch', () =>
          this.deps.larkClient.im.message.patch({
            path: { message_id: this.messageId! },
            data: { content: JSON.stringify(buildRenderedCard(finalText)) },
          }),
        )
      }
    } catch (err) {
      console.error(
        '[Feishu StreamingCard] finalize failed:',
        err instanceof Error ? err.message : err,
      )
      if (this.messageId) {
        try {
          await withImCardRequestTimeout('im.message.patch', () =>
            this.deps.larkClient.im.message.patch({
              path: { message_id: this.messageId! },
              data: { content: JSON.stringify(buildRenderedCard(finalText)) },
            }),
          )
        } catch (fallbackErr) {
          console.error(
            '[Feishu StreamingCard] finalize fallback patch failed:',
            fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
          )
        }
      }
    } finally {
      this.phase = 'completed'
      this.lastFlushedText = finalText
      this.flushController.complete()
    }
  }

  async abort(err: Error): Promise<void> {
    if (this.phase === 'completed' || this.phase === 'aborted') return
    const wasIdle = this.phase === 'idle'
    this.phase = 'aborted'
    this.flushController.cancelPendingFlush()
    await this.flushController.waitForFlush().catch(() => {})

    if (wasIdle || !this.messageId) {
      this.flushController.complete()
      return
    }

    const errCard = buildErrorCard(
      `${err.message}${this.accumulatedText ? '\n\n——\n\n' + this.accumulatedText : ''}`,
    )
    try {
      if (this.cardId) {
        this.sequence += 1
        await setCardStreamingMode(
          this.deps.larkClient,
          this.cardId,
          false,
          this.sequence,
        ).catch(() => {})
        this.sequence += 1
        await updateCardKitCard(
          this.deps.larkClient,
          this.cardId,
          errCard,
          this.sequence,
        )
      } else {
        await withImCardRequestTimeout('im.message.patch', () =>
          this.deps.larkClient.im.message.patch({
            path: { message_id: this.messageId! },
            data: { content: JSON.stringify(errCard) },
          }),
        )
      }
    } catch (renderErr) {
      console.error(
        '[Feishu StreamingCard] abort render failed:',
        renderErr instanceof Error ? renderErr.message : renderErr,
      )
    } finally {
      this.flushController.complete()
    }
  }

  private currentThrottle(): number {
    return this.cardKitStreamActive ? THROTTLE.CARDKIT_MS : THROTTLE.PATCH_MS
  }

  private renderedText(): string {
    const sections: string[] = []

    if (this.toolSteps.length > 0) {
      const inline = this.toolSteps
        .map((s) => `${s.status === 'done' ? '✅' : '⚙️'} ${s.name}`)
        .join(' · ')
      sections.push(`🛠️ ${inline}`)
    }

    if (this.accumulatedReasoningText) {
      const preview = truncateReasoningPreview(
        this.accumulatedReasoningText,
        REASONING_PREVIEW_CHARS,
      )
      sections.push(`💭 **思考中**\n\n${preview}`)
    }

    if (this.accumulatedText) {
      sections.push(this.accumulatedText)
    }

    if (sections.length === 0) return '☁️ *正在思考中...*'

    const composed = sections.join('\n\n---\n\n')

    const limited = sanitizeTextForCard(composed)
    return optimizeMarkdownForFeishu(limited, 2)
  }

  private terminalText(): string {
    if (this.accumulatedText) {
      const limited = sanitizeTextForCard(this.accumulatedText)
      return optimizeMarkdownForFeishu(limited, 2)
    }
    return this.renderedText()
  }

  private async performFlush(): Promise<void> {
    if (this.phase !== 'streaming') return
    if (!this.messageId) return

    if (this.cardId && !this.cardKitStreamActive) return

    const finalText = this.renderedText()
    if (finalText === this.lastFlushedText) return

    if (this.cardKitStreamActive && this.cardId) {
      this.sequence += 1
      try {
        await streamCardContent(
          this.deps.larkClient,
          this.cardId,
          STREAMING_ELEMENT_ID,
          finalText,
          this.sequence,
        )
        this.lastFlushedText = finalText
        this.consecutiveStreamFailures = 0
      } catch (err) {
        if (isCardRateLimitError(err)) {
          return
        }
        if (isCardTableLimitError(err)) {
          console.warn(
            '[Feishu StreamingCard] 230099 table limit, disabling CardKit streaming',
          )
          this.cardKitStreamActive = false
          return
        }
        this.consecutiveStreamFailures += 1
        const errMsg = err instanceof Error ? err.message : String(err)
        if (this.consecutiveStreamFailures === 1) {
          console.warn(
            '[Feishu StreamingCard] stream flush failed (will retry):',
            errMsg,
          )
        }
        if (this.consecutiveStreamFailures >= STREAM_FAIL_DISABLE_THRESHOLD) {
          console.error(
            `[Feishu StreamingCard] stream flush failed ${this.consecutiveStreamFailures}× consecutively, disabling CardKit streaming until finalize:`,
            errMsg,
          )
          this.cardKitStreamActive = false
        }
        return
      }
    } else {
      try {
        await withImCardRequestTimeout('im.message.patch', () =>
          this.deps.larkClient.im.message.patch({
            path: { message_id: this.messageId! },
            data: { content: JSON.stringify(buildRenderedCard(finalText)) },
          }),
        )
        this.lastFlushedText = finalText
      } catch (err) {
        if (isCardRateLimitError(err)) return
        console.error(
          '[Feishu StreamingCard] patch flush failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  _getPhase(): StreamingCardPhase {
    return this.phase
  }

  _getCardId(): string | null {
    return this.cardId
  }

  _getMessageId(): string | null {
    return this.messageId
  }

  _getSequence(): number {
    return this.sequence
  }

  _isCardKitStreamActive(): boolean {
    return this.cardKitStreamActive
  }

  _getAccumulatedText(): string {
    return this.accumulatedText
  }

  _getAccumulatedReasoning(): string {
    return this.accumulatedReasoningText
  }

  _getToolSteps(): ReadonlyArray<ToolStep> {
    return this.toolSteps
  }

  _getFlushController(): FlushController {
    return this.flushController
  }
}
