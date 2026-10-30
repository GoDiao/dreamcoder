import type {ShowDocument} from "../types";
import {mergePageContent,type PageMergeResult} from "../core/page-merge-model";
import {InkEditConflict} from "./inline-ink";

/** A storage timestamp acknowledges a write; it is not another editor mutation.
 * Every editable field and every causal candidate remains in this identity. */
export function nativeDocumentContentKey(document:ShowDocument):string {
  const source={...document};delete (source as Partial<ShowDocument>).updatedAt;
  return JSON.stringify(source,(_key,value)=>value && typeof value==="object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value);
}

/** Inspect the actual JSON body, including every causal head/variant. Object
 * identity is never proof of equality, and no cached token can hide an in-place
 * edit. Only the root storage acknowledgment timestamp is ignored. */
export function nativeDocumentBodiesEqual(one:ShowDocument,two:ShowDocument):boolean {
  const equal=(a:unknown,b:unknown,root=false):boolean=>{
    if(a===null||b===null)return a===b;
    if(typeof a!==typeof b)return false;
    if(typeof a!=="object")return (typeof a==="string"||typeof a==="boolean"||typeof a==="number")&&a===b;
    const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
    if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
    const keys=Object.keys(left).filter(key=>!root||key!=="updatedAt"),other=Object.keys(right).filter(key=>!root||key!=="updatedAt");
    return keys.length===other.length&&keys.every(key=>Object.hasOwn(right,key)&&equal(left[key],right[key]));
  };
  return equal(one,two,true);
}

/** A native receipt is already a canonical merge result for its issued source.
 * When the editor still has that entire source body, accepting it needs no
 * second stroke hashing/replay/clone pass on the Web main thread. Any real
 * editor difference retains the complete shared conflict-preserving merge. */
export function mergeNativeDocumentReceipt(baseline:ShowDocument,current:ShowDocument,incoming:ShowDocument):PageMergeResult {
  if(!baseline.id||baseline.id!==current.id||current.id!==incoming.id)
    throw new InkEditConflict("Native Board projection has no matching writer baseline");
  return nativeDocumentBodiesEqual(baseline,current)?{document:incoming,conflicts:[]}:mergePageContent(baseline,current,incoming);
}

export type NativeProjectionMerger=(incoming:ShowDocument,current:ShowDocument)=>Promise<PageMergeResult|null>;
/** Reconcile a legitimate native-issued receipt off the Web main thread. The
 * full current body is captured before await; both reference replacement and
 * mutation of that same object invalidate the result. No UI/history state is
 * published until the caller rechecks the returned observed basis. */
export async function mergeNativeProjectionReceipt(baseline:ShowDocument,incoming:ShowDocument,
  readCurrent:()=>ShowDocument,project:NativeProjectionMerger,isActive:()=>boolean=()=>true,
  copyMetadata?:(source:ShowDocument,snapshot:ShowDocument)=>void):
  Promise<{current:ShowDocument;basis:ShowDocument;result:PageMergeResult}|null> {
  if(!baseline.id||baseline.id!==incoming.id)throw new InkEditConflict("Native Board projection has no matching writer baseline");
  while(isActive()){
    const current=readCurrent();if(current.id!==baseline.id)return null;
    const basis=structuredClone(current);copyMetadata?.(current,basis);
    if(nativeDocumentBodiesEqual(baseline,basis))return {current,basis,result:{document:incoming,conflicts:[]}};
    let merged:PageMergeResult|null;
    try{merged=await project(incoming,basis)}
    catch(error){
      if(!isActive()||readCurrent().id!==baseline.id)return null;
      if(error&&typeof error==="object"&&"code" in error&&error.code==="CONFLICT")
        throw new InkEditConflict("message" in error&&typeof error.message==="string"?error.message:"Native Board receipt changed while reconciling edits");
      throw error;
    }
    if(!isActive())return null;
    const latest=readCurrent();if(latest.id!==baseline.id)return null;
    if(latest!==current||!nativeDocumentBodiesEqual(basis,latest))continue;
    return {current,basis,result:merged??mergeNativeDocumentReceipt(baseline,basis,incoming)};
  }
  return null;
}
