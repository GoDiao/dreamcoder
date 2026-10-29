import type {ShowDocument} from "../types";
import {SourceRuntimeOwner,SourceRuntimeError,diffOwnedSource,cloneSourceValue,ownSourceValue,freezeOwnedSource,isOwnedSource,sameSourceRef,type SourceRuntimeRequest,type SourceRuntimeResponse,type SourceScope,type SourceSnapshotRef,type SourceSnapshotDelta} from "./source-runtime";
import {appendPortableInkFromSource} from "./portable-ink-append.mjs";
import {applyNativeSourceDelta,type NativeSourceEdit} from "./native-source-delta.mjs";
import {nativeDocumentBodiesEqual} from "./native-document-content";
import {measureNativeSync} from "./native-perf";

export interface SourceRuntimeTransport {
 readonly sourceClientId?:string;
 acknowledge?(deliveryId:string,ref:SourceSnapshotRef):Promise<void>;
 scope(projectId:string,pageId:string):Promise<SourceScope>;
 request(request:SourceRuntimeRequest):Promise<SourceRuntimeResponse>;
 publication?(args:{projectId:string;pageId:string;currentRef:SourceSnapshotRef;publicationScope:unknown;pubId:string;leaseId:string;authorDocument:ShowDocument}):Promise<SourceSnapshotDelta>;
 close?():void|Promise<void>;
}
export {diffOwnedSource} from "./source-runtime";
interface Binding {session:OwnedSourceSession;reference:Promise<SourceSnapshotRef>;remoteRef?:SourceSnapshotRef}
interface Registration {document:ShowDocument;before?:ShowDocument;edits:NativeSourceEdit[]|null;transactionId:string;lease:string;resolve:(ref:SourceSnapshotRef)=>void;promise:Promise<SourceSnapshotRef>;targetLease?:string;externalGeneration?:number;existing?:Binding;result?:SourceSnapshotDelta}
const bindings=new WeakMap<ShowDocument,Binding>();
const candidates=new WeakMap<ShowDocument,SourceSnapshotDelta["inkCandidates"]>();
export const sourceCandidatesFor=(document:ShowDocument)=>candidates.get(document);
export interface PreparedSourcePublication {sourceSnapshot:SourceSnapshotDelta;document:ShowDocument}
export async function prepareSourcePublication(document:ShowDocument,request:{publicationScope:unknown;pubId:string}):Promise<PreparedSourcePublication|null>{
 const binding=bindings.get(document);return binding&&!binding.session.disposed&&isOwnedSource(document)?await binding.session.preparePublication(request):null;
}
export async function sourceSnapshotFor(document:ShowDocument):Promise<{ref:SourceSnapshotRef;sourceClientId:string}|null>{
 while(true){
  const binding=bindings.get(document);if(!binding||binding.session.disposed||!isOwnedSource(document))return null;
  const ref=await binding.session.reference(document);
  if(binding.session.disposed)return null;
  if(bindings.get(document)!==binding)continue;
  return{ref,sourceClientId:binding.session.clientId};
 }
}
export async function completeSourcePublication(document:ShowDocument,pubId:string){await bindings.get(document)?.session.completePublication(pubId)}
export const sourceSessionFor=(document:ShowDocument)=>bindings.get(document)?.session;
let registeredBridge:unknown;
function installResolver(){
 if(typeof window==="undefined")return;
 const bridge=window.showai?.inlineInk;
 if(bridge?.registerSourceModel&&registeredBridge!==bridge){bridge.registerSourceModel({snapshotFor:sourceSnapshotFor,preparePublication:prepareSourcePublication,completePublication:completeSourcePublication});registeredBridge=bridge;}
}
const expectDelta=(response:SourceRuntimeResponse):SourceSnapshotDelta=>{
 if(!("format" in response)||response.format!=="showai-owned-source-v1")throw new SourceRuntimeError("SOURCE_PROTOCOL","Source worker did not return an owned snapshot delta");return response;
};
const key=(ref:SourceSnapshotRef)=>JSON.stringify([ref.ownerId,ref.epoch,ref.snapshotId,ref.scope.homeId,ref.scope.projectId,ref.scope.pageId,ref.kind]);

/** One page's UI projection. Local authoring freezes a distinct COW draft now;
 * only its small edits enter the worker queue. No display waits for normalize.
 * This is separate from the worker's immutable body/normalization proof. */
