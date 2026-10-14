const queues = new Map<string, Promise<void>>()

export async function enqueue(chatId: string, fn: () => Promise<void>): Promise<void> {
  const prev = queues.get(chatId) ?? Promise.resolve()
  const next = prev.then(fn, () => fn()).catch((err) => {
    console.error(`[ChatQueue] Error in task for chat ${chatId}:`, err)
  })
  queues.set(chatId, next)
  next.finally(() => {
    if (queues.get(chatId) === next) {
      queues.delete(chatId)
    }
  })
  return next
}
