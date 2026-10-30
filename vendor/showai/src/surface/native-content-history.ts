import type {ShowDocument} from "../types";
import {mergePageContent,canCommitPageMerge,type PageMergeResult} from "../core/page-merge-model";
import {nativeDocumentContentKey} from "./native-document-content";
import {InkEditConflict} from "./inline-ink";

export interface NativeContentHistoryAction {
  groupId:string;
  beforeDocument:ShowDocument;
  document:ShowDocument;
}

/** Native object edits can share a source receipt with foreign mutations.
 * Roll back only the accepted local edits against that latest source, retaining
 * foreign changes in every undo snapshot. No intermediate source is published. */
export function nativeContentHistoryStages(current:ShowDocument,baseline:ShowDocument,
  incoming:ShowDocument,actions:NativeContentHistoryAction[],prepared?:{
    baseline:ShowDocument;current:ShowDocument;incoming:ShowDocument;result:PageMergeResult;
  }) {
  const merged=prepared?.baseline===baseline&&prepared.current===current&&prepared.incoming===incoming
    ?prepared.result:mergePageContent(baseline,current,incoming);
  if(!canCommitPageMerge(merged))throw new InkEditConflict("Concurrent Board edits require resolution");
  let before=merged.document;
  const stages:{groupId:string;before:ShowDocument;document:ShowDocument}[]=[];
  for(const action of [...actions].reverse()){
    if(!action.groupId || action.groupId.length>200 || action.beforeDocument.id!==current.id || action.document.id!==current.id)
      throw new InkEditConflict("Native object history has an unrelated author baseline");
    const document=before;
    before=mergePageContent(action.document,before,action.beforeDocument,"history").document;
    stages.push({groupId:action.groupId,before,document});
  }
  const key=nativeDocumentContentKey;
  return {sourceOnly:before,stages:stages.reverse().filter(stage=>key(stage.before)!==key(stage.document))};
}
