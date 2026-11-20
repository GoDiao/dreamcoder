import snapshotText from '../../config/modelsDev.json' with { type: 'text' }
import { buildModelsDevIndex, parseModelsDevData, type ModelsDevData, type ModelsDevIndex } from './catalog.js'

let bundled: ModelsDevData | undefined
let current: ModelsDevData | undefined
let currentIndex: { data: ModelsDevData; index: ModelsDevIndex } | undefined

export function bundledModelsDevData(): ModelsDevData {
  bundled ??= parseModelsDevData(JSON.parse(String(snapshotText)))
  return bundled
}

export function currentModelsDevData(): ModelsDevData {
  return current ?? bundledModelsDevData()
}

export function currentModelsDevIndex(): ModelsDevIndex {
  const data = currentModelsDevData()
  if (currentIndex?.data !== data) currentIndex = { data, index: buildModelsDevIndex(data.catalog) }
  return currentIndex.index
}

export function setModelsDevData(data: ModelsDevData | null): void {
  current = data ?? undefined
}
