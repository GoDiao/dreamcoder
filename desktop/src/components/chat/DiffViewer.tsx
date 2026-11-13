import { lazy, Suspense } from 'react'
import { useTranslation } from '../../i18n'
import { CopyButton } from '../shared/CopyButton'

const DiffViewerBody = lazy(() => import('./DiffViewerBody'))

const DIFF_ROW_HEIGHT_PX = 20
const DIFF_MAX_HEIGHT_PX = 400

type Props = {
  filePath: string
  oldString: string
  newString: string
}

export function DiffViewer({ filePath, oldString, newString }: Props) {
  const t = useTranslation()
  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  const additions = newLines.filter((l, i) => l !== (oldLines[i] ?? null)).length
  const deletions = oldLines.filter((l, i) => l !== (newLines[i] ?? null)).length
  const placeholderHeight = Math.min(DIFF_MAX_HEIGHT_PX, (oldLines.length + additions) * DIFF_ROW_HEIGHT_PX)

  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
      <div className="flex items-center justify-between border-b border-border/40 bg-muted px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate font-mono text-2xs text-subtle-foreground">
            {filePath}
          </div>
          <div className="mt-1 flex items-center gap-2 text-3xs uppercase tracking-widest">
            <span className="rounded-full bg-diff-added px-2 py-0.5 text-diff-added-foreground">+{additions}</span>
            <span className="rounded-full bg-diff-removed px-2 py-0.5 text-diff-removed-foreground">-{deletions}</span>
          </div>
        </div>
        <CopyButton
          text={`--- ${filePath}\n+++ ${filePath}`}
          label={t('workspace.copyPath')}
        />
      </div>

      <div className="max-h-[400px] overflow-auto">
        <Suspense
          fallback={
            <div
              role="status"
              aria-label={t('workspace.loadingDiff')}
              className="bg-code"
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
