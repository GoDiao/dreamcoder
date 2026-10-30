/** Ephemeral input configuration. It is never document/source authority. */
export interface NativeBoardControl {
  tool:string;color:string;fillColor:string;width:number;pressure:boolean;ruler:boolean;
}
export interface NativeBoardControlRecord {revision:number;control:Readonly<NativeBoardControl>}
export interface NativeBoardToolReceipt {revision:number;tool:string;applied:boolean;superseded?:boolean}
export interface NativeBoardControlHandle {update(value:Partial<NativeBoardControl>):void}
const tools=new Set(["select","pen","highlighter","eraser","rectangle","ellipse","arrow","region","text","pan","lasso"]);
/** Both an intent and a frame retain this same captured, closed value. */
export function serializeNativeBoardControl(value:NativeBoardControl):Readonly<NativeBoardControl>{
  if(!value||Object.keys(value).length!==6||!["tool","color","fillColor","width","pressure","ruler"].every(key=>Object.hasOwn(value,key)))throw new TypeError("Invalid native Board input configuration");
  const {tool,color,fillColor,width,pressure,ruler}=value;
  if(!tools.has(tool)||typeof color!=="string"||!color||color.length>256||
    typeof fillColor!=="string"||!fillColor||fillColor.length>256||
    !Number.isFinite(width)||width<.5||width>40||typeof pressure!=="boolean"||typeof ruler!=="boolean")
    throw new TypeError("Invalid native Board input configuration");
  return Object.freeze({tool,color,fillColor,width,pressure,ruler});
}
export function captureNativeBoardControl(previous:NativeBoardControlRecord|undefined,value:NativeBoardControl):NativeBoardControlRecord{
  const control=serializeNativeBoardControl(value);
  if(previous&&Object.keys(control).every(key=>control[key as keyof NativeBoardControl]===previous.control[key as keyof NativeBoardControl]))return previous;
  if(previous&&previous.revision>=Number.MAX_SAFE_INTEGER)throw new RangeError("Native Board control revision exhausted");
  return Object.freeze({revision:(previous?.revision??0)+1,control});
}
