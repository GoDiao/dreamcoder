import type {
  ComputerUseHostAdapter,
  Logger,
} from '../../vendor/computer-use-mcp/types.js'
import { format } from 'util'
import { logForDebugging } from '../debug.js'
import { COMPUTER_USE_MCP_SERVER_NAME } from './common.js'
import { createCliExecutor } from './executor.js'
import { createUiaExecutor } from './uiaExecutor.js'
import { getChicagoEnabled, getChicagoSubGates } from './gates.js'
import { normalizeOsPermissions } from './permissions.js'
import { callPythonHelper } from './pythonBridge.js'
import type { ComputerUseMode } from './preauthorizedConfig.js'
import { DEFAULT_COMPUTER_USE_MODE } from './preauthorizedConfig.js'

class DebugLogger implements Logger {
  silly(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  debug(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  info(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'info' })
  }
  warn(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'warn' })
  }
  error(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'error' })
  }
}

let cached: ComputerUseHostAdapter | undefined
let currentMode: ComputerUseMode = DEFAULT_COMPUTER_USE_MODE

export function setComputerUseMode(mode: ComputerUseMode): void {
  if (mode !== currentMode) {
    currentMode = mode
    cached = undefined // invalidate cache, will rebuild on next access
  }
}

export function getComputerUseMode(): ComputerUseMode {
  return currentMode
}

export function getComputerUseHostAdapter(): ComputerUseHostAdapter {
  if (cached) return cached

  const executorFactory = currentMode === 'uia_tree' ? createUiaExecutor : createCliExecutor

  cached = {
    serverName: COMPUTER_USE_MCP_SERVER_NAME,
    logger: new DebugLogger(),
    executor: executorFactory({
      getMouseAnimationEnabled: () => getChicagoSubGates().mouseAnimation,
      getHideBeforeActionEnabled: () => getChicagoSubGates().hideBeforeAction,
    }),
    ensureOsPermissions: async () => {
      const rawPerms = await callPythonHelper<{ accessibility: boolean; screenRecording: boolean | null }>('check_permissions', {})
      const perms = normalizeOsPermissions(rawPerms)
      return perms.granted
        ? { granted: true as const }
        : { granted: false as const, accessibility: perms.accessibility, screenRecording: perms.screenRecording }
    },
    isDisabled: () => !getChicagoEnabled(),
    getSubGates: getChicagoSubGates,
    getAutoUnhideEnabled: () => true,
    cropRawPatch: () => null,
  }
  return cached
}
