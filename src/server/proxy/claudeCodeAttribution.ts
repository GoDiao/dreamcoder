/**
 * Proxy-side Claude Code billing attribution based on sub2api gateway behavior.
 * Reference: https://github.com/Wei-Shaw/sub2api
 * License: LGPL-3.0-or-later, Copyright (c) 2026 Wesley Liddick.
 */
import {
  CLAUDE_CODE_BILLING_HEADER_PREFIX,
  CLAUDE_CODE_COMPAT_VERSION,
  formatClaudeCodeBillingHeader,
} from '../../constants/claudeCodeCompatibility.js'
import { computeFingerprint } from '../../utils/fingerprint.js'
import type { AnthropicRequest } from './transform/types.js'

export function extractFirstUserText(body: AnthropicRequest): string {
  for (const message of body.messages) {
    if (message.role !== 'user') continue

    if (typeof message.content === 'string') {
      return message.content
    }

    const textBlock = message.content.find(block => block.type === 'text')
    return textBlock?.type === 'text' ? textBlock.text : ''
  }

  return ''
}

export function ensureClaudeCodeAttribution(body: AnthropicRequest): AnthropicRequest {
  if (hasBillingAttribution(body.system)) return body

  const fingerprint = computeFingerprint(extractFirstUserText(body), CLAUDE_CODE_COMPAT_VERSION)
  const billingBlock = {
    type: 'text' as const,
    text: formatClaudeCodeBillingHeader({
      fingerprint,
      entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? 'unknown',
    }),
  }

  return {
    ...body,
    system: typeof body.system === 'string'
      ? [billingBlock, { type: 'text', text: body.system }]
      : [billingBlock, ...(body.system ?? [])],
  }
}

function hasBillingAttribution(system: AnthropicRequest['system']): boolean {
  if (typeof system === 'string') {
    return system.startsWith(CLAUDE_CODE_BILLING_HEADER_PREFIX)
  }

  return Array.isArray(system) && system.some(block => (
    block?.type === 'text' && typeof block.text === 'string' && block.text.startsWith(CLAUDE_CODE_BILLING_HEADER_PREFIX)
  ))
}
