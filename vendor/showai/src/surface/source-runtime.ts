import {freezeOwnedJSON,isOwnedJSON,ownedJSONMetrics,capturedContentSummary,captureOwnedJSON,parseOwnedJSON} from "../portable/owned-json.mjs";
import type {ShowDocument} from "../types";
import {assertContent,CapacityError,nonResourceReplacementDoesNotGrow} from "../portable/capacity.mjs";
import {reconcileSurface,artifactVersion} from "./document.mjs";
import {parseArtifact,parseArtifactForSourceSnapshot,parseArtifactConsumingForSourceSnapshot,shareSourceSnapshotDocument,inheritSourceSnapshotTimestampCapacity,assertOwnedSourceDocumentCapacity,isDocumentTimestamp} from "../portable/validation.mjs";
import {mergePageContent,canCommitPageMerge,type PageMergeConflict} from "../core/page-merge-model";
import {inkWireResolutionCandidates} from "./ink-wire.mjs";
import {nativeContentHistoryStages,type NativeContentHistoryAction} from "./native-content-history";
import {nativeDocumentBodiesEqual} from "./native-document-content";
import {appendPortableInkFromSource} from "./portable-ink-append.mjs";
import {applyCapturedSourceDelta,applyNativeSourceDelta,diffNativeSource,shareNativeSource,type NativeSourceEdit} from "./native-source-delta.mjs";

export interface SourceScope {homeId:string;projectId:string;pageId:string}
export interface SourceSnapshotRef {
  format:"showai-source-snapshot-v1";ownerId:string;epoch:string;snapshotId:string;
  scope:SourceScope;kind:"draft"|"normalized";
}
export interface SourceSnapshotDelta {
  format:"showai-owned-source-v1";base:SourceSnapshotRef|null;next:SourceSnapshotRef;
  full?:ShowDocument;edits?:NativeSourceEdit[];conflicts:PageMergeConflict[];
  inkCandidates:ReturnType<typeof inkWireResolutionCandidates>;
  publicationId?:string;nativeBodyUnchanged?:boolean;
  history?:{sourceOnly:SourceSnapshotDelta;stages:{groupId:string;delta:SourceSnapshotDelta}[]};
}
interface Lease {leaseId?:string}
export type SourceRuntimeRequest =
 | ({kind:"seed";scope:SourceScope;document:ShowDocument;proof?:"draft"|"normalized"}&Lease)
 | ({kind:"draft";base:SourceSnapshotRef;edits:NativeSourceEdit[];transactionId:string}&Lease)
 | ({kind:"normalize";ref:SourceSnapshotRef}&Lease)
 | ({kind:"publication";current:SourceSnapshotRef;publicationId:string;packet:{document:ShowDocument;baseDocument:ShowDocument;pageId?:string;[key:string]:unknown}}&Lease)
 | ({kind:"merge";base:SourceSnapshotRef;current:SourceSnapshotRef;incoming:SourceSnapshotRef;mode?:"history"}&Lease)
 | ({kind:"history";base:SourceSnapshotRef;current:SourceSnapshotRef;entries:SourceSnapshotRef[]}&Lease)
 | {kind:"historyAppendInk";source:SourceSnapshotRef;boardId:string;strokeId:string;entries:SourceSnapshotRef[];leaseId:string}
 | {kind:"delta";base:SourceSnapshotRef;next:SourceSnapshotRef}
 | {kind:"resolve";ref:SourceSnapshotRef}
 | {kind:"serialize";ref:SourceSnapshotRef}
 | {kind:"retain";leaseId:string;refs:SourceSnapshotRef[]}
 | {kind:"release";leaseId:string}
 | {kind:"dispose";scope:SourceScope};
export interface SourceHistoryResult {rebasedHistory:{delta:SourceSnapshotDelta;unchanged:boolean}[]}
export interface SourceInkHistoryResult {
 format:"showai-owned-ink-history-v1";source:SourceSnapshotRef;boardId:string;strokeId:string;
 entries:{base:SourceSnapshotRef;next:SourceSnapshotRef;unchanged:boolean}[];
}
export type SourceRuntimeResponse=SourceInkHistoryResult|SourceHistoryResult|SourceSnapshotDelta|{ref:SourceSnapshotRef;document:ShowDocument}|{ref:SourceSnapshotRef;json:string}|{retained:number};
export type SourceRuntimeObserver=(stage:string,durationMilliseconds:number)=>void;
function measured<T>(observer:SourceRuntimeObserver|undefined,stage:string,operation:()=>T):T{
 if(!observer)return operation();
 const now=()=>globalThis.performance?.now?.()??Date.now(),started=now();
 try{return operation()}finally{observer(stage,now()-started)}
}
export class SourceRuntimeError extends Error {constructor(readonly code:string,message:string){super(message)}}
const fail=(message:string):never=>{throw new SourceRuntimeError("SOURCE_OWNERSHIP_CONFLICT",message)};
const scopeKey=(scope:SourceScope)=>JSON.stringify([scope.homeId,scope.projectId,scope.pageId]);
function scope(value:SourceScope){if(!value||[value.homeId,value.projectId,value.pageId].some(part=>typeof part!=="string"||!part))fail("Source scope requires its actual home, project and page");return value}
export const sameSourceRef=(one:SourceSnapshotRef|null|undefined,two:SourceSnapshotRef|null|undefined)=>!!one&&!!two&&one.ownerId===two.ownerId&&one.epoch===two.epoch&&one.snapshotId===two.snapshotId&&one.kind===two.kind&&scopeKey(one.scope)===scopeKey(two.scope);
const canonicalCapacityBodies=new WeakSet<ShowDocument>();
// Only this owner's independent JSON captures/registered bodies may enter the
// COW consuming normalizer. The exported generic freeze helper is not a grant
// of input authority to an arbitrary object caller (including accessor graphs).
const normalizationReadableBodies=new WeakSet<ShowDocument>();
/** Same actual recursive ownership factory is used by private validation. */
export function freezeOwnedSource<T>(value:T):T{return freezeOwnedJSON(value)}
export const isOwnedSource=(value:unknown):boolean=>isOwnedJSON(value);
/** Independent boundary for an arbitrary external value. Exact JSON cloning
 * rejects undefined, holes, cycles and non-finite numbers instead of dropping. */
export function cloneSourceValue<T>(value:T):T{return applyNativeSourceDelta(null,[{op:"set",path:[],value}]) as T}
/** Read-only COW capture: existing owned branches may be reused; all outside
 * objects become independent before they can enter current/history/save. */
