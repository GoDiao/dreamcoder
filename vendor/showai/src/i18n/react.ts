import { useMemo, useSyncExternalStore } from "react";
import {
  getLanguagePreference,
  getLocale,
  subscribeLocale,
  translator,
  type LanguagePreference,
  type Locale,
  type Message,
  type Namespace,
  type Translator,
} from "./index";

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function useLanguagePreference(): LanguagePreference {
  return useSyncExternalStore(
    subscribeLocale,
    getLanguagePreference,
    getLanguagePreference,
  );
}

/** Translator for a namespace that re-renders the component when the language changes. */
export function useTranslator<T extends Record<string, Message>>(
  namespace: Namespace<T>,
): Translator<T> {
  const locale = useLocale();
  // A new function identity per locale lets memoized callers notice the change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => translator(namespace), [namespace, locale]);
}
