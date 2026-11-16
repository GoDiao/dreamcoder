import { t } from '../i18n'

export type ArtifactEdit = { title: string; files: string[]; slides: boolean }

type ArtifactEditChange = { dir: string; title: string; files: string[]; slides?: boolean }

export function artifactEditReference(change: ArtifactEditChange, earlier?: ArtifactEdit) {
  return {
    kind: 'artifact-edit' as const,
    path: change.dir,
    name: t('artifacts.editedChip', { title: change.title }),
    artifactEdit: {
      title: change.title,
      files: [...new Set([...(earlier?.files ?? []), ...change.files])],
      slides: !!earlier?.slides || !!change.slides,
    },
  }
}

export function artifactEditAttachment(reference: { name: string }) {
  return { type: 'artifact' as const, name: reference.name }
}

export function formatArtifactEditPrompt(edits: Array<{ path: string; artifactEdit?: ArtifactEdit }>): string {
  if (edits.length === 0) return ''
  const lines = [
    'The user changed these artifacts in the app:',
    ...edits.map((edit) => `- ${edit.path}: ${(edit.artifactEdit?.files ?? []).join(', ')}`),
    'Before you change one of them, read the files the user changed and keep their changes.',
  ]
  if (edits.some((edit) => edit.artifactEdit?.slides)) {
    lines.push('Where the user reordered or deleted slides of a deck, also read its artifact.json again in full, check the section numbers, the totals of sections and the references between slides against the order in `slides`, and fix what no longer matches.')
  }
  return lines.join('\n')
}
