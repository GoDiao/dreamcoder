import { describe, it, expect, beforeEach } from 'bun:test'
import {
  StreamingCard,
  buildInitialStreamingCard,
  buildRenderedCard,
  buildErrorCard,
} from '../streaming-card.js'
import { STREAMING_ELEMENT_ID } from '../cardkit.js'

type ApiCall = { api: string; args: any }

type MockBehavior = {
  'card.create'?: any | ((args: any) => any)
  'card.settings'?: any | ((args: any) => any)
  'card.update'?: any | ((args: any) => any)
  'cardElement.content'?: any | ((args: any, callIdx: number) => any)
  'im.message.create'?: any | ((args: any) => any)
  'im.message.reply'?: any | ((args: any) => any)
  'im.message.patch'?: any | ((args: any, callIdx: number) => any)
}

function makeMockClient(behavior: MockBehavior = {}) {
  const calls: ApiCall[] = []
  let contentCallIdx = 0
  let patchCallIdx = 0

  function handle(api: string, resp: any, args: any, idx?: number): any {
    calls.push({ api, args })
    if (typeof resp === 'function') return resp(args, idx ?? 0)
    return resp
  }

  const client: any = {
    cardkit: {
      v1: {
        card: {
          create: async (args: any) =>
            handle('cardkit.v1.card.create', behavior['card.create'] ?? {
              code: 0, data: { card_id: 'ck_default' },
            }, args),
          settings: async (args: any) =>
            handle('cardkit.v1.card.settings', behavior['card.settings'] ?? { code: 0 }, args),
          update: async (args: any) =>
            handle('cardkit.v1.card.update', behavior['card.update'] ?? { code: 0 }, args),
        },
        cardElement: {
          content: async (args: any) => {
            const idx = contentCallIdx++
            return handle('cardkit.v1.cardElement.content',
              behavior['cardElement.content'] ?? { code: 0 }, args, idx)
          },
        },
      },
    },
    im: {
      message: {
        create: async (args: any) =>
          handle('im.message.create', behavior['im.message.create'] ?? {
            data: { message_id: 'om_default' },
          }, args),
        reply: async (args: any) =>
          handle('im.message.reply', behavior['im.message.reply'] ?? {
            data: { message_id: 'om_reply_default' },
          }, args),
        patch: async (args: any) => {
          const idx = patchCallIdx++
          return handle('im.message.patch', behavior['im.message.patch'] ?? { code: 0 }, args, idx)
        },
      },
    },
  }
  return { client, calls }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('buildInitialStreamingCard', () => {
  it('Schema 2.0 + streaming_mode + element_id', () => {
    const card = buildInitialStreamingCard() as any
    expect(card.schema).toBe('2.0')
    expect(card.config.streaming_mode).toBe(true)
    const elements = card.body.elements as any[]
    expect(elements.length).toBe(1)
    const streaming = elements[0]
    expect(streaming.tag).toBe('markdown')
    expect(streaming.content).toContain('正在思考中')
    expect(streaming.element_id).toBe(STREAMING_ELEMENT_ID)
  })
})

describe('buildRenderedCard', () => {
  it('Schema 2.0, 无 streaming_mode, 单 markdown 元素', () => {
    const card = buildRenderedCard('hello world') as any
    expect(card.schema).toBe('2.0')
    expect(card.config.streaming_mode).toBeUndefined()
    expect(card.body.elements.length).toBe(1)
    const el = card.body.elements[0]
    expect(el.tag).toBe('markdown')
    expect(el.content).toBe('hello world')
    expect(el.element_id).toBeUndefined()
  })

  it('空字符串保底为单空格', () => {
    const card = buildRenderedCard('') as any
    expect(card.body.elements[0].content).toBe(' ')
  })
})

describe('buildErrorCard', () => {
  it('红色 header + markdown body', () => {
    const card = buildErrorCard('oops') as any
    expect((card.header as any).template).toBe('red')
    expect((card.header as any).title.content).toContain('出错')
    expect(card.body.elements[0].content).toBe('oops')
  })
})

describe('StreamingCard: ensureCreated (CardKit 主路径)', () => {
  it('依次调用 card.create + im.message.create，sequence=1', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_main_1' } },
      'im.message.create': { data: { message_id: 'om_main_1' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'oc_chat_1' })
    await sc.ensureCreated()

    expect(sc._getPhase()).toBe('streaming')
    expect(sc._getCardId()).toBe('ck_main_1')
    expect(sc._getMessageId()).toBe('om_main_1')
    expect(sc._getSequence()).toBe(1)
    expect(sc._isCardKitStreamActive()).toBe(true)

    expect(calls[0]!.api).toBe('cardkit.v1.card.create')
    expect(calls[1]!.api).toBe('im.message.create')

    const cardJson = JSON.parse(calls[0]!.args.data.data)
    expect(cardJson.schema).toBe('2.0')
    expect(cardJson.config.streaming_mode).toBe(true)
    expect(cardJson.body.elements[0].element_id).toBe(STREAMING_ELEMENT_ID)

    const content = JSON.parse(calls[1]!.args.data.content)
    expect(content).toEqual({ type: 'card', data: { card_id: 'ck_main_1' } })
  })

  it('幂等: 重复调用 ensureCreated 不重复创建', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_1' } },
      'im.message.create': { data: { message_id: 'om_1' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    await sc.ensureCreated()
    await sc.ensureCreated()
    const createCalls = calls.filter((c) => c.api === 'cardkit.v1.card.create')
    const sendCalls = calls.filter((c) => c.api === 'im.message.create')
    expect(createCalls.length).toBe(1)
    expect(sendCalls.length).toBe(1)
  })

  it('replyToMessageId 走 im.message.reply 而非 create', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.reply': { data: { message_id: 'om_reply' } },
    })
    const sc = new StreamingCard({
      larkClient: client,
      chatId: 'c',
      replyToMessageId: 'om_parent',
    })
    await sc.ensureCreated()
    expect(calls.some((c) => c.api === 'im.message.reply')).toBe(true)
    expect(calls.some((c) => c.api === 'im.message.create')).toBe(false)
    expect(sc._getMessageId()).toBe('om_reply')
  })
})

