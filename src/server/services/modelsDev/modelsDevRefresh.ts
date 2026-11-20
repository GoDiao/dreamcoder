import * as fs from 'fs/promises'
import * as path from 'path'

import { getClaudeConfigHomeDir } from '../../../utils/envUtils.js'
import { errorMessage, isENOENT } from '../../../utils/errors.js'
import { getProxyFetchOptions } from '../../../utils/proxy.js'
import { getManualNetworkProxyUrl, loadNetworkSettings } from '../networkSettings.js'
import { writeTextFileAtomic } from '../recoverableJsonFile.js'
import { MODELS_DEV_URL, parseModelsDevCatalog, parseModelsDevData, type ModelsDevData } from './catalog.js'
import { currentModelsDevData, setModelsDevData } from './modelsDevStore.js'

const REFRESH_INTERVAL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 60_000

let inFlight: Promise<void> | undefined

function cachePath(): string {
  return path.join(getClaudeConfigHomeDir(), 'dreamcoder', 'cache', 'models-dev.json')
}

async function readCache(): Promise<ModelsDevData | undefined> {
  let text: string
  try {
    text = await fs.readFile(cachePath(), 'utf-8')
  } catch (error) {
    if (!isENOENT(error)) {
      console.warn(`[modelsDev] cache read failed: ${errorMessage(error)}`)
    }
    return undefined
  }
  try {
    return parseModelsDevData(JSON.parse(text))
  } catch (error) {
    console.warn(`[modelsDev] ignoring invalid cache: ${errorMessage(error)}`)
    return undefined
  }
}

async function writeCache(data: ModelsDevData): Promise<void> {
  try {
    await writeTextFileAtomic(cachePath(), JSON.stringify(data))
  } catch (error) {
    console.warn(`[modelsDev] cache write failed: ${errorMessage(error)}`)
  }
}

export async function loadModelsDevCache(): Promise<void> {
  const cached = await readCache()
  if (cached && Date.parse(cached.fetchedAt) > Date.parse(currentModelsDevData().fetchedAt)) setModelsDevData(cached)
}

async function fetchCatalog(): Promise<void> {
  const data = currentModelsDevData()
  const proxy = getProxyFetchOptions({ proxyUrl: getManualNetworkProxyUrl(await loadNetworkSettings()) })
  const response = await fetch(MODELS_DEV_URL, {
    headers: data.etag ? { 'If-None-Match': data.etag } : {},
    ...proxy,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const fetchedAt = new Date().toISOString()
  let next: ModelsDevData
  if (response.status === 304) {
    next = { ...data, fetchedAt }
  } else if (response.ok) {
    const catalog = parseModelsDevCatalog(await response.json())
    const etag = response.headers.get('etag') ?? undefined
    next = { fetchedAt, ...(etag && { etag }), catalog }
  } else {
    throw new Error(`HTTP ${response.status}`)
  }
  setModelsDevData(next)
  await writeCache(next)
}

export function refreshModelsDev(): Promise<void> {
  inFlight ??= fetchCatalog()
    .catch(error => console.warn(`[modelsDev] refresh failed: ${errorMessage(error)}`))
    .finally(() => {
      inFlight = undefined
    })
  return inFlight
}

export async function startModelsDevRefresh(): Promise<() => void> {
  await loadModelsDevCache()
  const timer = setInterval(() => void refreshModelsDev(), REFRESH_INTERVAL_MS)
  timer.unref()
  if (Date.now() - Date.parse(currentModelsDevData().fetchedAt) >= REFRESH_INTERVAL_MS) await refreshModelsDev()
  return () => clearInterval(timer)
}
