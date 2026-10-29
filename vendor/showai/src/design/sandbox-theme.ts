import type { AppearanceTheme } from "./useAppearanceTheme";

/** Serialized into the isolated component document, including older packages. */
export function installSandboxTheme(
  channel: string,
  theme: AppearanceTheme,
  tokens: Record<string, string>,
) {
  const apply = (value: AppearanceTheme, values: Record<string, string>) => {
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
    for (const [name, value] of Object.entries(values))
      if (name.startsWith("--"))
        document.documentElement.style.setProperty(name, value);
  };
  apply(theme, tokens);
  window.addEventListener("message", (event) => {
    if (
      event.source === parent &&
      event.data?.channel === channel &&
      event.data.type === "showai:theme" &&
      (event.data.theme === "light" || event.data.theme === "dark")
    )
      apply(event.data.theme, event.data.tokens ?? {});
  });
}

export function appearanceTokens() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    [...style]
      .filter((name) => name.startsWith("--"))
      .map((name) => [name, style.getPropertyValue(name)]),
  );
}
