import type { Locale } from "../i18n";
import type { TabCommand } from "../workbench/tab-shortcuts";
export const PROJECT_SCOPE_LIMIT = 1000;

export interface DesktopError {
  code: string;
  message: string;
  currentHash?: string;
  currentRevision?: string;
  conflictId?: string;
  /** Node system error code such as ENOSPC, EACCES, EROFS or ENOENT. */
  errno?: string;
  syscall?: string;
  /** File the system error is about. */
  path?: string;
  /** CAPACITY_EXCEEDED: what exceeded its limit, with sizes in bytes. */
  kind?: string;
  actualBytes?: number;
  limitBytes?: number;
  /** Browser mode: HTTP status of a failed request to the local service. */
  status?: number;
  saveFailed?: boolean;
  details?: Record<string, unknown>;
}

export interface DesktopInfo {
  home: string;
  version: string;
  platform: string;
  packaged: boolean;
  mode?: "desktop" | "browser";
  libraryVersion?: 1 | 2;
  cli: { command: string; args: string[]; env: Record<string, string> };
  /** False where the host publishes the documentation itself (the public website). */
  builtinDocs?: boolean;
  /** Source commit the App was built from; "unknown" when it was not recorded. */
  sourceCommit?: string;
  arch?: string;
  osVersion?: string;
  versions?: { node: string; electron?: string; chrome?: string };
}

/** In-app updates of release builds; development and source builds are unsupported. */
export interface AppUpdateState {
  supported: boolean;
  /** Check and download in the background; off leaves checking to the person. */
  automatic: boolean;
  currentVersion: string;
  phase:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "ready"
    | "failed";
  /** The newer version being offered, downloaded or ready to install. */
  version?: string;
  percent?: number;
  checkedAt?: string;
  error?: string;
}

/** Native menu items the workbench carries out with its existing actions. */
export type MenuCommand =
  | "newProject"
  | "newPage"
  | "newTab"
  | "import"
  | "export"
  | "settings"
  | "projects"
  | "docs"
  | "faq"
  | "about"
  | "reportProblem"
  | "copyDiagnostics"
  | "shortcuts";

/** A page whose changes could not be written when its window was closing. */
export interface UnsavedPage {
  projectId: string;
  pageId: string;
  title: string;
  reason: string;
  /** Page source (.showai.json) of the unsaved draft, for export. */
  source?: string;
}

/**
 * Stable codes for why a window refuses to close, quit or reload. Scripts and
 * Agents read them from quit-blocked.json and `npm run dev:status`.
 */
export type CloseBlockerCode =
  /** Page changes could not be written to a local draft. */
  | "PAGE_NOT_RETAINED"
  /** Reload only: the page is kept in a draft but not formally saved yet. */
  | "PAGE_NOT_SAVED"
  /** Reload only: the page save is held by a conflict with another writer. */
  | "PAGE_CONFLICT"
  /** Shared data writes could neither be saved nor kept in a draft. */
  | "DATASET_NOT_RETAINED"
  /** The assistant message draft could not be written to local storage. */
  | "ASSISTANT_DRAFT_NOT_SAVED"
  /** A close listener answered false without saying why. */
  | "LISTENER_REFUSED"
  /** A close listener threw. */
  | "LISTENER_FAILED"
  /** A close listener did not finish in time (still saving or waiting). */
  | "LISTENER_TIMEOUT"
  /** Main process: the window did not answer the close request at all. */
  | "NO_REPLY";

/** Which part of a window a blocker comes from. */
export type CloseSource =
  | "pages"
  | "datasets"
  | "assistant"
  | "sidebar"
  | "workbench"
  | "window";

/** One reason a window cannot close yet. */
export interface CloseBlocker {
  code: CloseBlockerCode;
  source: CloseSource;
  /** Human-readable explanation in the workbench language, when the listener has one. */
  message?: string;
  projectId?: string;
  pageId?: string;
  datasetId?: string;
  /** Page title or dataset name. */
  title?: string;
  /** LISTENER_TIMEOUT / NO_REPLY: how long was waited. */
  seconds?: number;
}

