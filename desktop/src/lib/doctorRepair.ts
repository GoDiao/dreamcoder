import { APP_ZOOM_STORAGE_KEY, LEGACY_UI_ZOOM_STORAGE_KEY } from './appZoom'
import { DESKTOP_PERSISTENCE_VERSION_KEY } from './persistenceMigrations'

export const SAFE_DOCTOR_STORAGE_KEYS = [
  'dreamcoder-open-tabs',
  'dreamcoder-session-runtime',
  'dreamcoder-theme',
  'dreamcoder-locale',
  APP_ZOOM_STORAGE_KEY,
  LEGACY_UI_ZOOM_STORAGE_KEY,
  DESKTOP_PERSISTENCE_VERSION_KEY,
] as const

type DoctorStorage = Pick<Storage, 'getItem' | 'removeItem'>

export type LocalDoctorRepairResult = {
  removedKeys: string[]
  missingKeys: string[]
  failedKeys: string[]
}

function getDefaultDoctorStorage(): DoctorStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function runLocalDoctorRepair(storage: DoctorStorage | null = getDefaultDoctorStorage()): LocalDoctorRepairResult {
  if (!storage) {
    return {
      removedKeys: [],
      missingKeys: [...SAFE_DOCTOR_STORAGE_KEYS],
      failedKeys: [],
    }
  }

  const removedKeys: string[] = []
  const missingKeys: string[] = []
  const failedKeys: string[] = []

  for (const key of SAFE_DOCTOR_STORAGE_KEYS) {
    try {
      if (storage.getItem(key) === null) {
        missingKeys.push(key)
        continue
      }
      storage.removeItem(key)
      removedKeys.push(key)
    } catch {
      failedKeys.push(key)
    }
  }

  return { removedKeys, missingKeys, failedKeys }
}