export function ownSourceValue<T>(value:T):T{
 const ancestors=new Set<object>();
 const capture=(value:unknown):unknown=>{
  if(isOwnedSource(value))return value;
  if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))return value;
  if(!value||typeof value!=="object")return fail("Mutable draft contains a non-JSON value");
  if(ancestors.has(value))fail("Mutable draft contains a cycle");ancestors.add(value);
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)fail("Mutable draft requires plain JSON objects");
  if(Array.isArray(value)&&Object.keys(value).length!==value.length)fail("Mutable draft array is sparse or decorated");
  const copy=Array.isArray(value)?[]:{};
  for(const key of Object.keys(value))Object.defineProperty(copy,key,{value:capture((value as Record<string,unknown>)[key]),enumerable:true,writable:true,configurable:true});
  ancestors.delete(value);return freezeOwnedSource(copy);
 };return capture(value) as T;
}
const equalOwned=(one:unknown,two:unknown):boolean=>{
 if(one===two&&(isOwnedSource(one)||one===null||typeof one!=="object"))return true;
 if(!one||!two||typeof one!=="object"||typeof two!=="object"||Array.isArray(one)!==Array.isArray(two))return false;
 if(Array.isArray(one)&&Array.isArray(two))return one.length===two.length&&one.every((value,index)=>equalOwned(value,two[index]));
 const keys=Object.keys(one);return keys.length===Object.keys(two).length&&keys.every(key=>Object.hasOwn(two,key)&&equalOwned((one as Record<string,unknown>)[key],(two as Record<string,unknown>)[key]));
};
// Only actual private JSON captures and this module's registered factory
// bodies can use identity below. Public shallow/generic freeze is not enough;
// mutable external callers keep their complete literal comparison boundary.
const readableJSON=(value:unknown):boolean=>!!value&&typeof value==="object"&&isOwnedSource(value)&&
 (normalizationReadableBodies.has(value as ShowDocument)||!!capturedContentSummary(value));
function privateJSONEqual(one:unknown,two:unknown):boolean{
 return readableJSON(one)&&readableJSON(two)?equalOwned(one,two):!diffNativeSource(one,two).length;
}
function privateDocumentBodiesEqual(one:ShowDocument,two:ShowDocument):boolean{
 if(!readableJSON(one)||!readableJSON(two))return nativeDocumentBodiesEqual(one,two);
 const keys=Object.keys(one).filter(key=>key!=="updatedAt"),other=Object.keys(two).filter(key=>key!=="updatedAt");
 return keys.length===other.length&&keys.every(key=>Object.hasOwn(two,key)&&equalOwned((one as unknown as Record<string,unknown>)[key],(two as unknown as Record<string,unknown>)[key]));
}
/** Unlike generic mutable-source diff, both inputs are actual owned snapshots.
 * Identity shortcuts are restricted to this module's recursively frozen data. */
export function diffOwnedSource(before:unknown,next:unknown):NativeSourceEdit[]{
 if(!isOwnedSource(before)||!isOwnedSource(next))throw new SourceRuntimeError("SOURCE_NOT_OWNED","Draft diff requires actual immutable owned graphs");
 const edits:NativeSourceEdit[]=[];
 const visit=(one:unknown,two:unknown,path:(string|number)[])=>{
  if(one===two&&(isOwnedSource(one)||one===null||typeof one!=="object"))return;
  if(!one||!two||typeof one!=="object"||typeof two!=="object"||Array.isArray(one)!==Array.isArray(two)){
   if(one!==two)edits.push({op:"set",path,value:cloneSourceValue(two)});return;
  }
  if(Array.isArray(one)&&Array.isArray(two)){
   if(one.length!==two.length){let prefix=0,suffix=0,limit=Math.min(one.length,two.length);
    while(prefix<limit&&equalOwned(one[prefix],two[prefix]))prefix++;
    while(suffix<limit-prefix&&equalOwned(one.at(-1-suffix),two.at(-1-suffix)))suffix++;
    if(suffix){edits.push({op:"splice",path,index:prefix,deleteCount:one.length-prefix-suffix,items:cloneSourceValue(two.slice(prefix,two.length-suffix))});return}
   }
   for(let index=0;index<two.length;index++)if(index<one.length)visit(one[index],two[index],[...path,index]);else edits.push({op:"set",path:[...path,index],value:cloneSourceValue(two[index])});
   if(two.length<one.length)edits.push({op:"resize",path,length:two.length});return;
  }
  const a=one as Record<string,unknown>,b=two as Record<string,unknown>;
  for(const key of Object.keys(a).sort())if(!Object.hasOwn(b,key))edits.push({op:"remove",path:[...path,key]});
  for(const key of Object.keys(b).sort())if(Object.hasOwn(a,key))visit(a[key],b[key],[...path,key]);else edits.push({op:"set",path:[...path,key],value:cloneSourceValue(b[key])});
 };visit(before,next,[]);return edits;
}
/** The owner stores the actual validated canonical result, including known
 * defaults. The validator preserves legal unknown root/comment fields; a proof
 * must describe exactly the document returned by ordinary artifact parsing. */
export function normalizeSourceDocument(document:ShowDocument):ShowDocument{
 const normalized=reconcileSurface(document);
 const canonical=parseArtifact({format:"showai",version:artifactVersion(normalized),document:normalized}).document;
 canonicalCapacityBodies.add(canonical);return canonical;
}
function normalizeOwnedSourceDocument(document:ShowDocument,observer?:SourceRuntimeObserver):ShowDocument{
 // Only the actual recursive owner may reuse readable child branches. Reconcile
 // writes an independent root/maps and path-copies structural repairs; the
 // consuming parser still runs every JSON, model, ink and capacity check.
 // Arbitrary caller objects retain the independent defensive capture below.
 if(normalizationReadableBodies.has(document)&&isOwnedSource(document))return normalizeParsedSourceDocument(document,observer);
 const normalized=reconcileSurface(document);
 const canonical=parseArtifactForSourceSnapshot({format:"showai",version:artifactVersion(normalized),document:normalized}).document;
 canonicalCapacityBodies.add(canonical);return canonical;
}
function normalizeParsedSourceDocument(document:ShowDocument,observer?:SourceRuntimeObserver):ShowDocument{
 // Retain the original result root for history's pre-normalization semantics.
 // This is either our exclusive JSON.parse graph or an actual recursively owned
 // readable graph. The independent mutable root/maps own every normalization
 // write; shared frozen leaves are read-only throughout complete validation.
 const normalized=measured(observer,"reconcile",()=>reconcileSurface({...document},{clone:false}));
 const canonical=parseArtifactConsumingForSourceSnapshot({format:"showai",version:artifactVersion(normalized),document:normalized},observer).document;
 canonicalCapacityBodies.add(canonical);return canonical;
}
/** The actual immutable base already satisfies all three official limits.
 * Replacing one existing non-resource scalar without increasing encoded or
 * structural bytes preserves that capacity proof, including shared resources. */
function timestampCapacityDoesNotGrow(before:ShowDocument,after:ShowDocument):boolean{
 if(!Object.hasOwn(before,"updatedAt")||!isDocumentTimestamp(before.updatedAt)||!isDocumentTimestamp(after.updatedAt))return false;
 return nonResourceReplacementDoesNotGrow(before.updatedAt,after.updatedAt);
}
function onlySharedTimestampChanged(before:ShowDocument,after:ShowDocument):boolean{
 const keys=Object.keys(before);
 return keys.length===Object.keys(after).length&&keys.every(key=>Object.hasOwn(after,key)&&(key==="updatedAt"||(before as unknown as Record<string,unknown>)[key]===(after as unknown as Record<string,unknown>)[key]));
}
/** A private factory record, never a public request/asserted normalized flag.
 * The input ref must still resolve to its actual complete immutable body. */
