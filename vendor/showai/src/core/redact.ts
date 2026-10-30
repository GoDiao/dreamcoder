/**
 * Removes personal paths and secrets from error details before they leave the
 * machine (copied to the clipboard, attached to a problem report). Has no
 * dependencies so the Electron main process, the local server and the
 * renderer can all use it.
 */
export interface RedactOptions {
  /** The person's home directory; replaced with `~`. */
  home?: string;
  /** The content library root; replaced with `<library>`. */
  library?: string;
  /** Shorten UUIDs to their first 8 characters. */
  truncateIds?: boolean;
}

const REDACTED = "[redacted]";

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces `root` (and anything below it) in either slash style. */
function replaceRoot(text: string, root: string, label: string) {
  const trimmed = root.replace(/[\\/]+$/, "");
  if (trimmed.length < 2) return text;
  const variants = new Set([trimmed, trimmed.replace(/\\/g, "/")]);
  for (const variant of variants)
    text = text.replace(
      new RegExp(`${escape(variant)}(?=$|[\\\\/\\s"'\`),:;])`, "g"),
      label,
    );
  return text;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  // Authorization headers and bearer tokens.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // OpenAI / Anthropic style keys.
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  // GitHub tokens.
  [/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, REDACTED],
  // Slack tokens.
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, REDACTED],
  // Google API keys.
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  // AWS access key ids.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  // Secret URL query parameters, e.g. an OAuth callback ?code=….
  [
    /([?&](?:token|code|key|secret|access_token|refresh_token|api_key|apikey|signature|sig)=)[^\s"'&#]+/gi,
    `$1${REDACTED}`,
  ],
  // key=value / "key": "value" pairs whose name says they are secret.
  [
    /\b((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|client[_-]?secret|authorization)["']?\s*[:=]\s*["']?)(?!(?:Bearer|Basic)\s|\[redacted\])[^\s"'&,;}]{4,}/gi,
    `$1${REDACTED}`,
  ],
];

const UUID =
  /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function redact(text: string, options: RedactOptions = {}): string {
  let result = text;
  // Longer roots first: a library inside the home directory keeps its label.
  const roots = [
    ...(options.library ? [[options.library, "<library>"] as const] : []),
    ...(options.home ? [[options.home, "~"] as const] : []),
  ].sort((a, b) => b[0].length - a[0].length);
  for (const [root, label] of roots) result = replaceRoot(result, root, label);
  // Home directories the caller did not name, e.g. in the renderer.
  result = result
    .replace(/(?<=^|[\s"'`(=:,[])\/Users\/(?!Shared\b)[^/\s"'`]+/g, "~")
    .replace(/(?<=^|[\s"'`(=:,[])\/home\/[^/\s"'`]+/g, "~")
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s"'`]+/g, "~");
  for (const [pattern, replacement] of SECRET_PATTERNS)
    result = result.replace(pattern, replacement);
  if (options.truncateIds) result = result.replace(UUID, "$1");
  return result;
}
