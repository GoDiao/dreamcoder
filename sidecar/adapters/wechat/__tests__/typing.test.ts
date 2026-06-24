import { describe, expect, it } from 'bun:test'
import { WechatTypingController } from '../typing.js'

describe('WechatTypingController', () => {
  it('sends typing immediately and keeps it alive until stopped', async () => {
    const calls: Array<[string, string]> = []
    const controller = new WechatTypingController(async (chatId, status) => {
      calls.push([chatId, status])
    }, 10)

    controller.start('chat-1')
    await Bun.sleep(25)
    controller.stop('chat-1')
    controller.destroy()

    expect(calls[0]).toEqual(['chat-1', 'typing'])
    expect(calls.filter(([, status]) => status === 'typing').length).toBeGreaterThanOrEqual(2)
    expect(calls.at(-1)).toEqual(['chat-1', 'cancel'])
  })

  it('does not create duplicate keepalive timers for the same chat', async () => {
    const calls: Array<[string, string]> = []
    const controller = new WechatTypingController(async (chatId, status) => {
      calls.push([chatId, status])
    }, 10)

    controller.start('chat-1')
    controller.start('chat-1')
    await Bun.sleep(25)
    controller.stop('chat-1')
    controller.destroy()

    const typingCalls = calls.filter(([, status]) => status === 'typing')
    expect(typingCalls.length).toBeGreaterThanOrEqual(3)
    expect(typingCalls.length).toBeLessThanOrEqual(5)
    expect(calls.at(-1)).toEqual(['chat-1', 'cancel'])
  })
})
