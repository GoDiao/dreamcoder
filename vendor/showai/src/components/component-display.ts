import { getLocale, translator } from "../i18n";
import messages from "../i18n/messages/catalog";
import type { ComponentCategory } from "./custom/types";

/** Built-in metadata has a `kind`; custom components are identified by `id`. */
type DisplayItem = { name: string; description: string } & (
  { kind: string } | { kind?: undefined }
);

// Display-time text for the component catalog. Stored catalog metadata (category
// labels, built-in names and descriptions) stays in Chinese because the Agent
// and CLI read it too; the UI translates by stable id and falls back to it.

const t = translator(messages);

export function componentCategoryLabel(id: ComponentCategory): string {
  return t(`category.${id}`);
}

export type BuiltinDisplayText = Record<
  string,
  { name: string; description: string }
>;

// Registered by editing hosts (workbench, canvas) so read-only readers don't
// bundle English text for every built-in component.
let builtinEnglish: BuiltinDisplayText = {};

export function registerBuiltinDisplayText(table: BuiltinDisplayText) {
  builtinEnglish = table;
}

function english(item: DisplayItem) {
  return getLocale() === "en" && item.kind
    ? builtinEnglish[item.kind]
    : undefined;
}

/** Display name: built-ins are translated by kind; custom component names are user content. */
export function componentDisplayName(item: DisplayItem): string {
  return english(item)?.name ?? item.name;
}

export function componentDisplayDescription(item: DisplayItem): string {
  const text = english(item);
  if (!text) return item.description;
  return text.description;
}
