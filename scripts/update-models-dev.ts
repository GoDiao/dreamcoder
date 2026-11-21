#!/usr/bin/env bun

import { writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  MODELS_DEV_URL,
  parseModelsDevCatalog,
  serializeModelsDevSnapshot,
} from '../src/server/services/modelsDev/catalog.js'

export const MODELS_DEV_SNAPSHOT_PATH = 'src/server/config/modelsDev.json'

export async function fetchModelsDevSnapshot(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(MODELS_DEV_URL, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${MODELS_DEV_URL} returned HTTP ${response.status}`)
  const catalog = parseModelsDevCatalog(await response.json())
  return serializeModelsDevSnapshot({ fetchedAt: new Date().toISOString(), catalog })
}

if (import.meta.main) {
  const snapshot = await fetchModelsDevSnapshot()
  writeFileSync(path.resolve(import.meta.dir, '..', MODELS_DEV_SNAPSHOT_PATH), snapshot)
  console.log(`Updated ${MODELS_DEV_SNAPSHOT_PATH}`)
}
