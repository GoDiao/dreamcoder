import type { Camera } from "./model";

export interface BoardCaptureState {
  boardId: string;
  cameras?: Record<string, Camera>;
  pageScrolls?: Record<string, { x: number; y: number }>;
}

/** Only exported read previews carry this transient state; it never enters a Page. */
export function readingCapture(): BoardCaptureState | undefined {
  if (typeof window === "undefined") return;
  const text = window.document.getElementById(
    "showai-read-options",
  )?.textContent;
  return text ? JSON.parse(text).boardCapture : undefined;
}