describe('StreamingCard: ensureCreated (fallback 降级路径)', () => {
  it('CardKit create 失败 → 直发 Schema 2.0 卡 + patch 模式', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 99991672, msg: 'permission denied' },
      'im.message.create': { data: { message_id: 'om_fb' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    expect(sc._getPhase()).toBe('streaming')
    expect(sc._getCardId()).toBeNull()
    expect(sc._getMessageId()).toBe('om_fb')
    expect(sc._isCardKitStreamActive()).toBe(false)

    const createCall = calls.find((c) => c.api === 'im.message.create')
    expect(createCall).toBeDefined()
    expect(createCall!.args.data.msg_type).toBe('interactive')
    const cardContent = JSON.parse(createCall!.args.data.content)
    expect(cardContent.schema).toBe('2.0')
  })

  it('CardKit send 失败（create 成功但 im.message.create 失败）也能降级', async () => {
    let sendCallCount = 0
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': () => {
        sendCallCount++
        if (sendCallCount === 1) throw new Error('send failed')
        return { data: { message_id: 'om_fb2' } }
      },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    expect(sc._getPhase()).toBe('streaming')
    expect(sc._getCardId()).toBeNull()
    expect(sc._getMessageId()).toBe('om_fb2')
  })

  it('降级发送也失败 → aborted + throw', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 99991672 },
      'im.message.create': () => {
        throw new Error('really broken')
      },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await expect(sc.ensureCreated()).rejects.toThrow()
    expect(sc._getPhase()).toBe('aborted')
  })
})

describe('StreamingCard: appendText + flush', () => {
  it('accumulated 文本写入 cardElement.content，sequence 单调递增', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_stream' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.appendText('Hello ')
    sc.appendText('world')

    await sleep(150)

    const contentCalls = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content')
    expect(contentCalls.length).toBeGreaterThan(0)
    const lastCall = contentCalls[contentCalls.length - 1]!
    expect(lastCall.args.data.content).toContain('Hello world')
    expect(lastCall.args.path.element_id).toBe(STREAMING_ELEMENT_ID)
    const seqs = contentCalls.map((c) => c.args.data.sequence)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!)
    }
  })

  it('内容未变化时不重复 flush（基于 lastFlushedText 对比）', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.appendText('same')
    await sleep(150)

    await sc._getFlushController().flush()

    const contentCalls = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content')
    expect(contentCalls.length).toBe(1)
  })

  it('completed 之后的 appendText 被忽略', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    await sc.finalize()
    sc.appendText('ignored')
    expect(sc._getAccumulatedText()).toBe('')
  })
})

