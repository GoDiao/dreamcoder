const INVALID_TOOL_ARGUMENTS_KEY = '__dreamcoder_invalid_arguments'

export type InvalidToolArguments = { receivedChars: number; parseError: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  if (raw.trim().length === 0) return {}
  let parseError: string
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null) return {}
    if (isRecord(parsed)) return parsed
    parseError = 'the arguments are not a JSON object'
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }
  const invalid: InvalidToolArguments = { receivedChars: raw.length, parseError }
  return { [INVALID_TOOL_ARGUMENTS_KEY]: invalid }
}

export function readInvalidToolArguments(input: unknown): InvalidToolArguments | undefined {
  if (!isRecord(input)) return undefined
  const invalid = input[INVALID_TOOL_ARGUMENTS_KEY]
  return isRecord(invalid) ? invalid as InvalidToolArguments : undefined
}

export function invalidToolArgumentsMessage({ receivedChars, parseError }: InvalidToolArguments): string {
  return `The arguments of this tool call are not a complete JSON object (received ${receivedChars} characters: ${parseError}). They were most likely cut off by the output token limit, so the tool was not run. Call the tool again with shorter arguments, for example by writing a large file in several smaller parts.`
}
