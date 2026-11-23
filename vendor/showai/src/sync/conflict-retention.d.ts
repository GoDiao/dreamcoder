export interface ConflictSource {
  account: string;
  deviceId: string;
  revision: string | null;
  baseRevision?: string;
  label?: string;
}
export interface RetainedConflict {
  format: "showai-retained-sync-conflict";
  version: 1;
  id: string;
  at: string;
  originalPath: string;
  originalPageId?: string;
  variants: {
    source: ConflictSource;
    pageId: string;
    title: string;
    path: string;
    deleted: boolean;
    hash: string | null;
  }[];
}
