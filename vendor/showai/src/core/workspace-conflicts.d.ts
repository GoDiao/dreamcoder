export interface WorkspaceConflict {
  format: "showai-workspace-conflict";
  version: 1;
  id: string;
  path: string;
  baseRevision: string | null;
  observedAt: string;
  kind: "added" | "modified" | "deleted";
  observedHash: string | null;
  state: "unresolved" | "resolved";
  resolution?: "discard" | "import" | "merge";
  resolvedAt?: string;
  resolvedRevision?: string | null;
}