describe('StreamingCard: finalize', () => {
  it('CardKit 路径: settings(false) + card.update，sequence 连续递增', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_final' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    sc.appendText('# Title\n\nBody')
    await sleep(150)
    const contentSeqs = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .map((c) => c.args.data.sequence)
    const lastContentSeq = contentSeqs[contentSeqs.length - 1] ?? 1

    await sc.finalize()

    expect(sc._getPhase()).toBe('completed')

    const settingsCalls = calls.filter((c) => c.api === 'cardkit.v1.card.settings')
    const updateCalls = calls.filter((c) => c.api === 'cardkit.v1.card.update')
    expect(settingsCalls.length).toBe(1)
    expect(updateCalls.length).toBe(1)

    const settingsSeq = settingsCalls[0]!.args.data.sequence
    const updateSeq = updateCalls[0]!.args.data.sequence
    expect(settingsSeq).toBeGreaterThan(lastContentSeq)
    expect(updateSeq).toBeGreaterThan(settingsSeq)

    const settings = JSON.parse(settingsCalls[0]!.args.data.settings)
    expect(settings.streaming_mode).toBe(false)

    const finalCardJson = JSON.parse(updateCalls[0]!.args.data.card.data)
    const finalContent = finalCardJson.body.elements[0].content
    expect(finalContent).toContain('#### Title')
    expect(finalContent).toContain('Body')
  })

  it('Fallback 路径: im.message.patch 发完整渲染卡', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 99991672 },
      'im.message.create': { data: { message_id: 'om_fb' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    sc.appendText('## Heading\n\nContent')
    await sleep(1600)
    await sc.finalize()

    const patchCalls = calls.filter((c) => c.api === 'im.message.patch')
    expect(patchCalls.length).toBeGreaterThan(0)
    const lastPatch = patchCalls[patchCalls.length - 1]!
    const finalCard = JSON.parse(lastPatch.args.data.content)
    const finalContent = finalCard.body.elements[0].content
    expect(finalContent).toContain('##### Heading')
  })

  it('完全 idle 时 finalize 直接标记 completed 不抛错', async () => {
    const { client } = makeMockClient()
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.finalize()
    expect(sc._getPhase()).toBe('completed')
  })

  it('finalize 只保留 answerText，丢弃 reasoning + toolSteps', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_term' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.appendReasoning('Let me think about this problem carefully...')
    sc.startTool('tu_1', 'Read')
    sc.completeTool('tu_1', 'Read')
    sc.appendText('## 答复\n\n这是最终答复正文。')
    await sleep(150)

    const lastMidFrame = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .pop()!.args.data.content as string
    expect(lastMidFrame).toContain('思考中')
    expect(lastMidFrame).toContain('Read')
    expect(lastMidFrame).toContain('最终答复正文')

    await sc.finalize()

    const updateCall = calls.filter((c) => c.api === 'cardkit.v1.card.update').pop()!
    const finalCardJson = JSON.parse(updateCall.args.data.card.data)
    const finalContent = finalCardJson.body.elements[0].content as string

    expect(finalContent).toContain('最终答复正文')
    expect(finalContent).toContain('##### 答复')
    expect(finalContent).not.toContain('思考中')
    expect(finalContent).not.toContain('think about this problem')
    expect(finalContent).not.toContain('Read')
    expect(finalContent).not.toContain('🛠️')
    expect(finalContent).not.toContain('💭')
  })

  it('finalize 边界: 没有 answerText 时退到组合渲染（保留推理）', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_no_answer' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.appendReasoning('I was thinking but never produced an answer.')
    await sleep(150)

    await sc.finalize()
    const updateCall = calls.filter((c) => c.api === 'cardkit.v1.card.update').pop()!
    const finalContent = JSON.parse(updateCall.args.data.card.data).body.elements[0].content as string
    expect(finalContent).toContain('thinking')
  })

  it('finalize 失败不抛出', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
      'card.settings': () => {
        throw new Error('settings exploded')
      },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    sc.appendText('text')
    await sleep(150)
    await sc.finalize()
    expect(sc._getPhase()).toBe('completed')
  })
})

