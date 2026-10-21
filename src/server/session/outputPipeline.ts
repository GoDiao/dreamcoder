import type { ServerMessage } from '../ws/protocol.js'
import type { SessionStateEvent } from './state/types.js'
import { createStreamState, translateCliOutput, type SessionStreamState } from './translate.js'

export type OutputGate = (cliMsg: any) => boolean

export type OutputSource = {
  onOutput(sessionId: string, callback: (msg: any) => void): void
  removeOutputCallback(sessionId: string, callback: (msg: any) => void): void
}

export type OutputPipelineHooks = {
  broadcast(sessionId: string, message: ServerMessage): void
  apply(sessionId: string, event: SessionStateEvent): void
  onRawMessage?(sessionId: string, cliMsg: any): void
  onTurnResult?(sessionId: string): void
}

export const closedGate: OutputGate = () => false

export class OutputPipeline {
  generation = 0
  stream: SessionStreamState = createStreamState()
  gate: OutputGate | undefined = closedGate
  private callback: ((cliMsg: any) => void) | null = null

  constructor(
    readonly sessionId: string,
    private readonly source: OutputSource,
    private readonly hooks: OutputPipelineHooks,
  ) {}

  attach(generation: number): void {
    if (this.callback && this.generation === generation) return
    this.detach()
    this.generation = generation
    this.stream = createStreamState()
    this.gate = closedGate
    const callback = (cliMsg: any) => this.handle(generation, cliMsg)
    this.callback = callback
    this.source.onOutput(this.sessionId, callback)
  }

  detach(): void {
    if (!this.callback) return
    this.source.removeOutputCallback(this.sessionId, this.callback)
    this.callback = null
  }

  isAttached(generation: number): boolean {
    return this.callback !== null && this.generation === generation
  }

  resetStream(): void {
    this.stream = createStreamState()
  }

  handle(generation: number, cliMsg: any): void {
    if (generation !== this.generation || !cliMsg || typeof cliMsg !== 'object') return
    this.hooks.onRawMessage?.(this.sessionId, cliMsg)
    const forward = !this.gate || this.gate(cliMsg)
    const { messages, events } = translateCliOutput(cliMsg, this.stream)
    if (forward) {
      for (const message of messages) this.hooks.broadcast(this.sessionId, message)
    }
    for (const event of events) this.hooks.apply(this.sessionId, event)
    if (forward && cliMsg.type === 'result') this.hooks.onTurnResult?.(this.sessionId)
  }
}
