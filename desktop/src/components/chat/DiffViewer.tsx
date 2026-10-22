import { lazy, Suspense } from 'react'
import { CopyButton } from '../shared/CopyButton'

const DiffViewerBody = lazy(() => import('./DiffViewerBody'))

// Matches the rendered diff rows (12px font, 1.45 line height, 1px padding) so the card
// does not jump when the diff body finishes loading.
const DIFF_ROW_HEIGHT_PX = 20
const DIFF_MAX_HEIGHT_PX = 400

type Props = {
  filePath: string
  oldString: string
  newString: string
}

export function DiffViewer({ filePath, oldString, newString }: Props) {
  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  const additions = newLines.filter((l, i) => l !== (oldLines[i] ?? null)).length
  const deletions = oldLines.filter((l, i) => l !== (newLines[i] ?? null)).length
  const placeholderHeight = Math.min(DIFF_MAX_HEIGHT_PX, (oldLines.length + additions) * DIFF_ROW_HEIGHT_PX)

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-outline-variant)]/50 bg-[var(--color-surface-container-low)]">
      <div className="flex items-center justify-between border-b border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container)] px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
            {filePath}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
            <span className="rounded-full bg-[var(--color-diff-added-bg)] px-2 py-0.5 text-[var(--color-diff-added-text)]">+{additions}</span>
            <span className="rounded-full bg-[var(--color-diff-removed-bg)] px-2 py-0.5 text-[var(--color-diff-removed-text)]">-{deletions}</span>
          </div>
        </div>
        <CopyButton
          text={`--- ${filePath}\n+++ ${filePath}`}
          label="Copy path"
          className="rounded-md border border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-lowest)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]"
        />
      </div>

      <div className="max-h-[400px] overflow-auto">
        <Suspense
          fallback={
            <div
              role="status"
              aria-label="Loading diff"
              className="bg-[var(--color-code-bg)]"
              style={{ height: placeholderHeight }}
            />
          }
        >
          <DiffViewerBody filePath={filePath} oldString={oldString} newString={newString} />
        </Suspense>
      </div>
    </div>
  )
}