describe('StreamingCard: 错误处理', () => {
  it('230020 rate limit → 跳帧，后续 flush 继续', async () => {
    let callIdx = 0
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
      'cardElement.content': () => {
        const i = callIdx++
        if (i === 0) {
          const err: any = new Error('rate limit')
          err.code = 230020
          throw err
        }
        return { code: 0 }
      },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    sc.appendText('first')
    await sleep(150)
    sc.appendText(' second')
    await sleep(150)

    expect(sc._isCardKitStreamActive()).toBe(true)
    const contentCalls = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content')
    expect(contentCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('230099 table limit → 禁用流式但 cardId 保留，finalize 仍走 CardKit', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_tbl' } },
      'im.message.create': { data: { message_id: 'om' } },
      'cardElement.content': () => {
        const err: any = new Error('content failed')
        err.code = 230099
        err.msg = 'Failed to create card content, ext=ErrCode: 11310; ErrMsg: card table number over limit; '
        throw err
      },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    sc.appendText('some content')
    await sleep(150)
    expect(sc._isCardKitStreamActive()).toBe(false)
    expect(sc._getCardId()).toBe('ck_tbl')

    await sc.finalize()
    expect(calls.some((c) => c.api === 'cardkit.v1.card.settings')).toBe(true)
    expect(calls.some((c) => c.api === 'cardkit.v1.card.update')).toBe(true)
    expect(calls.some((c) => c.api === 'im.message.patch')).toBe(false)
  })

  it('CardKit 中间帧请求挂住时不会阻塞 message_complete 收尾', async () => {
    const previousTimeout = process.env.DREAMCODER_IM_CARD_REQUEST_TIMEOUT_MS
    process.env.DREAMCODER_IM_CARD_REQUEST_TIMEOUT_MS = '20'
    try {
      const { client, calls } = makeMockClient({
        'card.create': { code: 0, data: { card_id: 'ck_hung' } },
        'im.message.create': { data: { message_id: 'om' } },
        'cardElement.content': () => new Promise(() => {}),
      })
      const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
      await sc.ensureCreated()

      sc.appendText('partial text')
      await sleep(60)

      const completed = await Promise.race([
        sc.finalize().then(() => true),
        sleep(250).then(() => false),
      ])

      expect(completed).toBe(true)
      expect(sc._getPhase()).toBe('completed')
      expect(calls.some((c) => c.api === 'cardkit.v1.card.settings')).toBe(true)
      expect(calls.some((c) => c.api === 'cardkit.v1.card.update')).toBe(true)
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DREAMCODER_IM_CARD_REQUEST_TIMEOUT_MS
      } else {
        process.env.DREAMCODER_IM_CARD_REQUEST_TIMEOUT_MS = previousTimeout
      }
    }
  })
})

describe('StreamingCard: abort', () => {
  it('CardKit 路径: 渲染错误卡并关闭流式', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_err' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    sc.appendText('partial...')
    await sleep(150)

    await sc.abort(new Error('something went wrong'))
    expect(sc._getPhase()).toBe('aborted')

    const updateCalls = calls.filter((c) => c.api === 'cardkit.v1.card.update')
    expect(updateCalls.length).toBeGreaterThan(0)
    const errCard = JSON.parse(updateCalls[updateCalls.length - 1]!.args.data.card.data)
    expect(errCard.header.template).toBe('red')
    expect(errCard.body.elements[0].content).toContain('something went wrong')
    expect(errCard.body.elements[0].content).toContain('partial...')
  })

  it('idle 阶段 abort 不抛错', async () => {
    const { client } = makeMockClient()
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.abort(new Error('before any card'))
    expect(sc._getPhase()).toBe('aborted')
  })
})