export interface NativePublicationOrigin {
 format:"showai-native-publication-origin-v1"|"showai-native-projection-origin-v1";publicationId:string;scope:SourceScope;
 boardId:string;token:string;sourceVersion:number;
}
type NativePublicationPacket={document:ShowDocument;baseDocument:ShowDocument;pageId?:string;[key:string]:unknown};
interface PublicationTransport {scope:SourceScope;boardId:string;token:string;sourceVersion:number}
interface PublicationEntry {packet:NativePublicationPacket;canonical?:ShowDocument;canonicalBase?:ShowDocument;transport?:PublicationTransport}
interface PublicationOriginRecord {identity:NativePublicationOrigin;packet?:NativePublicationPacket}
export interface NativeSourceEnvelope {
 format:"showai-native-source-v1";scope:{projectId:string;pageId:string;boardId:string;token:string};
 publicationId:string;basePublicationId:string|null;sourceVersion:number;
 full?:NativePublicationPacket;edits?:NativeSourceEdit[];
}
export interface NativeSourceEnvelopeRequest {current:SourceSnapshotRef;envelope:NativeSourceEnvelope;leaseId?:string}
export type NativeSourceEnvelopeResult=SourceSnapshotDelta|null|{requiresFull:true};
interface Snapshot {ref:SourceSnapshotRef;document:ShowDocument;candidates:SourceSnapshotDelta["inkCandidates"];conflicts:PageMergeConflict[];nativeOrigin?:PublicationOriginRecord}
/** Same synchronous service runs in Native JSC, a browser worker or Node.
 * No transport/client is allowed to construct a registered reference itself. */