/** A close listener either allows closing or explains what holds it open. */
export type CloseResult =
  | boolean
  | { allow: boolean; pages?: UnsavedPage[]; blockers?: CloseBlocker[] };

/** Every close listener of one window, aggregated. */
export interface CloseReport {
  allow: boolean;
  pages: UnsavedPage[];
  blockers: CloseBlocker[];
  /** Plain-text summary of the blockers, for logs and older readers. */
  reason: string;
}

export function closeAllowed(result: CloseResult): boolean {
  return typeof result === "boolean" ? result : result.allow === true;
}

export interface DesktopChange {
  type: "files" | "home";
  home: string;
  projectIds?: string[];
  pageIds?: string[];
  /** Changed shared datasets as "projectId/datasetId"; "projectId/*" for the whole folder. */
  datasets?: string[];
  catalog?: boolean;
  projects?: boolean;
  sidebar?: boolean;
  all?: boolean;
  allPages?: boolean;
}

export interface DesktopWindowState {
  fullScreen: boolean;
}

/** Private data delivered only to the background page capture frame. */
export interface PagePreviewCapture {
  id: string;
  theme: string;
  padding: number;
  record: import("../studio/usePage").LoadedPage;
}

export type DesktopAppearance = "light" | "dark";

export interface ShowAIBridge {
  /** Private to native capture frames. */
  onPreviewCapture?(listener: (action: "load" | "clear") => void): () => void;
  previewReady?(id: string, error?: string): void;
  /** Desktop can rasterize directory pages in a separate renderer process. */
  pageThumbnails?: boolean;
  onPageThumbnail?(
    listener: (reference: {
      projectId: string;
      pageId: string;
      theme: string;
    }) => void,
  ): () => void;
  inlineInk?: import("../surface/inline-ink").InlineInkBridge;
  openWindow?(
    args: Record<string, unknown>,
    prepare: () => Promise<boolean>,
  ): Promise<boolean>;
  setAppearance?(appearance: DesktopAppearance): Promise<void>;
  /** Keeps native menus and dialogs in the workbench language. */
  setLocale?(locale: Locale): Promise<void>;
  getWindowState?(): Promise<DesktopWindowState>;
  onWindowStateChange?(
    listener: (state: DesktopWindowState) => void,
  ): () => void;
  invoke<T = unknown>(
    action: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  onChange(listener: (change: DesktopChange) => void): () => void;
  onTabCommand?(listener: (command: TabCommand) => void): () => void;
  onRefreshPage?(listener: () => void): () => void;
  onMenuCommand?(listener: (command: MenuCommand) => void): () => void;
  /** Desktop: state changes of in-app updates, pushed to every window. */
  onAppUpdate?(listener: (state: AppUpdateState) => void): () => void;
  /** Desktop only: the main-process log and its folder. */
  logPath?(): Promise<string>;
  openLogFolder?(): Promise<void>;
  /** Plain-text diagnostics (versions, platform, library, log path), redacted. */
  diagnostics?(): Promise<string>;
  /** The last lines of the main-process log, redacted. */
  logTail?(lines?: number): Promise<string>;
  /** Saves redacted diagnostics where the person chooses; null when cancelled. */
  exportDiagnostics?(text: string): Promise<{ path: string } | null>;
  /** `source` names the part of the window in refusal reports. */
  onBeforeClose(
    listener: () => Promise<CloseResult>,
    source?: CloseSource,
  ): () => void;
  onBeforeReload?(
    listener: () => Promise<CloseResult>,
    source?: CloseSource,
  ): () => void;
  prepareReload?(): Promise<boolean>;
  /** Development: like prepareReload, with the reasons a reload is refused. */
  prepareReloadReport?(): Promise<CloseReport>;
}

export type DesktopResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: DesktopError };
