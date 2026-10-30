export type TabCommand = "new" | "close" | "next" | "previous";

export function tabShortcut(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): TabCommand | undefined {
  if (input.altKey) return;
  if (input.ctrlKey && input.key === "Tab")
    return input.shiftKey ? "previous" : "next";
  if (!(input.metaKey || input.ctrlKey) || input.shiftKey) return;
  if (input.key.toLowerCase() === "t") return "new";
  if (input.key.toLowerCase() === "w") return "close";
}