export class SourceRuntimeOwner {
 readonly ownerId:string;readonly epoch:string;
 private nextId=0;
 private snapshots=new Map<string,Snapshot>();
 private validatedBodies=new WeakSet<ShowDocument>();
 private leases=new Map<string,Set<string>>();
 private transactions=new Map<string,{base:SourceSnapshotRef;edits:NativeSourceEdit[];next:SourceSnapshotRef;leaseId?:string}>();
 private publications=new Map<string,PublicationEntry>();
 private references=new Map<object,number>();
 private residentBytes=0;
 private account(value:object,direction:1|-1){
  const count=this.references.get(value)??0,next=count+direction;
  if(next<0)throw new Error("Source graph ownership count underflow");
  if(next)this.references.set(value,next);else this.references.delete(value);
  if(direction===1&&count||direction===-1&&next)return;
  const metric=ownedJSONMetrics(value);if(!metric)throw new Error("Source graph is not recursively owned");
  this.residentBytes+=direction*metric.bytes;
  for(const child of metric.children)this.account(child,direction);
 }
 private forget(id:string){const entry=this.snapshots.get(id);if(entry){this.snapshots.delete(id);this.account(entry.document,-1);if(entry.nativeOrigin)this.account(entry.nativeOrigin,-1)}}
 private forgetPublication(key:string){const entry=this.publications.get(key);if(entry){this.publications.delete(key);this.account(entry.packet,-1);if(entry.canonical)this.account(entry.canonical,-1);if(entry.canonicalBase)this.account(entry.canonicalBase,-1);if(entry.transport)this.account(entry.transport,-1)}}
 private prunePublications(){while(this.publications.size>8||this.publications.size&&this.residentBytes>this.limits.bytes)this.forgetPublication(this.publications.keys().next().value!)}
 constructor(options:{ownerId?:string;epoch?:string;maximumUnleased?:number;maximumPinned?:number;maximumResidentBytes?:number}={}){
  this.ownerId=options.ownerId??crypto.randomUUID();this.epoch=options.epoch??crypto.randomUUID();this.limits={unleased:options.maximumUnleased??64,pinned:options.maximumPinned??256,bytes:options.maximumResidentBytes??96*1024*1024};
 }
 private limits:{unleased:number;pinned:number;bytes:number};
 private get(ref:SourceSnapshotRef):Snapshot{
  if(!ref||ref.format!=="showai-source-snapshot-v1"||ref.ownerId!==this.ownerId||ref.epoch!==this.epoch)fail("Source owner or epoch differs");
  scope(ref.scope);const snapshot=this.snapshots.get(ref.snapshotId);
  if(!snapshot||!sameSourceRef(ref,snapshot.ref))fail("Source snapshot has expired or its scope/proof differs");
  return snapshot!;
 }
 private prune(protectedIds:ReadonlySet<string>=new Set()){
  const pinned=new Set([...this.leases.values()].flatMap(set=>[...set])),perScope=new Map<string,number>();
  for(const id of pinned){const entry=this.snapshots.get(id);if(entry){const key=scopeKey(entry.ref.scope);perScope.set(key,(perScope.get(key)??0)+1)}}
  if([...perScope.values()].some(count=>count>this.limits.pinned))fail("Live page source retention exceeds its explicit per-scope budget");
  const unleased=[...this.snapshots.keys()].filter(id=>!pinned.has(id)&&!protectedIds.has(id));
  let remaining=unleased.length;
  for(const id of unleased){if(remaining<=this.limits.unleased&&this.residentBytes<=this.limits.bytes)break;this.forget(id);remaining--}
  // Explicit pins always win over cache pressure. Callers can persist/retire an
  // inactive scope; no author/history state is silently evicted to hit bytes.
  for(const [key,transaction]of this.transactions){
   if(this.transactions.size<=512&&this.residentBytes<=this.limits.bytes)break;
   // An unanswered exact draft keeps its original transaction under its live
   // response lease. Completed replay cache cannot silently consume unlimited
   // point payload memory outside the same source residency budget.
   if(transaction.leaseId&&this.leases.has(transaction.leaseId))continue;
   this.transactions.delete(key);this.account(transaction.edits,-1);
  }
  this.prunePublications();
 }
 private retain(leaseId:string,refs:SourceSnapshotRef[]){
  if(!leaseId)fail("Source lease requires an identity");
  const ids=new Set(refs.map(ref=>this.get(ref).ref.snapshotId)),previous=this.leases.get(leaseId);
  this.leases.set(leaseId,ids);
  try{this.prune()}catch(error){if(previous)this.leases.set(leaseId,previous);else this.leases.delete(leaseId);throw error}
  return {retained:ids.size};
 }
 private register(targetScope:SourceScope,document:ShowDocument,kind:SourceSnapshotRef["kind"],base:Snapshot|null,leaseId?:string,conflicts:PageMergeConflict[]=[],preparedEdits?:NativeSourceEdit[],observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  scope(targetScope);if(document.id!==targetScope.pageId)fail("Source body belongs to another page");
  const shared=measured(observer,"register.share",()=>base&&!preparedEdits?shareSourceSnapshotDocument(base.document,document):document);
  const body=measured(observer,"register.freeze",()=>freezeOwnedSource(shared));
  normalizationReadableBodies.add(body);
  let timestampProof=false;
  const timestampOnly=!!base&&this.validatedBodies.has(base.document)&&isDocumentTimestamp(body.updatedAt)&&(preparedEdits?preparedEdits.every(edit=>edit.op==="set"&&edit.path.length===1&&edit.path[0]==="updatedAt"):onlySharedTimestampChanged(base.document,body));
  if(!this.validatedBodies.has(body)){
   if(canonicalCapacityBodies.has(document))this.validatedBodies.add(body);
   else if(timestampOnly){
    try{if(!timestampCapacityDoesNotGrow(base!.document,body)||!inheritSourceSnapshotTimestampCapacity(base!.document,body))assertOwnedSourceDocumentCapacity(body);this.validatedBodies.add(body);timestampProof=true}
    catch(error){
     // An invalid JSON draft stays recoverable but receives no capacity proof.
     // Trusted actual saves cannot claim success for an oversized stored body.
     if(kind==="normalized"||!(error instanceof CapacityError))throw error;
    }
   }else if(kind==="normalized"){
    // Backend model validation precedes actualSaved. Confirm final bytes too:
    // storage metadata may have changed after its earlier normalization.
    assertOwnedSourceDocumentCapacity(body);this.validatedBodies.add(body);
   }
  }else timestampProof=timestampOnly;
  const ref=freezeOwnedSource({format:"showai-source-snapshot-v1" as const,ownerId:this.ownerId,epoch:this.epoch,snapshotId:`snapshot-${++this.nextId}`,scope:{...targetScope},kind});
  const candidates=measured(observer,"register.candidates",()=>timestampProof&&base?base.candidates:kind==="normalized"?inkWireResolutionCandidates(body):[]);
  const nativeOrigin=base?.nativeOrigin&&this.validatedBodies.has(body)&&isDocumentTimestamp(body.updatedAt)&&
   (timestampProof||measured(observer,"register.nativeOrigin.compare",()=>privateDocumentBodiesEqual(base.document,body)))?base.nativeOrigin:undefined;
  this.snapshots.set(ref.snapshotId,{ref,document:body,candidates,conflicts,...(nativeOrigin?{nativeOrigin}:{})});measured(observer,"register.account",()=>{this.account(body,1);if(nativeOrigin)this.account(nativeOrigin,1)});
  try{measured(observer,"register.retain",()=>{if(leaseId)this.retain(leaseId,[ref]);else this.prune(new Set([ref.snapshotId]));});}
  catch(error){this.forget(ref.snapshotId);throw error}
  const edits=base?measured(observer,"register.diff",()=>preparedEdits??diffOwnedSource(base.document,body)):undefined;
  return {format:"showai-owned-source-v1",base:base?.ref??null,next:ref,...(base?{edits:edits!}:{full:body}),conflicts,inkCandidates:candidates};
 }
 private rememberPublication(current:Snapshot,publicationId:string,packet:NativePublicationPacket,parsedPacket?:()=>typeof packet):PublicationEntry{
  if(!publicationId||packet.document?.id!==current.ref.scope.pageId||packet.baseDocument?.id!==current.ref.scope.pageId||packet.pageId&&packet.pageId!==current.ref.scope.pageId)fail("Native publication has no matching actual source scope");
  const key=scopeKey(current.ref.scope)+"\u0000"+publicationId,known=this.publications.get(key);
  if(known&&!privateJSONEqual(known.packet,packet))fail("Native publication identity names a different complete packet");
  if(known)return known;
  // A live pinned origin outlives the eight-entry replay cache. It still binds
  // its immutable complete P even if another actual call reuses that identity.
  for(const snapshot of this.snapshots.values())if(snapshot.nativeOrigin?.identity.publicationId===publicationId&&scopeKey(snapshot.ref.scope)===scopeKey(current.ref.scope)){
   if(!snapshot.nativeOrigin.packet||!privateJSONEqual(snapshot.nativeOrigin.packet,packet))fail("Native publication identity names a different complete packet");
  }
  const previous=[...this.publications.values()].at(-1)?.packet,copy=parsedPacket?parsedPacket():captureOwnedJSON(packet),value=captureOwnedJSON(parsedPacket?copy:previous?shareNativeSource(previous,copy):copy);
  normalizationReadableBodies.add(value.document);normalizationReadableBodies.add(value.baseDocument);
  const entry={packet:value};this.publications.set(key,entry);this.account(value,1);this.prunePublications();return entry;
 }
 private prepareNativeOrigin(current:Snapshot,publicationId:string,entry:PublicationEntry,merged:ShowDocument,sourceVersion:number,observer?:SourceRuntimeObserver):{record:PublicationOriginRecord;canonical?:ShowDocument}{
  const packet=entry.packet;
  if(!Number.isSafeInteger(sourceVersion)||sourceVersion<0||typeof packet.boardId!=="string"||!packet.boardId||typeof packet.token!=="string"||!packet.token)fail("Actual Native publication requires its captured version/Board/token");
  const board=(node:ShowDocument["content"]):boolean=>node.type==="surface"&&node.attrs?.id===packet.boardId&&node.attrs?.kind==="board"||!!node.content?.some(board);
  if(!board(packet.document.content))fail("Actual Native publication Board is absent from its captured source");
  const identity:NativePublicationOrigin={format:"showai-native-publication-origin-v1",publicationId,scope:{...current.ref.scope},boardId:packet.boardId as string,token:packet.token as string,sourceVersion};
  for(const snapshot of this.snapshots.values())if(snapshot.nativeOrigin?.identity.publicationId===publicationId&&scopeKey(snapshot.ref.scope)===scopeKey(current.ref.scope)){
   if(diffNativeSource(snapshot.nativeOrigin.identity,identity).length)fail("Native publication identity names a different captured source version");
  }
  // The ordinary path will normalize exactly P, including its timestamp.
  // A real merged/canonical difference requires running
  // the SAME full factory on captured P, including capacity and causal fields.
  const equivalent=measured(observer,"origin.compare",()=>privateJSONEqual(packet.document,merged));
  let canonical:ShowDocument|undefined;
  if(!equivalent||!isDocumentTimestamp(packet.document.updatedAt)){
   canonical=entry.canonical??measured(observer,"origin.normalize",()=>freezeOwnedSource(normalizeOwnedSourceDocument(packet.document)));
   if(!entry.canonical){entry.canonical=canonical;if(this.publications.get(scopeKey(current.ref.scope)+"\u0000"+publicationId)===entry)this.account(canonical,1)}
  }
  return{record:freezeOwnedSource({identity,packet}),canonical};
 }
 private bindNativeOrigin(prepared:{record:PublicationOriginRecord;canonical?:ShowDocument},result:SourceSnapshotDelta,observer?:SourceRuntimeObserver){
  const actual=this.get(result.next),record=prepared.record;
  if(actual.nativeOrigin){this.account(actual.nativeOrigin,-1);delete actual.nativeOrigin}
  if(prepared.canonical&&!measured(observer,"origin.bodyCompare",()=>privateDocumentBodiesEqual(prepared.canonical!,actual.document)))return;
  actual.nativeOrigin=record;this.account(record,1);this.prune(new Set([result.next.snapshotId]));
 }
 /** Trusted host adapter only. An actual ref attached to another document is
  * rejected; no caller boolean, kind or claimed publication can mint proof.
  * This proves canonical captured-P semantics, never a persisted disk anchor;
  * the host must separately check its real save baseline/CAS. */
 nativePublicationDocumentMatching(request:{ref:SourceSnapshotRef;document:ShowDocument}):NativePublicationOrigin|null{
  const actual=this.get(request.ref);
  return actual.nativeOrigin&&this.validatedBodies.has(actual.document)&&privateJSONEqual(actual.document,request.document)?actual.nativeOrigin.identity:null;
 }
 private finishPublication(current:Snapshot,publicationId:string,packet:{document:ShowDocument;baseDocument:ShowDocument;[key:string]:unknown},merged:{document:ShowDocument;conflicts:PageMergeConflict[]},leaseId?:string,observer?:SourceRuntimeObserver,parsedDocument?:()=>ShowDocument,actualCanonicalResult?:ShowDocument):SourceSnapshotDelta{
  if(!canCommitPageMerge(merged))throw new SourceRuntimeError("SOURCE_MERGE_CONFLICT","Native publication requires explicit conflict resolution");
  const actions=packet.nativeContentActions as NativeContentHistoryAction[]|undefined;
  if(actions?.length&&!leaseId)fail("Native history publication requires an explicit response lease");
  const normalized=actualCanonicalResult??measured(observer,"normalize",()=>parsedDocument?normalizeParsedSourceDocument(parsedDocument()):normalizeOwnedSourceDocument(merged.document));
  const result=this.register(current.ref.scope,normalized,"normalized",current,leaseId,merged.conflicts,undefined,observer);
  measured(observer,"history",()=>{if(actions?.length){
   const plan=nativeContentHistoryStages(current.document,packet.baseDocument,packet.document,actions,{baseline:packet.baseDocument,current:current.document,incoming:packet.document,result:merged});
   const refs=[result.next];
   const sourceOnly=this.register(current.ref.scope,plan.sourceOnly,"draft",current,undefined);
   refs.push(sourceOnly.next);this.retain(leaseId!,refs);
   let previous=this.get(sourceOnly.next);const stages:{groupId:string;delta:SourceSnapshotDelta}[]=[];
   for(const stage of plan.stages){const next=this.register(current.ref.scope,stage.document,"draft",previous,undefined);refs.push(next.next);this.retain(leaseId!,refs);stages.push({groupId:stage.groupId,delta:next});previous=this.get(next.next)}
   // The caller retains returned history refs before releasing this explicit
   // response lease. No intermediate history document is normalized on UI.
   this.retain(leaseId!,refs);
   result.history={sourceOnly,stages};
  }});
  return{...result,publicationId,nativeBodyUnchanged:measured(observer,"bodyCompare",()=>privateDocumentBodiesEqual(packet.document,this.get(result.next).document))};
 }
 /** Only an actual backend author/adoption+merge route can call this adapter.
  * A public request never accepts a client-asserted merged result. */
 registerActualMergedPublication(request:{current:SourceSnapshotRef;publicationId:string;sourceVersion?:number;packet:NativePublicationPacket;result:{document:ShowDocument;conflicts:PageMergeConflict[]};leaseId?:string},observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  const current=this.get(request.current),entry=measured(observer,"rememberPublication",()=>this.rememberPublication(current,request.publicationId,request.packet));
  const origin=request.sourceVersion===undefined?undefined:this.prepareNativeOrigin(current,request.publicationId,entry,request.result.document,request.sourceVersion,observer);
  const result=this.finishPublication(current,request.publicationId,request.packet,request.result,request.leaseId,observer);
  if(origin)this.bindNativeOrigin(origin,result,observer);
  return result;
 }
 /** Only a live owner-held ref can supply a parse candidate. The raw request
  * still names and validates the exact same ref after parsing, before mutation. */
 private capturedJSON(raw:string,expected:SourceSnapshotRef|undefined,field:"current"|"base",envelope=false,observer?:SourceRuntimeObserver):unknown{
  const actual=expected?this.get(expected):undefined;
  const previous=[...this.publications.values()].at(-1)?.packet;
  const packet=actual?{...previous,document:actual.document,baseDocument:actual.document}:previous??null;
  const candidate=field==="base"?(actual?{document:actual.document}:undefined):envelope?{envelope:{full:packet}}:{packet,...(actual?{result:{document:actual.document}}:{})};
  const request=measured(observer,"parse",()=>parseOwnedJSON(raw,candidate)) as Record<string,unknown>;
  if(actual&&!sameSourceRef(request[field] as SourceSnapshotRef,actual.ref))fail("Captured JSON baseline differs from its separately retained actual ref");
  return request;
 }
 /** The only consuming entry creates its own independent object graph here.
  * General object callers cannot opt out of defensive capture or validation. */
 registerActualMergedJSON(raw:string,observer?:SourceRuntimeObserver,expectedRef?:SourceSnapshotRef):SourceSnapshotDelta{
  const request=this.capturedJSON(raw,expectedRef,"current",false,observer) as Parameters<SourceRuntimeOwner["registerActualMergedPublication"]>[0];
  const current=this.get(request.current);
  const entry=measured(observer,"rememberPublication",()=>this.rememberPublication(current,request.publicationId,request.packet,()=>request.packet));
  const origin=request.sourceVersion===undefined?undefined:this.prepareNativeOrigin(current,request.publicationId,entry,request.result.document,request.sourceVersion,observer);
  const result=this.finishPublication(current,request.publicationId,request.packet,request.result,request.leaseId,observer,()=>request.result.document);
  if(origin)this.bindNativeOrigin(origin,result,observer);
  return result;
 }
 /** Private actual-Native producer only. A canonical current UI baseline is
  * not a foreign edit of the raw captured writer baseline. Do not reconstruct
  * unchanged rich leaves through a three-way merge merely to add Native ink.
  * Native content/history actions deliberately keep their existing full route. */
 private unchangedNativePublication(current:Snapshot,request:{publicationId:string;sourceVersion:number;packet:NativePublicationPacket;leaseId?:string},entry:PublicationEntry,observer?:SourceRuntimeObserver):SourceSnapshotDelta|null{
  const packet=entry.packet;
  if(packet.nativeContentAction===true||(Array.isArray(packet.nativeContentActions)&&packet.nativeContentActions.length))return null;
  if(!isDocumentTimestamp(current.document.updatedAt))return null;
  let unchanged=false;
  const origin=current.nativeOrigin;
  if(origin?.packet&&this.validatedBodies.has(current.document)&&origin.identity.publicationId===request.publicationId&&scopeKey(origin.identity.scope)===scopeKey(current.ref.scope)){
   // Same actually proved P after a failed save/ACK; timestamp-only COW has
   // already retained its official model/capacity proof, not a caller token.
   unchanged=privateJSONEqual(origin.packet,packet);
  }
  if(!unchanged){
   let base:ShowDocument;
   if(this.validatedBodies.has(current.document)&&
      (privateJSONEqual(packet.baseDocument,current.document)||origin?.packet&&privateJSONEqual(origin.packet.document,packet.baseDocument)))base=current.document;
   else{
    base=entry.canonicalBase??measured(observer,"unchanged.normalizeBase",()=>freezeOwnedSource(normalizeOwnedSourceDocument(packet.baseDocument,observer && ((stage,time)=>observer("unchanged.base."+stage,time)))));
    if(!entry.canonicalBase){entry.canonicalBase=base;if(this.publications.get(scopeKey(current.ref.scope)+"\u0000"+request.publicationId)===entry)this.account(base,1)}
   }
   unchanged=measured(observer,"unchanged.compareBase",()=>privateDocumentBodiesEqual(base,current.document));
  }
  if(!unchanged)return null;
  // A raw/draft ref is not itself capacity proof. Equality above proves all
  // model fields except storage time; validate that actual scalar/body too.
  if(!this.validatedBodies.has(current.document))measured(observer,"unchanged.currentCapacity",()=>assertContent(current.document));
  const canonical=entry.canonical??measured(observer,"unchanged.normalizeIncoming",()=>freezeOwnedSource(normalizeOwnedSourceDocument(packet.document,observer && ((stage,time)=>observer("unchanged.incoming."+stage,time)))));
  if(!entry.canonical){entry.canonical=canonical;if(this.publications.get(scopeKey(current.ref.scope)+"\u0000"+request.publicationId)===entry)this.account(canonical,1)}
  const prepared=this.prepareNativeOrigin(current,request.publicationId,entry,canonical,request.sourceVersion,observer);
  // The only pre-normalized argument is the fresh private formal factory
  // object above; no public request or general object caller can provide it.
  const result=this.finishPublication(current,request.publicationId,packet,{document:canonical,conflicts:[]},request.leaseId,observer,undefined,canonical);
  this.bindNativeOrigin(prepared,result,observer);return result;
 }
 registerActualNativePublicationIfUnchanged(request:{current:SourceSnapshotRef;publicationId:string;sourceVersion:number;packet:NativePublicationPacket;leaseId?:string},observer?:SourceRuntimeObserver):SourceSnapshotDelta|null{
  const current=this.get(request.current),entry=measured(observer,"rememberPublication",()=>this.rememberPublication(current,request.publicationId,request.packet));
  return this.unchangedNativePublication(current,request,entry,observer);
 }
 registerActualNativeJSONIfUnchanged(raw:string,observer?:SourceRuntimeObserver,expectedRef?:SourceSnapshotRef):SourceSnapshotDelta|null{
  const request=this.capturedJSON(raw,expectedRef,"current",false,observer) as Parameters<SourceRuntimeOwner["registerActualNativePublicationIfUnchanged"]>[0];
  const current=this.get(request.current),entry=measured(observer,"rememberPublication",()=>this.rememberPublication(current,request.publicationId,request.packet,()=>request.packet));
  return this.unchangedNativePublication(current,request,entry,observer);
 }
 /** Actual host transport only. The complete previous packet is resolved from
  * this owner's retained capture, never asserted by a Web descriptor. Applying
  * exact transport edits preserves its untouched sealed branches. A missing
  * baseline requests the same captured full packet; it never guesses a source.
  * This adapter is deliberately absent from the public execute dispatcher. */
 registerActualNativeEnvelopeJSON(raw:string,observer?:SourceRuntimeObserver,expectedRef?:SourceSnapshotRef):NativeSourceEnvelopeResult{
  const request=this.capturedJSON(raw,expectedRef,"current",true,observer) as NativeSourceEnvelopeRequest;
  const current=this.get(request.current),envelope=request.envelope,s=envelope?.scope;
  const id=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=256;
  if(!envelope||envelope.format!=="showai-native-source-v1"||!s||s.projectId!==current.ref.scope.projectId||s.pageId!==current.ref.scope.pageId||!id(s.boardId)||!id(s.token)||!id(envelope.publicationId)||
   !Number.isSafeInteger(envelope.sourceVersion)||envelope.sourceVersion<0||envelope.basePublicationId!==null&&!id(envelope.basePublicationId))fail("Actual Native source envelope has a different captured scope or identity");
  const full=Object.hasOwn(envelope,"full"),edits=Object.hasOwn(envelope,"edits");
  if(full===edits||edits&&(!envelope.basePublicationId||!Array.isArray(envelope.edits))||Object.keys(envelope).some(key=>!["format","scope","publicationId","basePublicationId","sourceVersion",full?"full":"edits"].includes(key))||Object.keys(s).some(key=>!["projectId","pageId","boardId","token"].includes(key)))fail("Actual Native source envelope requires one complete packet or exact transport edits");
  let packet:NativePublicationPacket;
  if(full)packet=envelope.full!;
  else{
   const cached=this.publications.get(scopeKey(current.ref.scope)+"\u0000"+envelope.basePublicationId);
   let previous=cached?.transport?{packet:cached.packet,transport:cached.transport}:undefined;
   if(!previous)for(const snapshot of this.snapshots.values()){
    const origin=snapshot.nativeOrigin;
    if(origin?.packet&&origin.identity.publicationId===envelope.basePublicationId&&scopeKey(origin.identity.scope)===scopeKey(current.ref.scope)){
     previous={packet:origin.packet,transport:origin.identity};break;
    }
   }
   if(!previous)return{requiresFull:true};
   if(previous.transport.boardId!==s.boardId||previous.transport.token!==s.token||previous.transport.sourceVersion>envelope.sourceVersion)fail("Actual Native source envelope crosses its retained Board, token or version");
   packet=measured(observer,"envelope.apply",()=>applyCapturedSourceDelta(previous!.packet,envelope.edits!) as NativePublicationPacket);
  }
  if(!packet||packet.pageId!==s.pageId||packet.boardId!==s.boardId||packet.token!==s.token||packet.document?.id!==s.pageId||packet.baseDocument?.id!==s.pageId)fail("Actual Native source packet differs from its captured envelope");
  const entry=measured(observer,"rememberPublication",()=>this.rememberPublication(current,envelope.publicationId,packet,()=>packet));
  const transport=freezeOwnedSource({scope:{...current.ref.scope},boardId:s.boardId,token:s.token,sourceVersion:envelope.sourceVersion});
  if(entry.transport&&diffOwnedSource(entry.transport,transport).length)fail("Native publication identity names a different captured transport");
  if(!entry.transport){entry.transport=transport;if(this.publications.get(scopeKey(current.ref.scope)+"\u0000"+envelope.publicationId)===entry)this.account(transport,1)}
  return this.unchangedNativePublication(current,{publicationId:envelope.publicationId,sourceVersion:envelope.sourceVersion,packet:entry.packet,leaseId:request.leaseId},entry,observer);
 }
 /** Private host resolve only. Body and proofs come from the same actual get;
  * public resolve/client JSON never supplies or manufactures these proofs. */
 resolveActualSnapshot(ref:SourceSnapshotRef){
  const actual=this.get(ref),modelValidated=this.validatedBodies.has(actual.document);
  return {format:"showai-resolved-source-v1" as const,ref:actual.ref,document:actual.document,
   modelValidated,nativeOrigin:modelValidated?actual.nativeOrigin?.identity??null:null};
 }
 /** Trusted adapter only: a ref or kind flag alone never proves a different
  * Swift/JSON body. The exact comparator includes every root field, timestamp,
  * sample, tombstone and retained variant. No JSON serialization is involved. */
 normalizedDocumentMatching(request:{ref:SourceSnapshotRef;document:ShowDocument}):ShowDocument|null{
  const current=this.get(request.ref);
  return this.validatedBodies.has(current.document)&&privateJSONEqual(current.document,request.document)?current.document:null;
 }
 /** Actual host projections (undo/resolution) still undergo full canonical
  * normalization here. This adapter is not public client dispatch and does not
  * borrow saved/publication proofs for a different source body. */
 normalizeActualProjection(request:{base:SourceSnapshotRef;document:ShowDocument;leaseId?:string;origin?:NativePublicationOrigin}):SourceSnapshotDelta{
  // This endpoint is private to the host's actual compensation factory. It
  // always performs complete model/capacity normalization; public execute has
  // no origin assertion or projection request. Capture metadata before any
  // observer/caller can mutate it, then bind only to the actual output ref.
  const base=this.get(request.base),origin=request.origin===undefined?undefined:captureOwnedJSON(request.origin);
  if(origin){
   const id=(value:unknown)=>typeof value==="string"&&value.length>0&&value.length<=256;
   if(Object.keys(origin).some(key=>!["format","publicationId","scope","boardId","token","sourceVersion"].includes(key))||
    origin.format!=="showai-native-projection-origin-v1"||scopeKey(scope(origin.scope))!==scopeKey(base.ref.scope)||
    !id(origin.publicationId)||!id(origin.boardId)||!id(origin.token)||!Number.isSafeInteger(origin.sourceVersion)||origin.sourceVersion<0)
    fail("Actual host projection origin crosses its captured source scope or identity");
  }
  const document=normalizeOwnedSourceDocument(cloneSourceValue(request.document));
  if(origin)for(const actual of this.snapshots.values()){
   const known=actual.nativeOrigin;
   if(known?.identity.publicationId===origin.publicationId&&scopeKey(known.identity.scope)===scopeKey(base.ref.scope)&&
    (!privateJSONEqual(known.identity,origin)||!privateDocumentBodiesEqual(actual.document,document)))
    fail("Actual host projection identity names a different complete source body");
  }
  const result=this.register(base.ref.scope,document,"normalized",base,request.leaseId);
  if(origin)this.bindNativeOrigin({record:freezeOwnedSource({identity:origin})},result);
  return result;
 }
 /** Trusted host adapter only: actual backend normalization/CAS has already
  * completed. Never reachable through the client request discriminant. */
 registerActualSavedSnapshot(request:{scope:SourceScope;document:ShowDocument;base:SourceSnapshotRef;leaseId?:string},observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  const base=this.get(request.base);
  if(scopeKey(scope(request.scope))!==scopeKey(base.ref.scope))fail("Saved source crosses its actual home/project/page");
  const document=measured(observer,"saved.capture",()=>captureOwnedJSON(request.document));
  return this.register(base.ref.scope,document,"normalized",base,request.leaseId,[],undefined,observer);
 }
 /** Private actual Store receipt only. The host has compared the complete
  * committed record to its actual normalized witness; only this scalar may
  * differ. Resolve the real base again and run the SAME saved registration and
  * final capacity gate, never a caller-asserted validated/public request flag. */
 registerActualSavedMetadata(request:{scope:SourceScope;base:SourceSnapshotRef;updatedAt:string;leaseId?:string},observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  // Object adapters retain their defensive boundary too: read accessors once,
  // then validate/use the same sealed scalar. Raw JSON is already captured.
  request=captureOwnedJSON(request);
  if(Object.keys(request).some(key=>!["scope","base","updatedAt","leaseId"].includes(key)))fail("Saved metadata contains an unproved field");
  const base=this.get(request.base);
  if(scopeKey(scope(request.scope))!==scopeKey(base.ref.scope)||!this.validatedBodies.has(base.document))fail("Saved metadata has no matching actual normalized body");
  if(!Object.hasOwn(base.document,"updatedAt")||!isDocumentTimestamp(request.updatedAt))fail("Saved metadata requires its actual valid timestamp");
  const document=applyCapturedSourceDelta(base.document,[{op:"set",path:["updatedAt"],value:request.updatedAt}]) as ShowDocument;
  return this.registerActualSavedSnapshot({scope:base.ref.scope,base:base.ref,document,leaseId:request.leaseId},observer);
 }
 /** Actual saved backend JSON only; no public execute kind can assert saved
  * validation. Parse creates/owns data, expectedBase is separately live-resolved,
  * and final model capacity still gates the complete actual stored body. */
 registerActualSavedJSON(raw:string,expectedBase?:SourceSnapshotRef,observer?:SourceRuntimeObserver):SourceSnapshotDelta{
  const request=this.capturedJSON(raw,expectedBase,"base",false,observer) as Parameters<SourceRuntimeOwner["registerActualSavedSnapshot"]>[0];
  return this.registerActualSavedSnapshot(request,observer);
 }
 execute(request:SourceRuntimeRequest):SourceRuntimeResponse{
  switch(request.kind){
   case "seed":{
    const captured=!!capturedContentSummary(request.document),copy=captured?request.document:cloneSourceValue(request.document),proof=request.proof??"draft";
    if(captured)normalizationReadableBodies.add(copy);
    return this.register(request.scope,proof==="normalized"?normalizeOwnedSourceDocument(copy):copy,proof,null,request.leaseId);
   }
   case "draft":{
    const base=this.get(request.base);if(!request.transactionId)fail("Source draft requires an actual transaction identity");
    const key=scopeKey(base.ref.scope)+"\u0000"+request.transactionId,known=this.transactions.get(key);
    if(known){if(!sameSourceRef(known.base,base.ref)||diffNativeSource(known.edits,request.edits).length)fail("Source transaction identity names different edits");const next=this.get(known.next);return{format:"showai-owned-source-v1",base:base.ref,next:next.ref,edits:cloneSourceValue(known.edits),conflicts:[],inkCandidates:next.candidates};}
    const captured=!!capturedContentSummary(base.document)&&!!capturedContentSummary(request.edits);
    const edits=captured?request.edits:freezeOwnedSource(cloneSourceValue(request.edits));
    const target=captured?applyCapturedSourceDelta(base.document,edits):applyNativeSourceDelta(base.document,edits),result=this.register(base.ref.scope,target,"draft",base,request.leaseId,[],edits);
    if(request.leaseId)this.retain(request.leaseId,[base.ref,result.next]);
    this.transactions.set(key,{base:base.ref,edits,next:result.next,leaseId:request.leaseId});this.account(edits,1);this.prune(new Set([result.next.snapshotId]));return result;
   }
   case "normalize":{
    const current=this.get(request.ref);
    if(current.ref.kind==="normalized"){
     if(request.leaseId)this.retain(request.leaseId,[current.ref]);
     return{format:"showai-owned-source-v1",base:current.ref,next:current.ref,edits:[],conflicts:current.conflicts,inkCandidates:current.candidates};
    }
    return this.register(current.ref.scope,normalizeOwnedSourceDocument(current.document),"normalized",current,request.leaseId);
   }
   case "merge":{
    const base=this.get(request.base),current=this.get(request.current),incoming=this.get(request.incoming);
    if(scopeKey(base.ref.scope)!==scopeKey(current.ref.scope)||scopeKey(base.ref.scope)!==scopeKey(incoming.ref.scope))fail("Source merge crosses its home/project/page");
    const merged=mergePageContent(base.document,current.document,incoming.document,request.mode);
    if(!canCommitPageMerge(merged))throw new SourceRuntimeError("SOURCE_MERGE_CONFLICT","Source edits require explicit conflict resolution");
    return this.register(current.ref.scope,normalizeOwnedSourceDocument(merged.document),"normalized",current,request.leaseId,merged.conflicts);
   }
   case "publication":{
    const current=this.get(request.current),packet=request.packet;
    this.rememberPublication(current,request.publicationId,packet);
    const merged=privateDocumentBodiesEqual(packet.baseDocument,current.document)?{document:packet.document,conflicts:[]}:mergePageContent(packet.baseDocument,current.document,packet.document);
    return this.finishPublication(current,request.publicationId,packet,merged,request.leaseId);
   }
   case "historyAppendInk":{
    const source=this.get(request.source),entries=request.entries.map(ref=>this.get(ref));
    if(!request.leaseId)fail("Ink history requires an explicit output lease");
    if(entries.some(entry=>scopeKey(entry.ref.scope)!==scopeKey(source.ref.scope)))fail("Ink history crosses its actual home/project/page");
    // Validate the actual sealed source even for an empty history. A caller's
    // stroke ID or an existing target node never grants source authority.
    appendPortableInkFromSource(source.document,source.document,request.boardId,request.strokeId);
    const projected=new Map<Snapshot,ShowDocument>();
    for(const entry of entries)if(!projected.has(entry))projected.set(entry,appendPortableInkFromSource(entry.document,source.document,request.boardId,request.strokeId));
    const refs=[source.ref,...entries.map(entry=>entry.ref)];
    const pinned=new Set([...this.leases.values()].flatMap(ids=>[...ids]));
    for(const ref of refs)pinned.add(ref.snapshotId);
    const changed=[...projected].filter(([entry,body])=>body!==entry.document).length;
    const sameScopePins=[...pinned].filter(id=>{const value=this.snapshots.get(id);return value&&scopeKey(value.ref.scope)===scopeKey(source.ref.scope)}).length;
    if(sameScopePins+changed>this.limits.pinned)fail("Live page source retention exceeds its explicit per-scope budget");
    let temporary:string;
    do{temporary=`ink-history-internal-${crypto.randomUUID()}`}while(this.leases.has(temporary)||temporary===request.leaseId);
    const created:SourceSnapshotRef[]=[],results=new Map<Snapshot,SourceSnapshotRef>();
    this.retain(temporary,refs);
    try{
     for(const [entry,body]of projected){
      if(body===entry.document){results.set(entry,entry.ref);continue}
      // No full per-entry ink delta is materialized or returned. This exact
      // COW body remains a draft until the ordinary actual save validator.
      const next=this.register(source.ref.scope,body,"draft",null,undefined).next;
      created.push(next);results.set(entry,next);this.retain(temporary,[...refs,...created]);
     }
     this.retain(request.leaseId,[...refs,...created]);
     return{format:"showai-owned-ink-history-v1",source:source.ref,boardId:request.boardId,strokeId:request.strokeId,
      entries:entries.map(entry=>({base:entry.ref,next:results.get(entry)!,unchanged:projected.get(entry)===entry.document}))};
    }catch(error){for(const ref of created)this.forget(ref.snapshotId);throw error}
    finally{this.leases.delete(temporary);this.prune()}
   }
   case "history":{
    const base=this.get(request.base),current=this.get(request.current),entries=request.entries.map(ref=>this.get(ref));
    if(!request.leaseId)fail("History projection requires an explicit output lease");
    if([current,...entries].some(entry=>scopeKey(entry.ref.scope)!==scopeKey(base.ref.scope)))fail("Source history crosses its actual home/project/page");
    const refs:SourceSnapshotRef[]=[],history:SourceHistoryResult["rebasedHistory"]=[];
    for(const entry of entries){
     const merged=mergePageContent(base.document,current.document,entry.document,"history");
     const projected=this.register(base.ref.scope,merged.document,"draft",entry,undefined,merged.conflicts);
     refs.push(projected.next);this.retain(request.leaseId!,refs);
     history.push({delta:projected,unchanged:privateDocumentBodiesEqual(this.get(projected.next).document,current.document)});
    }
    return{rebasedHistory:history};
   }
   case "delta":{
    const base=this.get(request.base),next=this.get(request.next);
    if(scopeKey(base.ref.scope)!==scopeKey(next.ref.scope))fail("Source delta crosses its actual home/project/page");
    return{format:"showai-owned-source-v1",base:base.ref,next:next.ref,edits:diffOwnedSource(base.document,next.document),conflicts:next.conflicts,inkCandidates:next.candidates};
   }
   case "resolve":{const value=this.get(request.ref);return{ref:value.ref,document:value.document};}
   case "serialize":{const value=this.get(request.ref);return{ref:value.ref,json:JSON.stringify(value.document)};}
   case "retain":return this.retain(request.leaseId,request.refs);
   case "release":this.leases.delete(request.leaseId);this.prune();return{retained:0};
   case "dispose":{
    const key=scopeKey(scope(request.scope));for(const [id,value]of this.snapshots)if(scopeKey(value.ref.scope)===key){this.forget(id);for(const [leaseId,lease]of this.leases){lease.delete(id);if(!lease.size)this.leases.delete(leaseId)}}
    for(const key of this.transactions.keys())if(key.startsWith(scopeKey(request.scope)+"\u0000")){const value=this.transactions.get(key)!;this.transactions.delete(key);this.account(value.edits,-1);}
    for(const key of this.publications.keys())if(key.startsWith(scopeKey(request.scope)+"\u0000"))this.forgetPublication(key);
    return{retained:0};
   }
   default:return fail("Unknown source runtime request");
  }
 }
}
let service:SourceRuntimeOwner|undefined;
/** iOS validation-entry can re-export this directly; the registry is the same
 * real worker instance used by every resolve/save call, never a Web-side map. */
