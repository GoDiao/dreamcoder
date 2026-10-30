import { createContext } from "react";
import type { AssistantRequest } from "./rich-text/environment";
import type { ComponentContextSnapshot } from "./custom/component-context.mjs";

export type { AssistantRequest };
export type AssistantAnchor = AssistantRequest["anchor"];
/** Text and blocks come from editors; board selections and the page from workbench menus. */
export type AssistantTarget = (
  | AssistantRequest
  | {
      kind: "board";
      blockIds: string[];
      surfaceId?: string;
      anchor: AssistantAnchor;
    }
  | { kind: "page"; anchor?: AssistantAnchor; prompt?: string }
) & { reference?: import("../surface/agent-reference").CanvasReference };
/** A component's onContext snapshot, located on the page it was handed from. */
export interface ComponentContextItem extends ComponentContextSnapshot {
  blockId: string;
  componentId?: string;
  name: string;
}
export interface AssistantBridge {
  open(target: AssistantTarget): void;
  /** Save, then copy a reference to the target for an Agent outside ShowAI. */
  reference(target: AssistantTarget): void;
  /** Put a component's exploration state into the conversation input. */
  componentContext(item: ComponentContextItem): void;
  /** The state still waiting in the input for this block, for that component only. */
  pendingComponentContext(
    blockId: string,
  ): ComponentContextSnapshot | undefined;
}
/** Provided by the workbench around the editable page; absent in readers and exports. */
export const AssistantContext = createContext<AssistantBridge | null>(null);
