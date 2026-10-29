import { createContext } from "react";

/** Personal camera/scroll state belongs to a tab view, not to the shared page. */
export const EditorViewScope = createContext<string | null>(null);
