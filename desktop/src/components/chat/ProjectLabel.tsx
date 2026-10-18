import { Folder, GitBranch } from 'lucide-react'

type Props = {
  workDir?: string | null
  repoName?: string | null
  branch?: string | null
  sourceWorkDir?: string | null
  isWorktree?: boolean
  worktreeSlug?: string | null
  worktreePath?: string | null
}

function basename(path: string | null | undefined): string {
  return path?.split('/').filter(Boolean).pop() || ''
}

/** Read-only project and branch shown in the composer controls row once a session has started. */
export function ProjectLabel({
  workDir,
  repoName,
  branch,
  sourceWorkDir,
  isWorktree = false,
  worktreeSlug,
  worktreePath,
}: Props) {
  const labelRoot = isWorktree ? (sourceWorkDir || workDir) : workDir
  const label = branch ? (repoName || basename(labelRoot)) : (basename(labelRoot) || repoName || '')
  const worktreeName = worktreeSlug || basename(worktreePath) || 'isolated'
  const title = [
    label,
    branch ? `branch: ${branch}` : null,
    isWorktree ? `worktree: ${worktreeName}` : null,
    worktreePath ? `worktree cwd: ${worktreePath}` : null,
    workDir ? `cwd: ${workDir}` : null,
  ].filter(Boolean).join('\n')

  if (!label) return null

  return (
    <span
      data-testid="composer-project-label"
      title={title}
      className="inline-flex h-7 min-w-0 max-w-[280px] items-center gap-1.5 px-1.5 text-ui-aux text-[var(--color-text-secondary)]"
    >
      <Folder size={14} className="shrink-0" aria-hidden="true" />
      <span className="truncate font-medium text-[var(--color-text-primary)]">{label}</span>
      {branch && !isWorktree && (
        <>
          <GitBranch size={13} className="ml-1 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <span className="truncate">{branch}</span>
        </>
      )}
      {isWorktree && (
        <span className="shrink-0 rounded-[4px] border border-[var(--color-border)] px-1 text-[10px] uppercase leading-4 text-[var(--color-text-tertiary)]">
          worktree
        </span>
      )}
    </span>
  )
}
