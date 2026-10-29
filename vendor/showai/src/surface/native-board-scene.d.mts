import type {ShowDocument} from "../types";
import type {JSONContent} from "@tiptap/core";
export interface NativeBoardScenePatch {document:ShowDocument;nodes:JSONContent[]}
export function nativeBoardScenePatch(document:ShowDocument,boardId:string,previous?:ShowDocument|null):NativeBoardScenePatch;
export function resolveNativeBoardScene(patch:NativeBoardScenePatch,previous?:ShowDocument|null):ShowDocument;