export function sourceRuntime(raw:string):string{service??=new SourceRuntimeOwner();return JSON.stringify(service.execute(parseOwnedJSON(raw) as SourceRuntimeRequest));}

/** Only a backend adapter may expose this in its private validation VM. Public
 * sourceRuntime requests have no saved/validated flag that bypasses validation. */
export function registerActualSavedSnapshot(raw:string,expectedBase?:SourceSnapshotRef,observer?:SourceRuntimeObserver):string{
 service??=new SourceRuntimeOwner();
 return JSON.stringify(service.registerActualSavedJSON(raw,expectedBase,observer));
}

export function registerActualMergedPublication(raw:string,observer?:SourceRuntimeObserver,expectedRef?:SourceSnapshotRef):string{
 service??=new SourceRuntimeOwner();
 return JSON.stringify(service.registerActualMergedJSON(raw,observer,expectedRef));
}

export function normalizeActualProjection(raw:string):string{
 service??=new SourceRuntimeOwner();
 return JSON.stringify(service.normalizeActualProjection(parseOwnedJSON(raw) as Parameters<SourceRuntimeOwner["normalizeActualProjection"]>[0]));
}

/** Private validation-entry adapter; deliberately absent from execute(). */
export function normalizedSourceDocumentMatching(request:{ref:SourceSnapshotRef;document:ShowDocument}):ShowDocument|null{
 service??=new SourceRuntimeOwner();return service.normalizedDocumentMatching(request);
}

