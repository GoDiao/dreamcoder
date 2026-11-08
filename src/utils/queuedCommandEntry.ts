export function queuedCommandSourceUuid(entry: { type?: unknown; attachment?: unknown }): string | undefined {
  if (entry.type !== 'attachment' || typeof entry.attachment !== 'object' || entry.attachment === null) return undefined
  const attachment = entry.attachment as { type?: unknown; source_uuid?: unknown }
  return attachment.type === 'queued_command' && typeof attachment.source_uuid === 'string' && attachment.source_uuid.length > 0
    ? attachment.source_uuid
    : undefined
}
