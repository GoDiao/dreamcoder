import type {Camera} from "./model";
export interface NativeCameraAuthority {scope:string;nativeRevision:number;webRevision:number}
export interface NativeCameraIntent {scope:string|null;baseNativeRevision:number;revision:number;camera:Readonly<Camera>}
export interface NativeCameraState {scope:string|null;nativeRevision:number;webRevision:number;nextIntentRevision:number;intent?:Readonly<NativeCameraIntent>}
const revision=(value:number)=>Number.isSafeInteger(value)&&value>=0;
export function initialNativeCameraState():NativeCameraState{return{scope:null,nativeRevision:0,webRevision:0,nextIntentRevision:0}}
/** Capture at the actual viewport event. Sending/retrying never rebases it. */
export function captureNativeCameraIntent(state:NativeCameraState,camera:Camera):NativeCameraState {
  if(![camera.x,camera.y,camera.scale].every(Number.isFinite)||camera.scale<.01||camera.scale>32)throw new TypeError("Invalid camera intent");
  if(!revision(state.nextIntentRevision)||state.nextIntentRevision>=Number.MAX_SAFE_INTEGER)throw new RangeError("Camera intent revision exhausted");
  const next=state.nextIntentRevision+1;
  return {...state,nextIntentRevision:next,intent:Object.freeze({scope:state.scope,baseNativeRevision:state.nativeRevision,revision:next,camera:Object.freeze({...camera})})};
}
export function observeNativeCameraAuthority(state:NativeCameraState,authority:NativeCameraAuthority):NativeCameraState {
  if(typeof authority.scope!=="string"||!authority.scope||!revision(authority.nativeRevision)||!revision(authority.webRevision))throw new TypeError("Invalid native camera authority");
  const changed=state.scope!==null&&state.scope!==authority.scope;
  if(!changed&&(authority.nativeRevision<state.nativeRevision||(authority.nativeRevision===state.nativeRevision&&authority.webRevision<state.webRevision)))return state;
  const intent=state.intent;
  const retained=!changed&&intent&&intent.revision>authority.webRevision&&intent.baseNativeRevision===authority.nativeRevision?intent:undefined;
  return {scope:authority.scope,nativeRevision:authority.nativeRevision,webRevision:authority.webRevision,nextIntentRevision:changed?authority.webRevision:Math.max(state.nextIntentRevision,authority.webRevision),...(retained?{intent:retained}:{})};
}