export class OwnedSourceSession {
 readonly clientId:string;
 readonly leaseId:string;
 private views=new Map<string,WeakRef<ShowDocument>>();
 private tail:Promise<void>=Promise.resolve();
 private jobs:Registration[]=[];
 private running=false;
 private latestRef:Promise<SourceSnapshotRef>|undefined;
 private latestDocument:ShowDocument|undefined;
 private generation=0;
 private failure:unknown;
 private failureSignal:Promise<unknown>;
 private signalFailure!:(reason:unknown)=>void;
 private historyGeneration=new Map<string,number>();
 private externalGeneration=new Map<string,number>();
 private proofs=new WeakMap<ShowDocument,Set<string>>();
 private issuedDeltas=new WeakSet<SourceSnapshotDelta>();
 // A prepared publication already owns an independent frozen UI projection.
 // Reuse only that actual issued delta on the EXACT same captured UI root.
 // Worker-private graphs never enter this cache; no ref/ID grants it authority.
 private materializedDeltas=new WeakMap<SourceSnapshotDelta,{base:ShowDocument|undefined;document:ShowDocument}>();
 private pendingPins=new Map<string,Promise<SourceSnapshotRef>>();
 private publicationOutputs=new Map<string,SourceSnapshotRef>();
 private historyLeases=new Set<string>();
 private pendingLeases=new Set<string>();
 private scopePromise:Promise<SourceScope>;
 private actualScope:SourceScope|undefined;
 private publicationRequests=new Map<string,{publicationScope:unknown;pubId:string}>();
 disposed=false;
 constructor(readonly projectId:string,readonly pageId:string,readonly transport:SourceRuntimeTransport){this.clientId=transport.sourceClientId??crypto.randomUUID();this.leaseId=`${this.clientId}:current`;this.failureSignal=new Promise(resolve=>{this.signalFailure=resolve});this.scopePromise=transport.scope(projectId,pageId).then(scope=>{this.actualScope=ownSourceValue(scope);return this.actualScope});installResolver()}
 get document(){return this.latestDocument}
 get version(){return this.generation}
 get error(){return this.failure}
 private remember(document:ShowDocument,reference:Promise<SourceSnapshotRef>){
  bindings.set(document,{session:this,reference});
  void reference.then(ref=>{let known=this.proofs.get(document);if(!known)this.proofs.set(document,known=new Set());known.add(key(ref));const binding=bindings.get(document);if(binding?.session===this&&binding.reference===reference)binding.remoteRef=ref;this.views.set(key(ref),new WeakRef(document));while(this.views.size>512)this.views.delete(this.views.keys().next().value!);},()=>{});
 }
 private checkedScope(ref:SourceSnapshotRef,scope:SourceScope){if(ref.scope.homeId!==scope.homeId||ref.scope.projectId!==this.projectId||ref.scope.pageId!==this.pageId)throw new SourceRuntimeError("SOURCE_SCOPE","Source response belongs to another actual home/project/page")}
 private issue(delta:SourceSnapshotDelta):SourceSnapshotDelta{
  freezeOwnedSource(delta);this.issuedDeltas.add(delta);if(delta.history){this.issue(delta.history.sourceOnly);for(const stage of delta.history.stages)this.issue(stage.delta)}return delta;
 }
 private async retainOutput(snapshot:SourceSnapshotDelta,leaseId:string){
  await this.transport.request({kind:"retain",leaseId,refs:[snapshot.next]});
  const delivery=(snapshot as SourceSnapshotDelta&{sourceSnapshotDeliveryId?:string}).sourceSnapshotDeliveryId;
  if(delivery)await this.transport.acknowledge?.(delivery,snapshot.next);
 }
 private async actualDelta(snapshot:SourceSnapshotDelta,leaseName:string):Promise<SourceSnapshotDelta>{
  if(!snapshot.base)throw new SourceRuntimeError("SOURCE_PROTOCOL","Host output requires its captured actual baseline");
  const actual=this.issue(expectDelta(await this.transport.request({kind:"delta",base:snapshot.base,next:snapshot.next})));
  const leaseId=`${this.clientId}:${leaseName}`;await this.retainOutput(actual,leaseId);this.historyLeases.add(leaseId);return actual;
 }
 private publish(document:ShowDocument,ref:SourceSnapshotRef){
  this.latestDocument=document;this.latestRef=Promise.resolve(ref);this.generation++;
  const transactionId=crypto.randomUUID(),lease=`${this.clientId}:pin-${transactionId}`;let resolve!:(ref:SourceSnapshotRef)=>void;const promise=new Promise<SourceSnapshotRef>(done=>{resolve=done});
  this.pendingLeases.add(lease);this.pendingPins.set(key(ref),promise);void promise.then(()=>{if(this.pendingPins.get(key(ref))===promise)this.pendingPins.delete(key(ref))});
  this.jobs.push({document,edits:null,transactionId,lease,resolve,promise,targetLease:this.leaseId,existing:{session:this,reference:Promise.resolve(ref),remoteRef:ref}});this.drain();
 }
 /** Only an actual factory body may be installed after its corresponding
  * save barrier; captured N cannot replace a newer immediate UI draft N+1. */
 publishKnown(document:ShowDocument,captured:ShowDocument):ShowDocument|null{
  if(this.latestDocument!==captured)return null;
  const binding=bindings.get(document);if(binding?.session!==this||!binding.remoteRef||!this.proofs.get(document)?.has(key(binding.remoteRef)))throw new SourceRuntimeError("SOURCE_NOT_OWNED","Saved body lacks an actual resolved factory proof");
  this.publish(document,binding.remoteRef);return document;
 }
 /** Call only with a real author value; this captures caller-owned fragments
  * before onChange can return to a widget or retain another mutable reference. */
 replace(document:ShowDocument):ShowDocument{
  if(this.disposed)throw new SourceRuntimeError("SOURCE_DISPOSED","Source page is retired");
  if(document.id!==this.pageId)throw new SourceRuntimeError("SOURCE_SCOPE","Author document belongs to another page");
  const other=bindings.get(document),target=ownSourceValue(other&&other.session!==this?{...document}:document),before=this.latestDocument;
  if(target===before)return target;
  const edits=before?diffOwnedSource(before,target):null;
  if(before&&edits&&!edits.length)return before;
  const transactionId=crypto.randomUUID(),lease=`${this.clientId}:pending-${transactionId}`;
  let resolve!:(ref:SourceSnapshotRef)=>void;const promise=new Promise<SourceSnapshotRef>(done=>{resolve=done});
  this.pendingLeases.add(lease);this.latestDocument=target;this.generation++;
  if(before&&edits?.every(edit=>edit.path.length===1&&edit.path[0]==="updatedAt")){const inherited=candidates.get(before);if(inherited)candidates.set(target,inherited)}
  this.jobs.push({document:target,before,edits,transactionId,lease,resolve,promise});
  this.latestRef=promise;this.remember(target,promise);this.drain();return target;
 }
 private drain(){
  if(this.running||this.failure||this.disposed)return;
  this.running=true;
  this.tail=(async()=>{
   while(this.jobs.length&&!this.disposed){
    const job=this.jobs[0],actualScope=await this.scopePromise;
    const base=job.before?bindings.get(job.before)?.remoteRef:undefined;
    if(job.before&&!base)throw new SourceRuntimeError("SOURCE_QUEUE","An earlier exact draft registration is unavailable");
    const existing=job.existing?.remoteRef??(job.existing?await job.existing.reference:undefined);
    const result=job.result??(existing?{format:"showai-owned-source-v1" as const,base:null,next:existing,full:job.document,conflicts:[],inkCandidates:[]}:expectDelta(await this.transport.request(base?{kind:"draft",base,edits:job.edits!,transactionId:job.transactionId,leaseId:job.lease}:{kind:"seed",scope:actualScope,document:cloneSourceValue(job.document),proof:"draft",leaseId:job.lease})));job.result=result;
    this.checkedScope(result.next,actualScope);
    await this.transport.request({kind:"retain",leaseId:job.lease,refs:[result.next]});
    const targetLease=job.targetLease??this.leaseId;
    if(!job.targetLease||job.externalGeneration===this.externalGeneration.get(job.targetLease)){
     await this.transport.request({kind:"retain",leaseId:targetLease,refs:[result.next]});if(job.targetLease)this.historyLeases.add(targetLease);
    }
    const delivery=(result as SourceSnapshotDelta&{sourceSnapshotDeliveryId?:string}).sourceSnapshotDeliveryId;
    if(delivery)await this.transport.acknowledge?.(delivery,result.next);
    await this.transport.request({kind:"release",leaseId:job.lease});this.pendingLeases.delete(job.lease);
    const binding=bindings.get(job.document);if(binding?.session===this&&binding.reference===job.promise)binding.remoteRef=result.next;
    this.views.set(key(result.next),new WeakRef(job.document));job.resolve(result.next);this.jobs.shift();
   }
  })().catch(error=>{this.failure=error;this.signalFailure(error)}).finally(()=>{this.running=false;if(this.jobs.length&&!this.failure)this.drain()});
 }
 /** Retry the same original transaction/base/edits after a lost reply or failed
  * registration. Later drafts stay queued; none are cleared or reseeded away. */
 async retryRegistration(){
  await this.tail;this.failure=undefined;this.failureSignal=new Promise(resolve=>{this.signalFailure=resolve});
  if(!this.actualScope)this.scopePromise=this.transport.scope(this.projectId,this.pageId).then(scope=>{this.actualScope=ownSourceValue(scope);return this.actualScope});
  this.drain();await this.barrier();
 }
 /** A server record/base is owned independently without becoming current.
  * Stable named leases replace old remote baselines rather than accumulating
  * one permanent temporary lease for every refresh/ack. */
 captureExternal(document:ShowDocument,leaseName:string):ShowDocument{
  if(this.disposed)throw new SourceRuntimeError("SOURCE_DISPOSED","Source page is retired");
  if(document.id!==this.pageId)throw new SourceRuntimeError("SOURCE_SCOPE","External source belongs to another page");
  const binding=bindings.get(document),owned=ownSourceValue(isOwnedSource(document)?{...document}:document);
  const targetLease=`${this.clientId}:${leaseName}`,externalGeneration=(this.externalGeneration.get(targetLease)??0)+1;this.externalGeneration.set(targetLease,externalGeneration);
  const transactionId=crypto.randomUUID(),lease=`${this.clientId}:external-${transactionId}`;
  let resolve!:(ref:SourceSnapshotRef)=>void;const promise=new Promise<SourceSnapshotRef>(done=>{resolve=done});
  this.pendingLeases.add(lease);this.jobs.push({document:owned,edits:null,transactionId,lease,resolve,promise,targetLease,externalGeneration,...(binding?.session===this?{existing:binding}:{})});
  this.remember(owned,promise);this.drain();return owned;
 }
 private async waitRegistration(reference:Promise<SourceSnapshotRef>):Promise<SourceSnapshotRef>{
  if(this.failure)throw this.failure;
  const outcome=await Promise.race([reference.then(ref=>({ref})),this.failureSignal.then(error=>({error}))]);
  if("error" in outcome)throw outcome.error;return outcome.ref;
 }
 async reference(document:ShowDocument=this.latestDocument!):Promise<SourceSnapshotRef>{
  const binding=bindings.get(document);
  if(binding?.session===this){
   if(binding.remoteRef)return binding.remoteRef;
   return await this.waitRegistration(binding.reference);
  }
  throw new SourceRuntimeError("SOURCE_NOT_OWNED","Use captureExternal for an independently owned record/base rather than implicitly registering an unbound value");
 }

