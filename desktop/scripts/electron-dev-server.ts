type DevServerProcess = { readonly exitCode: number | null }

type FetchDevServer = (url: string) => Promise<{ ok: boolean }>

type WaitOptions = {
  timeoutMs?: number
  stabilizationMs?: number
  fetcher?: FetchDevServer
  sleep?: (milliseconds: number) => Promise<void>
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export async function assertDevServerAvailable(url: string, fetcher: FetchDevServer = fetch): Promise<void> {
  let occupied = false
  try {
    await fetcher(url)
    occupied = true
  } catch {
    occupied = false
  }
  if (occupied) throw new Error(`[electron-dev] ${url} is already in use. Stop the other dev server and try again.`)
}

export async function waitForDevServer(
  url: string,
  process: DevServerProcess,
  { timeoutMs = 60_000, stabilizationMs = 500, fetcher = fetch, sleep = delay }: WaitOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`[electron-dev] Vite exited before startup with code ${process.exitCode}.`)
    let ready = false
    try {
      ready = (await fetcher(url)).ok
    } catch {
      ready = false
    }
    if (ready) {
      await sleep(stabilizationMs)
      if (process.exitCode !== null) throw new Error(`[electron-dev] Vite exited during startup with code ${process.exitCode}.`)
      return
    }
    await sleep(250)
  }
  throw new Error(`[electron-dev] Vite did not answer on ${url} within ${timeoutMs / 1000} seconds`)
}
