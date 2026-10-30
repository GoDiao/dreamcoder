import { useSyncExternalStore } from "react";

export type AppearanceTheme = "light" | "dark";

function readTheme(): AppearanceTheme {
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme;
  const saved = localStorage.getItem("showai:appearance");
  return saved === "dark" ||
    (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";
}

function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

export function useAppearanceTheme() {
  return useSyncExternalStore(subscribe, readTheme, () => "light" as const);
}