 async barrier(){do{const active=this.tail;await active;if(this.failure)throw this.failure;if(active===this.tail&&!this.running&&!this.jobs.length)break;}while(true);return this.latestRef?await this.latestRef:null}
 /** Apply only against the actual frozen UI graph for the issued base. Older
  * normalized/save results never overwrite a newer local draft projection. */
 apply(delta:SourceSnapshotDelta,options:{publish?:boolean;baseDocument?:ShowDocument}={}):ShowDocument|null{
  return measureNativeSync("source.ui.apply",()=>this.applyOwnedDelta(delta,options));
 }
 private applyOwnedDelta(delta:SourceSnapshotDelta,{publish=true,baseDocument}:{publish?:boolean;baseDocument?:ShowDocument}={}):ShowDocument|null{
  if(this.disposed)throw new SourceRuntimeError("SOURCE_DISPOSED","Source page is retired");
  if(!this.issuedDeltas.has(delta))throw new SourceRuntimeError("SOURCE_NOT_OWNED","Source delta was not received from this session's actual owner transport");
  if(delta.format!=="showai-owned-source-v1"||delta.next.scope.homeId!==this.actualScope?.homeId||delta.next.scope.projectId!==this.projectId||delta.next.scope.pageId!==this.pageId||delta.base&&(delta.next.ownerId!==delta.base.ownerId||delta.next.epoch!==delta.base.epoch))throw new SourceRuntimeError("SOURCE_SCOPE","Owned delta belongs to another page");
  const hasBase=(document:ShowDocument|undefined)=>!!document&&!!delta.base&&this.proofs.get(document)?.has(key(delta.base));
  const knownBase=delta.base?(baseDocument&&hasBase(baseDocument)?baseDocument:hasBase(this.latestDocument)?this.latestDocument:this.views.get(key(delta.base))?.deref()):undefined;
  if(baseDocument&&!hasBase(baseDocument))throw new SourceRuntimeError("SOURCE_NOT_OWNED","Supplied baseline is not the exact registered UI graph");
  const before=knownBase;
  if(delta.base&&!before)return null;
  if(publish&&(delta.base?this.latestDocument!==before:!!this.latestDocument))return null;
  if(delta.base&&baseDocument){const registered=bindings.get(baseDocument);if(!registered||registered.session!==this)throw new SourceRuntimeError("SOURCE_NOT_OWNED","Delta baseline is not an owned UI snapshot")}
  const materialized=this.materializedDeltas.get(delta);
  if(materialized&&materialized.base===before&&bindings.get(materialized.document)?.session===this&&this.proofs.get(materialized.document)?.has(key(delta.next))){
   // Keep metadata attached to this prepared target by the actual Native
   // bridge. Re-copying the old base here could overwrite the newer receipt.
   return measureNativeSync("source.ui.applyPrepared",()=>{if(publish)this.publish(materialized.document,delta.next);return materialized.document;});
  }
  const target=measureNativeSync("source.ui.materialize",()=>freezeOwnedSource(delta.base?applyNativeSourceDelta(before!,delta.edits??[]):cloneSourceValue(delta.full!)));
  let known=this.proofs.get(target);if(!known)this.proofs.set(target,known=new Set());known.add(key(delta.next));
  this.remember(target,Promise.resolve(delta.next));
  if(before&&typeof window!=="undefined")window.showai?.inlineInk?.copyDocumentMetadata?.(before,target);
  if(delta.next.kind==="normalized")candidates.set(target,ownSourceValue(delta.inkCandidates));
  this.materializedDeltas.set(delta,{base:before,document:target});
  if(publish)this.publish(target,delta.next);
  return target;
 }
 /** Distinct semantic edges may share one exact source body/ref without
  * registering a fake draft operation or aliasing a mutable graph. */
 snapshot(document:ShowDocument):ShowDocument{
  const binding=bindings.get(document);if(binding?.session!==this)throw new SourceRuntimeError("SOURCE_NOT_OWNED","History body is not owned by this source session");
  const distinct=ownSourceValue({...document});this.remember(distinct,binding.reference);return distinct;
 }
 private async abandonOutputLease(leaseId:string){
  try{await this.transport.request({kind:"release",leaseId});this.pendingLeases.delete(leaseId);this.historyLeases.delete(leaseId)}
  catch(error){console.error("Source output retirement failed",error)}
 }
 async merge(base:ShowDocument,current:ShowDocument,incoming:ShowDocument,mode?:"history"){
  const refs=await Promise.all([this.reference(base),this.reference(current),this.reference(incoming)]),leaseId=`${this.clientId}:merge-${crypto.randomUUID()}`;
  this.pendingLeases.add(leaseId);
  try{
  const delta=this.issue(expectDelta(await this.transport.request({kind:"merge",base:refs[0],current:refs[1],incoming:refs[2],mode,leaseId})));
  await this.retainOutput(delta,leaseId);
  const document=this.apply(delta,{publish:false,baseDocument:current});if(!document)throw new SourceRuntimeError("SOURCE_BASELINE","Merged source lost its captured independent baseline");
  return{document,delta,release:async()=>{const pin=this.pendingPins.get(key(delta.next));if(pin)await this.waitRegistration(pin);await this.transport.request({kind:"release",leaseId});this.pendingLeases.delete(leaseId)}};
  }catch(error){await this.abandonOutputLease(leaseId);throw error}
 }
 async rebaseHistory(before:ShowDocument,incoming:ShowDocument,entries:ShowDocument[],name:string){
  const leaseId=`${this.clientId}:${name}`,base=await this.reference(before),current=await this.reference(incoming),refs=[];
  for(const entry of entries)refs.push(await this.reference(entry));
  try{
  const response=await this.transport.request({kind:"history",base,current,entries:refs,leaseId});
  if(!("rebasedHistory" in response))throw new SourceRuntimeError("SOURCE_PROTOCOL","Source worker did not return history projections");
  this.historyLeases.add(leaseId);
  return response.rebasedHistory.map(({delta,unchanged},index)=>{
   this.issue(delta);
   const document=this.apply(delta,{publish:false,baseDocument:entries[index]});if(!document)throw new SourceRuntimeError("SOURCE_BASELINE","History projection lost its captured baseline");return{before:entries[index],document,unchanged};
  });
  }catch(error){await this.abandonOutputLease(leaseId);throw error}
 }
 /** Project one actually sealed stroke into captured later history edges.
  * The worker sends only owner refs; the UI uses the same COW operation and
  * binds its result only to this call's checked actual transport response. */
 async appendInkHistory(sourceDocument:ShowDocument,boardId:string,strokeId:string,documents:ShowDocument[],leaseName:string):Promise<{documents:ShowDocument[];release:()=>Promise<void>}>{
  if(this.disposed)throw new SourceRuntimeError("SOURCE_DISPOSED","Source page is retired");
  const source=await this.reference(sourceDocument),refs:SourceSnapshotRef[]=[];
  for(const document of documents)refs.push(await this.reference(document));
  const leaseId=`${this.clientId}:${leaseName}:ink-${crypto.randomUUID()}`;
  this.pendingLeases.add(leaseId);
  try{
   const response=await this.transport.request({kind:"historyAppendInk",source,boardId,strokeId,entries:refs,leaseId});
   if(this.disposed)throw new SourceRuntimeError("SOURCE_DISPOSED","Source page was retired during ink history projection");
   const actualScope=await this.scopePromise;
   if(!("format" in response)||response.format!=="showai-owned-ink-history-v1"||!sameSourceRef(response.source,source)||response.boardId!==boardId||response.strokeId!==strokeId||response.entries.length!==documents.length)
    throw new SourceRuntimeError("SOURCE_PROTOCOL","Source worker did not return this captured ink history");
   // Validate the entire descriptor before issuing any UI proof. No public
   // adoption method accepts a caller-authored descriptor or copied owner ID.
   response.entries.forEach((entry,index)=>{
    this.checkedScope(entry.next,actualScope);
    if(!sameSourceRef(entry.base,refs[index])||entry.next.format!=="showai-source-snapshot-v1"||entry.next.ownerId!==source.ownerId||entry.next.epoch!==source.epoch||typeof entry.next.snapshotId!=="string"||!entry.next.snapshotId||typeof entry.unchanged!=="boolean"||
     (entry.unchanged?!sameSourceRef(entry.next,entry.base):entry.next.kind!=="draft"||sameSourceRef(entry.next,entry.base)))
     throw new SourceRuntimeError("SOURCE_PROTOCOL","Ink history response differs from its captured ordered baselines");
   });
   const projected=documents.map(document=>appendPortableInkFromSource(document,sourceDocument,boardId,strokeId));
   projected.forEach((document,index)=>{
    if((document===documents[index])!==response.entries[index].unchanged)throw new SourceRuntimeError("SOURCE_PROTOCOL","Ink history owner and UI projection disagree");
   });
   freezeOwnedSource(response);
   projected.forEach((document,index)=>{if(document!==documents[index])this.remember(freezeOwnedSource(document),Promise.resolve(response.entries[index].next))});
   let released=false;
   return{documents:projected,release:async()=>{
    if(released)return;
    // Publishing a projected result queues its current pin. Do not release
    // the response's only ownership while that actual pin is still pending.
    for(const entry of response.entries){const pin=this.pendingPins.get(key(entry.next));if(pin)await this.waitRegistration(pin)}
    await this.transport.request({kind:"release",leaseId});this.pendingLeases.delete(leaseId);released=true;
   }};
  }catch(error){await this.abandonOutputLease(leaseId);throw error}
 }
 async preparePublication(request:{publicationScope:unknown;pubId:string}):Promise<PreparedSourcePublication>{
  if(!this.transport.publication)throw new SourceRuntimeError("SOURCE_TRANSPORT","This source transport has no Native publication authority");
  this.publicationRequests.set(request.pubId,request);while(this.publicationRequests.size>8)this.publicationRequests.delete(this.publicationRequests.keys().next().value!);
  while(!this.disposed){
   const observed=this.latestDocument;if(!observed)throw new SourceRuntimeError("SOURCE_NOT_OWNED","Native publication has no owned UI source");
   const currentRef=await this.reference(observed);if(this.latestDocument!==observed)continue;
   const leaseId=`${this.clientId}:publication-${request.pubId}`;this.pendingLeases.add(leaseId);
   const result=this.issue(await this.transport.publication({projectId:this.projectId,pageId:this.pageId,currentRef,authorDocument:observed,...request,leaseId}));
   this.publicationOutputs.set(request.pubId,result.next);
   const refs=[result.next,...(result.history?[result.history.sourceOnly.next,...result.history.stages.map(stage=>stage.delta.next)]:[])];
   await this.transport.request({kind:"retain",leaseId,refs});
   const delivery=(result as SourceSnapshotDelta&{sourceSnapshotDeliveryId?:string}).sourceSnapshotDeliveryId;
   if(delivery)await this.transport.acknowledge?.(delivery,result.next);
   if(this.latestDocument!==observed)continue;
   const document=this.apply(result,{publish:false});if(!document)throw new SourceRuntimeError("SOURCE_BASELINE","Native normalized source has no independently owned UI baseline");
   return{sourceSnapshot:result,document};
  }
  throw new SourceRuntimeError("SOURCE_DISPOSED","Native publication source was retired");
 }
 async completePublication(pubId:string){const leaseId=`${this.clientId}:publication-${pubId}`;if(this.disposed)return;const output=this.publicationOutputs.get(pubId),pin=output&&this.pendingPins.get(key(output));if(pin)await this.waitRegistration(pin);await this.transport.request({kind:"release",leaseId});this.pendingLeases.delete(leaseId);this.publicationRequests.delete(pubId);this.publicationOutputs.delete(pubId)}
 async retryPublication(snapshot:SourceSnapshotDelta){const request=snapshot.publicationId&&this.publicationRequests.get(snapshot.publicationId);if(!request)throw new SourceRuntimeError("SOURCE_BASELINE","Native publication descriptor is unavailable");return await this.preparePublication(request)}
 /** Host undo/resolution output is normalized on its actual worker. Merge
  * any UI authoring that arrived while it was executing through owned refs. */
 async acceptProjection(snapshot:SourceSnapshotDelta,captured:ShowDocument,deliveryId?:string):Promise<ShowDocument>{
  const leaseName=`projection-${crypto.randomUUID()}`;snapshot=await this.actualDelta(snapshot,leaseName);
  const incoming=this.apply(snapshot,{publish:false,baseDocument:captured});if(!incoming)throw new SourceRuntimeError("SOURCE_BASELINE","Host projection has no captured independent body");
  await this.retain(incoming,leaseName);
  if(deliveryId)await this.transport.acknowledge?.(deliveryId,snapshot.next);
  try{
   while(!this.disposed){
    const current=this.latestDocument!;
    if(current===captured){const applied=this.apply(snapshot);if(applied)return applied;continue;}
    const merged=await this.merge(captured,current,incoming);
    if(this.latestDocument!==current){await merged.release();continue;}
    const applied=this.apply(merged.delta);await merged.release();if(applied)return applied;
   }
   throw new SourceRuntimeError("SOURCE_DISPOSED","Host projection source was retired");
  }finally{const pin=this.pendingPins.get(key(snapshot.next));if(pin)await this.waitRegistration(pin);await this.releaseLease(leaseName)}
 }
 /** A real save response has already validated/CAS-committed its body. Keep a
  * distinct saved view even when a newer local draft is currently displayed. */
 async acceptSaved(snapshot:SourceSnapshotDelta,captured:ShowDocument,deliveryId?:string):Promise<ShowDocument>{
  snapshot=await this.actualDelta(snapshot,"saved");
  const saved=this.apply(snapshot,{publish:false,baseDocument:captured});if(!saved)throw new SourceRuntimeError("SOURCE_BASELINE","Saved snapshot has no captured independent UI body");
  await this.retain(saved,"saved");if(deliveryId)await this.transport.acknowledge?.(deliveryId,snapshot.next);
  return saved;
 }
 async acknowledgeSaved(saved:ShowDocument,deliveryId:string){const ref=await this.retain(saved,"saved");await this.transport.acknowledge?.(deliveryId,ref)}
 async normalize(document:ShowDocument=this.latestDocument!){const ref=await this.reference(document),leaseId=`${this.clientId}:normalize-${crypto.randomUUID()}`;this.pendingLeases.add(leaseId);const result=this.issue(expectDelta(await this.transport.request({kind:"normalize",ref,leaseId})));await this.retainOutput(result,leaseId);return result}
 registeredBody(ref:SourceSnapshotRef){const body=this.views.get(key(ref))?.deref();return body&&this.proofs.get(body)?.has(key(ref))?body:undefined}
 baseline(snapshot:SourceSnapshotDelta){return snapshot.base?this.views.get(key(snapshot.base))?.deref():undefined}
 async retain(document:ShowDocument,leaseName:string){const ref=await this.reference(document),leaseId=`${this.clientId}:${leaseName}`;await this.transport.request({kind:"retain",leaseId,refs:[ref]});this.historyLeases.add(leaseId);return ref}
 async retainHistory(documents:ShowDocument[],name="history"){
  const generation=(this.historyGeneration.get(name)??0)+1;this.historyGeneration.set(name,generation);
  const refs:SourceSnapshotRef[]=[],leaseId=`${this.clientId}:${name}`;
  const retain=async()=>{if(generation!==this.historyGeneration.get(name)||this.disposed)return;await this.transport.request({kind:"retain",leaseId,refs:[...refs]});this.historyLeases.add(leaseId)};
  for(const document of documents){
   const binding=bindings.get(document);
   if(!binding||binding.session!==this)throw new SourceRuntimeError("SOURCE_NOT_OWNED","History source belongs to another owner");
   if(!binding.remoteRef){if(refs.length)await retain();refs.push(await this.reference(document));}
   else refs.push(binding.remoteRef);
   if(generation!==this.historyGeneration.get(name)||this.disposed)return;
  }
  await retain();
 }
 async releaseLease(name:string){const leaseId=`${this.clientId}:${name}`;this.historyGeneration.set(name,(this.historyGeneration.get(name)??0)+1);this.externalGeneration.set(leaseId,(this.externalGeneration.get(leaseId)??0)+1);await this.transport.request({kind:"release",leaseId});this.historyLeases.delete(leaseId)}
 /** Full mutable imports retain their own race check. A same-object draft
  * mutation during await is captured again; canonical readonly data never uses
  * this path to fake an unchanged generation. */
 async captureMutable(read:()=>ShowDocument):Promise<ShowDocument>{
  while(!this.disposed){const captured=this.replace(read());await this.reference(captured);if(nativeDocumentBodiesEqual(captured,read()))return captured;}
  throw new SourceRuntimeError("SOURCE_DISPOSED","Mutable draft owner was retired");
 }
 async dispose(){
  let failure:unknown;
  try{await this.barrier()}catch(error){failure=error}
  finally{
   this.disposed=true;
   try{
    if(this.transport.close)await this.transport.close();
    else{
     const released=await Promise.allSettled([this.leaseId,...this.historyLeases,...this.pendingLeases].map(leaseId=>this.transport.request({kind:"release",leaseId})));
     const rejected=released.find((value):value is PromiseRejectedResult=>value.status==="rejected");if(rejected&&!failure)failure=rejected.reason;
    }
   }catch(error){if(!failure)failure=error}
  }
  if(failure)throw failure;
 }
}

