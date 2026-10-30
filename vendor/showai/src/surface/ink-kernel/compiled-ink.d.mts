import type { PortableInkV1 as PortableInk } from '../portable-ink.mjs';
export interface InkKernelProvenance { abiVersion: number; sourceHashes: Record<string,string>; wasmSha256: string; bytes: number; compiler: string; flags: string[]; imports: {module:string;name:string;kind:string}[] }
export const inkKernelProvenance: InkKernelProvenance;
export interface InkContourBuffers { points: Float64Array; contours: Uint32Array }
export interface PreparedInkGeometry extends InkContourBuffers {
  vertices: Float32Array;
  bounds: {x:number;y:number;width:number;height:number};
  mask: InkContourBuffers | null;
}
export interface InkKernelExports {
  memory: WebAssembly.Memory;
  sa_ink_build(...values:number[]):number;
  [key:string]: WebAssembly.ExportValue | ((...values:number[])=>number);
}
export class CompiledInkKernel {
  constructor();
  readonly instance: WebAssembly.Instance;
  readonly api: InkKernelExports;
  reset():void;
  allocate(size:number):number;
  samples(samples:number[][]):number;
  style(ink:PortableInk,width:number,pressure:boolean):number;
  resolveSamples(ink:PortableInk,width?:number,pressure?:boolean):number[][];
  bounds(ink:PortableInk,width?:number,pressure?:boolean):{x:number;y:number;width:number;height:number};
  prepare(ink:PortableInk,width?:number,pressure?:boolean,start?:number,length?:number):PreparedInkGeometry;
  flattenMask(commands:PortableInk['mask'],affine:PortableInk['transform']):InkContourBuffers;
  hit(geometry:PreparedInkGeometry,point:{x:number;y:number}):{inside:boolean;distance:number;solid:true};
  segmentHit(geometry:PreparedInkGeometry,start:{x:number;y:number},end:{x:number;y:number},radius?:number):boolean;
  geometry(ink:PortableInk,width?:number,pressure?:boolean):{polygons:{x:number;y:number}[][];path:string;mask:string|undefined;prepared:PreparedInkGeometry};
}
