import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { PairedUser, PairingState } from './config.js'

const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export type ImPlatform = 'telegram' | 'feishu' | 'wechat' | 'dingtalk'

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS = 5
const failedAttempts = new Map<string, { count: number; firstAttempt: number }>()

function isRateLimited(userId: string | number): boolean {
  const key = String(userId)
  const record = failedAttempts.get(key)
  if (!record) return false
  if (Date.now() - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    failedAttempts.delete(key)
    return false
  }
  return record.count >= RATE_LIMIT_MAX_ATTEMPTS
}

function recordFailedAttempt(userId: string | number): void {
  const key = String(userId)
  const record = failedAttempts.get(key)
  if (!record || Date.now() - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    failedAttempts.set(key, { count: 1, firstAttempt: Date.now() })
  } else {
    record.count++
  }
}
const CODE_LENGTH = 6
const CODE_TTL_MS = 60 * 60 * 1000

function getConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'adapters.json')
}

function readConfigFile(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeConfigFile(data: Record<string, any>): void {
  const filePath = getConfigPath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp.${crypto.randomBytes(8).toString('hex')}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, filePath)
}

export function generatePairingCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += SAFE_ALPHABET[crypto.randomInt(SAFE_ALPHABET.length)]
  }
  return code
}

export function isPaired(
  platform: ImPlatform,
  userId: string | number,
  config: Record<string, any>,
): boolean {
  const platformConfig = config[platform] ?? {}
  const allowedUsers: (string | number)[] = platformConfig.allowedUsers ?? []
  const pairedUsers: PairedUser[] = platformConfig.pairedUsers ?? []

  if (allowedUsers.length > 0 && allowedUsers.includes(userId)) return true
  if (pairedUsers.length === 0 && allowedUsers.length === 0) return false

  return pairedUsers.some((p) => String(p.userId) === String(userId))
}

export function tryPair(
  messageText: string,
  senderInfo: { userId: string | number; displayName: string },
  platform: ImPlatform,
): boolean {
  const file = readConfigFile()
  const pairing: PairingState = file.pairing ?? { code: null, expiresAt: null, createdAt: null }

  if (isRateLimited(senderInfo.userId)) return false

  if (!pairing.code || !pairing.expiresAt) return false
  if (Date.now() > pairing.expiresAt) return false

  const input = messageText.trim().toUpperCase()
  if (input !== pairing.code.toUpperCase()) {
    recordFailedAttempt(senderInfo.userId)
    return false
  }

  const platformConfig = file[platform] ?? {}
  const pairedUsers: PairedUser[] = platformConfig.pairedUsers ?? []

  const exists = pairedUsers.some((p) => String(p.userId) === String(senderInfo.userId))
  if (!exists) {
    pairedUsers.push({
      userId: senderInfo.userId,
      displayName: senderInfo.displayName,
      pairedAt: Date.now(),
    })
  }

  file[platform] = { ...platformConfig, pairedUsers }
  file.pairing = { code: null, expiresAt: null, createdAt: null }
  writeConfigFile(file)

  return true
}

export function isAllowedUser(platform: ImPlatform, userId: string | number): boolean {
  try {
    const cfgFile = readConfigFile()
    return isPaired(platform, userId, cfgFile)
  } catch {
    return false
  }
}