/** Lazy transport creation: iOS's inline IIFE never constructs a browser
 * worker URL. Browser/Electron use a real dedicated module worker. */
export function createSourceTransport(invoke:<T>(action:string,args?:Record<string,unknown>)=>Promise<T>,homeId?:string,options:{headlessHomeId?:string}={}):SourceRuntimeTransport{
 const sourceClientId=crypto.randomUUID();
 let actualScope:SourceScope|undefined;
 const native=typeof window!=="undefined"&&window.showai?.inlineInk?.nativeScene;
 if(native)return{
  sourceClientId,
  scope:async(projectId,pageId)=>{actualScope=await invoke("native:source.scope",{projectId,pageId,sourceClientId});return actualScope!},
  request:async request=>{const ref="ref" in request?request.ref:"base" in request?request.base:"current" in request?request.current:"source" in request?request.source:null;const scope="scope" in request?request.scope:ref?.scope??("refs" in request?request.refs[0]?.scope:undefined)??actualScope;return await invoke("native:source.request",{projectId:scope?.projectId,pageId:scope?.pageId,sourceClientId,request});},
  publication:args=>invoke("native:source.publication",{...args,sourceClientId}),
  acknowledge:async(deliveryId,ref)=>{await invoke("native:source.acknowledge",{projectId:ref.scope.projectId,pageId:ref.scope.pageId,sourceClientId,deliveryId})},
  close:async()=>{if(actualScope)await invoke("native:source.request",{projectId:actualScope.projectId,pageId:actualScope.pageId,sourceClientId,request:{kind:"dispose",scope:actualScope}})},
 };
 let worker:Worker|undefined,owner:SourceRuntimeOwner|undefined,sequence=0;
 const pending=new Map<string,{resolve:(value:SourceRuntimeResponse)=>void;reject:(error:unknown)=>void}>();
 const start=()=>{
  worker=new Worker(new URL("./source-runtime-worker.ts",import.meta.url),{type:"module"});
  worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);if(data.ok)task.resolve(data.data);else task.reject(Object.assign(new Error(data.error.message),data.error));};
  worker.onerror=event=>{worker?.terminate();worker=undefined;for(const task of pending.values())task.reject(new Error(event.message));pending.clear()};
 };
 return{
  sourceClientId,
  scope:async(projectId,pageId)=>({homeId:typeof window==="undefined"?(options.headlessHomeId??homeId??`headless-owner-${sourceClientId}`):(homeId??(await invoke<{home:string}>("app:info")).home),projectId,pageId}),
  request:async request=>{
   if(typeof window==="undefined"){owner??=new SourceRuntimeOwner();return owner.execute(request)}
   if(!worker)start();
   return await new Promise<SourceRuntimeResponse>((resolve,reject)=>{const id=String(++sequence);pending.set(id,{resolve,reject});worker!.postMessage({id,request});});
  },
  close:()=>{owner=undefined;worker?.terminate();for(const task of pending.values())task.reject(new SourceRuntimeError("SOURCE_DISPOSED","Source worker closed"));pending.clear()},
 };
}
