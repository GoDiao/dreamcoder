import { createContext } from "react";
import type { PageLinkBridge } from "./rich-text/environment";

export type { LinkablePage, PageLinkBridge } from "./rich-text/environment";
/** Provided by the workbench around a saved page; absent in readers and exports. */
export const PageLinkContext = createContext<PageLinkBridge | null>(null);
