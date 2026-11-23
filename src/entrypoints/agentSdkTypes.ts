/**
 * Main entrypoint for Claude Code Agent SDK types.
 *
 * This file re-exports the public SDK API from:
 * - sdk/coreTypes.ts - Common serializable types (messages, configs)
 *
 * SDK builders who need control protocol types should import from
 * sdk/controlTypes.ts directly.
 */

// Re-export core types (common serializable types)
export * from './sdk/coreTypes.js'