describe('StreamingCard: appendReasoning', () => {
  it('累积 thinking delta 并渲染在卡片中（plain markdown，不用 blockquote）', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_think' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.appendReasoning('Analyzing the problem. ')
    sc.appendReasoning('Let me check file A.')
    await sleep(150)

    const contentCalls = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content')
    expect(contentCalls.length).toBeGreaterThan(0)
    const last = contentCalls[contentCalls.length - 1]!
    expect(last.args.data.content).toContain('💭')
    expect(last.args.data.content).toContain('思考中')
    expect(last.args.data.content).toContain('Analyzing the problem.')
    expect(last.args.data.content).toContain('Let me check file A.')
    expect(last.args.data.content).not.toContain('> Analyzing')
    expect(sc._getAccumulatedReasoning()).toContain('Analyzing')
    expect(sc._getAccumulatedText()).toBe('')
  })

  it('completed 之后 appendReasoning 被忽略', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()
    await sc.finalize()
    sc.appendReasoning('too late')
    expect(sc._getAccumulatedReasoning()).toBe('')
  })
})

describe('StreamingCard: startTool / completeTool', () => {
  it('startTool 压入 running 步骤，completeTool 翻到 done', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_tool' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.startTool('tu_1', 'Read')
    await sleep(150)
    let steps = sc._getToolSteps()
    expect(steps.length).toBe(1)
    expect(steps[0]!.name).toBe('Read')
    expect(steps[0]!.status).toBe('running')

    const runningContent = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .map((c) => c.args.data.content)
      .join('\n')
    expect(runningContent).toContain('⚙️')
    expect(runningContent).toContain('Read')
    expect(runningContent).toContain('🛠️')

    sc.completeTool('tu_1', 'Read')
    await sleep(150)
    steps = sc._getToolSteps()
    expect(steps[0]!.status).toBe('done')

    const lastContent = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .pop()!.args.data.content as string
    expect(lastContent).toContain('✅')
    expect(lastContent).toContain('Read')
    expect(lastContent).not.toContain('⚙️')
  })

  it('按 toolUseId 去重: 同一 id 不重复压入', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.startTool('tu_1', 'Read')
    sc.startTool('tu_1', 'Read')
    sc.startTool('tu_1', 'Read')
    expect(sc._getToolSteps().length).toBe(1)
  })

  it('缺省 toolUseId 时按 name + index 合成 id，不同步骤可并存', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.startTool(undefined, 'Read')
    sc.startTool(undefined, 'Read')
    expect(sc._getToolSteps().length).toBe(2)
  })

  it('completeTool 只匹配最近的 running 同名步骤', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.startTool('tu_1', 'Bash')
    sc.startTool('tu_2', 'Bash')
    sc.completeTool(undefined, 'Bash')
    const steps = sc._getToolSteps()
    expect(steps[0]!.status).toBe('running')
    expect(steps[1]!.status).toBe('done')
  })

  it('空 toolName 忽略', async () => {
    const { client } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.startTool('tu_1', undefined)
    sc.startTool('tu_1', '')
    expect(sc._getToolSteps().length).toBe(0)
  })
})

