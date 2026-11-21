export function getEnterWorktreeToolPrompt(): string {
  return `Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository
- Must not already be in a worktree

## Behavior

- Creates a new git worktree inside \`.claude/worktrees/\` with a new branch based on HEAD
- Switches the session's working directory to the new worktree
- The desktop app's file and diff panels keep showing the original directory, so tell the user the worktree path and branch
- The worktree stays on disk until you call ExitWorktree (keep or remove); ending the session does not remove it

## Parameters

- \`name\` (optional): A name for the worktree. If not provided, a random name is generated.
`
}
