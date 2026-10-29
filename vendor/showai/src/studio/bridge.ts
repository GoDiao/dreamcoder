import type {
  AppUpdateState,
  CloseReport,
  CloseResult,
  CloseSource,
  DesktopAppearance,
  DesktopChange,
  DesktopWindowState,
  MenuCommand,
} from "../desktop/bridge";
import type { Locale } from "../i18n";
import type { TabCommand } from "../workbench/tab-shortcuts";
export interface DesktopBridge {
  onPreviewCapture?(listener: (action: "load" | "clear") => void): () => void;
  previewReady?(id: string, error?: string): void;
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
  onAppUpdate?(listener: (state: AppUpdateState) => void): () => void;
  logPath?(): Promise<string>;
  openLogFolder?(): Promise<void>;
  diagnostics?(): Promise<string>;
  logTail?(lines?: number): Promise<string>;
  exportDiagnostics?(text: string): Promise<{ path: string } | null>;
  onBeforeClose(
    listener: () => Promise<CloseResult>,
    source?: CloseSource,
  ): () => void;
  onBeforeReload?(
    listener: () => Promise<CloseResult>,
    source?: CloseSource,
  ): () => void;
  setDirty?(dirty: boolean): void;
  prepareReload?(): Promise<boolean>;
  prepareReloadReport?(): Promise<CloseReport>;
}

declare global {
  interface Window {
    showai?: DesktopBridge;
  }
}

export const desktop = {
  async openWindow(
    args: Record<string, unknown>,
    prepare: () => Promise<boolean>,
  ): Promise<boolean> {
    if (!window.showai) throw new Error("Desktop integration is unavailable.");
    if (window.showai.openWindow)
      return window.showai.openWindow(args, prepare);
    if (!(await prepare())) return false;
    await window.showai.invoke("app:openWindow", args);
    return true;
  },
  invoke<T = unknown>(
    action: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    if (!window.showai) throw new Error("Desktop integration is unavailable.");
    return window.showai.invoke<T>(action, args);
  },
  onChange(listener: (change: DesktopChange) => void) {
    return window.showai?.onChange(listener) ?? (() => {});
  },
  onTabCommand(listener: (command: TabCommand) => void) {
    return window.showai?.onTabCommand?.(listener) ?? (() => {});
  },
  onRefreshPage(listener: () => void) {
    return window.showai?.onRefreshPage?.(listener) ?? (() => {});
  },
  onMenuCommand(listener: (command: MenuCommand) => void) {
    return window.showai?.onMenuCommand?.(listener) ?? (() => {});
  },
  onAppUpdate(listener: (state: AppUpdateState) => void) {
    return window.showai?.onAppUpdate?.(listener) ?? (() => {});
  },
  /** `source` names this part of the window when it refuses to close. */
  onBeforeClose(listener: () => Promise<CloseResult>, source?: CloseSource) {
    return window.showai?.onBeforeClose(listener, source) ?? (() => {});
  },
  onBeforeReload(listener: () => Promise<CloseResult>, source?: CloseSource) {
    return window.showai?.onBeforeReload?.(listener, source) ?? (() => {});
  },
};

export function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}
export function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
