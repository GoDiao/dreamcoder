import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ComponentLibraryContext } from "./ComponentLibrary";
import { useAvailableComponents } from "./custom/CustomBlock";
import type { CompiledComponent } from "./custom/types";
import {
  latestComponentVersions,
  type CatalogComponent,
} from "../core/component-categories";
import { builtinComponentCatalog } from "./catalog";
import { componentWidgetData } from "./custom/contract";
import { translator } from "../i18n";
import {
  componentDisplayDescription,
  componentDisplayName,
} from "./component-display";
import messages from "../i18n/messages/customComponents";

const t = translator(messages);

export const RegisterComponentContext = createContext<
  (component: CompiledComponent) => void
>(() => {});
export function useComponentCatalog(open: boolean) {
  const library = useContext(ComponentLibraryContext);
  const available = useAvailableComponents();
  const builtins = useMemo(() => builtinComponentCatalog(), []);
  const [catalog, setCatalog] = useState<CatalogComponent[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !library) return;
    let active = true;
    setLoading(true);
    setError("");
    library
      .list()
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch((reason) => {
        if (active) setError(reason.message ?? String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, library]);
  const items = useMemo(
    () => latestComponentVersions(catalog ?? [...builtins, ...available]),
    [catalog, builtins, available],
  );
  const resolve = async (item: CatalogComponent) => {
    if ("kind" in item)
      return {
        kind: item.kind,
        data: structuredClone(item.defaultData),
        native: !!item.insertion || item.kind === "text",
      };
    const component =
      available.find(
        (value) =>
          value.id === item.id &&
          value.version === item.version &&
          value.integrity === item.integrity,
      ) ?? (library ? await library.read(item) : null);
    if (!component) throw new Error(t("notInstalledError"));
    return {
      kind: "custom",
      data: componentWidgetData(component),
      component,
      native: false,
    };
  };
  return {
    items,
    resolve,
    error,
    loading,
    // Hosted editors label built-ins in the workbench language.
    displayName: componentDisplayName,
    displayDescription: componentDisplayDescription,
  };
}
