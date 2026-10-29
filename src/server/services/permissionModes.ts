import {
  DEFAULT_PERMISSION_MODES,
  PERMISSION_MODES,
  type DefaultPermissionMode,
  type PermissionMode,
} from '../ws/protocol.js'

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

export function isDefaultPermissionMode(value: unknown): value is DefaultPermissionMode {
  return typeof value === 'string' && (DEFAULT_PERMISSION_MODES as readonly string[]).includes(value)
}

export function permissionModeCliArgs(mode: string | undefined): string[] {
  const resolvedMode = mode || 'default'
  if (resolvedMode === 'bypassPermissions') {
    return ['--dangerously-skip-permissions']
  }
  return ['--permission-mode', resolvedMode]
}

export function permissionModeFromTranscriptEntries(
  entries: ReadonlyArray<Record<string, unknown>>,
): PermissionMode | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (
      (entry.type === 'permission-mode' || entry.type === 'user') &&
      isPermissionMode(entry.permissionMode)
    ) {
      return entry.permissionMode
    }
  }
  return null
}