describe('StreamingCard: 真实事件流（用户场景回归）', () => {
  it('thinking → tool_use → text 应该在每个阶段都触发可见的 flush', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_real' } },
      'im.message.create': { data: { message_id: 'om_real' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'oc_real' })

    const creating = sc.ensureCreated()
    await creating

    sc.appendReasoning('Analyzing the latest commits to find ')
    await sleep(30)
    sc.appendReasoning('breaking changes. Need to look at ')
    await sleep(30)
    sc.appendReasoning('the public API surface, the schema files, ')
    await sleep(30)
    sc.appendReasoning('and any removed exports. Let me check the ')
    await sleep(30)
    sc.appendReasoning('git log first.')

    await sleep(200)

    const flushesAfterReasoning = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content').length
    expect(flushesAfterReasoning).toBeGreaterThan(0)

    const lastReasoningContent = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .pop()!.args.data.content as string
    expect(lastReasoningContent).toContain('breaking changes')
    expect(lastReasoningContent).toContain('git log first')

    sc.startTool('tu_bash_1', 'Bash')
    await sleep(150)

    const lastWithTool = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .pop()!.args.data.content as string
    expect(lastWithTool).toContain('Bash')
    expect(lastWithTool).toContain('⚙️')
    expect(lastWithTool).toContain('🛠️')

    sc.completeTool('tu_bash_1', 'Bash')
    await sleep(150)

    const lastAfterToolDone = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .pop()!.args.data.content as string
    expect(lastAfterToolDone).toContain('Bash')
    expect(lastAfterToolDone).toContain('✅')
    expect(lastAfterToolDone).not.toContain('⚙️')

    sc.startTool('tu_read_1', 'Read')
    await sleep(150)
    sc.completeTool('tu_read_1', 'Read')
    await sleep(150)

    sc.appendText('## 破坏性变更分析\n\n')
    await sleep(120)
    sc.appendText('1. **API 重命名**: foo → bar\n')
    await sleep(120)
    sc.appendText('2. **删除导出**: baz')
    await sleep(200)

    const lastWithText = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .pop()!.args.data.content as string
    expect(lastWithText).toContain('git log first')
    expect(lastWithText).toContain('Bash')
    expect(lastWithText).toContain('Read')
    expect(lastWithText).toContain('破坏性变更分析')
    expect(lastWithText).toContain('API 重命名')

    await sc.finalize()
    expect(sc._getPhase()).toBe('completed')

    expect(calls.some((c) => c.api === 'cardkit.v1.card.settings')).toBe(true)
    expect(calls.some((c) => c.api === 'cardkit.v1.card.update')).toBe(true)
  })

  it('cardKit 流式中第一帧失败不应永久禁用流式 —— 后续帧应能继续', async () => {
    let firstFrameRejected = false
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_recover' } },
      'im.message.create': { data: { message_id: 'om' } },
      'cardElement.content': () => {
        if (!firstFrameRejected) {
          firstFrameRejected = true
          const err: any = new Error('mystery cardkit error')
          err.code = 999999
          throw err
        }
        return { code: 0 }
      },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.appendReasoning('first thought')
    await sleep(150)
    sc.appendReasoning(' second thought')
    await sleep(150)
    const contentCalls = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content')
    expect(contentCalls.length).toBeGreaterThanOrEqual(2)
    expect(sc._isCardKitStreamActive()).toBe(true)
  })
})

describe('StreamingCard: 组合渲染 (tools + reasoning + text)', () => {
  it('三个 section 按顺序 tools → reasoning → answer 组合', async () => {
    const { client, calls } = makeMockClient({
      'card.create': { code: 0, data: { card_id: 'ck_all' } },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })
    await sc.ensureCreated()

    sc.appendReasoning('Should I read file A first?')
    sc.startTool('tu_1', 'Read')
    sc.appendText('Here is the answer.')
    await sleep(150)

    const lastContent = calls
      .filter((c) => c.api === 'cardkit.v1.cardElement.content')
      .pop()!.args.data.content as string

    const idxTools = lastContent.indexOf('🛠️')
    const idxReasoning = lastContent.indexOf('思考中')
    const idxAnswer = lastContent.indexOf('Here is the answer')

    expect(idxTools).toBeGreaterThan(-1)
    expect(idxReasoning).toBeGreaterThan(-1)
    expect(idxAnswer).toBeGreaterThan(-1)
    expect(idxTools).toBeLessThan(idxReasoning)
    expect(idxReasoning).toBeLessThan(idxAnswer)
  })

  it('ensureCreated 期间到达的 tool_use 在卡可写后立即 flush', async () => {
    let resolveCreate: (() => void) | null = null
    const createLatch = new Promise<void>((r) => { resolveCreate = r })

    const { client, calls } = makeMockClient({
      'card.create': async () => {
        await createLatch
        return { code: 0, data: { card_id: 'ck_slow' } }
      },
      'im.message.create': { data: { message_id: 'om' } },
    })
    const sc = new StreamingCard({ larkClient: client, chatId: 'c' })

    const creating = sc.ensureCreated()
    await sleep(10)
    sc.startTool('tu_1', 'Glob')

    const contentBefore = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content')
    expect(contentBefore.length).toBe(0)

    resolveCreate!()
    await creating
    await sleep(150)

    const contentAfter = calls.filter((c) => c.api === 'cardkit.v1.cardElement.content')
    expect(contentAfter.length).toBeGreaterThan(0)
    const last = contentAfter[contentAfter.length - 1]!
    expect(last.args.data.content).toContain('Glob')
    expect(last.args.data.content).toContain('🛠️')
  })
})
