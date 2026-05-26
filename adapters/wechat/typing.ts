export type WechatTypingStatus = 'typing' | 'cancel'

type SendTyping = (chatId: string, status: WechatTypingStatus) => Promise<void>

/**
 * WeChat typing indicators expire quickly. Keep sending typing while the
 * desktop session is active, then cancel when the turn completes.
 */
export class WechatTypingController {
  private readonly active = new Map<string, ReturnType<typeof setInterval>>()

  constructor(
    private readonly sendTyping: SendTyping,
    private readonly keepaliveIntervalMs = 5000,
  ) {}

  start(chatId: string): void {
    void this.sendTyping(chatId, 'typing')
    if (this.active.has(chatId)) return

    const timer = setInterval(() => {
      void this.sendTyping(chatId, 'typing')
    }, this.keepaliveIntervalMs)
    this.active.set(chatId, timer)
  }

  stop(chatId: string): void {
    const timer = this.active.get(chatId)
    if (timer) {
      clearInterval(timer)
      this.active.delete(chatId)
    }
    void this.sendTyping(chatId, 'cancel')
  }

  destroy(): void {
    for (const timer of this.active.values()) {
      clearInterval(timer)
    }
    this.active.clear()
  }
}