/** Private actual-factory provenance lookup, deliberately absent from execute. */
export function nativePublicationDocumentMatching(request:{ref:SourceSnapshotRef;document:ShowDocument}):NativePublicationOrigin|null{
 service??=new SourceRuntimeOwner();return service.nativePublicationDocumentMatching(request);
}

/** Private captured-publication factory; never accepted by execute(). */
export function registerActualNativePublicationIfUnchanged(raw:string,observer?:SourceRuntimeObserver,expectedRef?:SourceSnapshotRef):string{
 service??=new SourceRuntimeOwner();return JSON.stringify(service.registerActualNativeJSONIfUnchanged(raw,observer,expectedRef));
}

/** Private actual-host envelope adapter; never a public source request kind. */
export function registerActualNativeEnvelope(raw:string,observer?:SourceRuntimeObserver,expectedRef?:SourceSnapshotRef):string{
 service??=new SourceRuntimeOwner();return JSON.stringify(service.registerActualNativeEnvelopeJSON(raw,observer,expectedRef));
}

/** Private native adapter; deliberately absent from the public dispatcher. */
export function resolveActualSourceSnapshot(ref:SourceSnapshotRef){
 service??=new SourceRuntimeOwner();return service.resolveActualSnapshot(ref);
}

/** Private actual saved-receipt adapter; absent from public execute(). */
export function registerActualSavedMetadata(raw:string,observer?:SourceRuntimeObserver):string{
 service??=new SourceRuntimeOwner();
 return JSON.stringify(service.registerActualSavedMetadata(measured(observer,"metadata.parse",()=>parseOwnedJSON(raw)) as Parameters<SourceRuntimeOwner["registerActualSavedMetadata"]>[0],observer));
}
