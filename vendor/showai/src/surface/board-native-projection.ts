/** Include ancestor CSS transforms; WebKit SVG screen matrices omit some
 * ancestor scales. Camera inversion happens once at content/layout changes. */
import {measureNativeSync} from "./native-perf";
import type {ShowDocument} from "../types";
import {inkFramePose} from "./portable-ink.mjs";
export function clientMatrix(element: Element, width: number, height: number) {
  let matrix = new DOMMatrix();
  for(let parent:Element|null=element;parent;parent=parent.parentElement){
    const transform=getComputedStyle(parent).transform;
    if(transform==="none")continue;
    const m=new DOMMatrix(transform);
    matrix=new DOMMatrix([m.a,m.b,m.c,m.d,0,0]).multiply(matrix);
  }
  const rect=element.getBoundingClientRect();
  matrix.e=rect.left-Math.min(0,matrix.a*width,matrix.c*height,matrix.a*width+matrix.c*height);
  matrix.f=rect.top-Math.min(0,matrix.b*width,matrix.d*height,matrix.b*width+matrix.d*height);
  return matrix;
}
export const matrixValues=(m:DOMMatrix)=>[m.a,m.b,m.c,m.d,m.e,m.f].map(n=>Math.round(n*1e6)/1e6);
export interface NativeObjectProjection {
  id:string; size:number[]; cssSize:number[]; matrix:number[];
  clips:{ownerId?:string;matrix:number[];rect:number[]}[];
}
export function measureNativeBoard(surface:HTMLElement,world:HTMLElement,source?:ShowDocument):NativeObjectProjection[]{
  return measureNativeSync("board.measureNativeBoard",()=>measureNativeBoardObjects(surface,world,source));
}
function measureNativeBoardObjects(surface:HTMLElement,world:HTMLElement,source?:ShowDocument):NativeObjectProjection[]{
  const inverse=clientMatrix(world,world.offsetWidth,world.offsetHeight).inverse();
  const projections:NativeObjectProjection[]=[];
  const nodes=new Map<string,Record<string,any>>();
  const visit=(node:any)=>{if(node.attrs?.id)nodes.set(node.attrs.id,node);node.content?.forEach(visit)};
  if(source)visit(source.content);
  for(const element of world.querySelectorAll<HTMLElement>(".surface-object[data-surface-id]")){
    if(element.closest(".page-surface")!==surface)continue;
    const style=getComputedStyle(element);
    const dimension=(axis:"width"|"height")=>{
      let value=parseFloat(style[axis]);
      if(style.boxSizing!=="border-box")value+=axis==="width"
        ?parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth)
        :parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
      return value;
    };
    const width=dimension("width"),height=dimension("height");
    if(!(width>0&&height>0))throw new Error("Native object has no committed layout: "+element.dataset.surfaceId);
    const svg=[...element.querySelectorAll<SVGSVGElement>("svg[data-native-ink],svg.board-drawing")]
      .find(candidate=>candidate.closest("[data-surface-id]")===element);
    const box=svg?.viewBox.baseVal;
    const id=element.dataset.surfaceId!,node=nodes.get(id),extent=node?.attrs?.inkArchiveGroup?.extent??node?.attrs?.extent??node?.attrs?.nativeInk?.extent??node?.attrs?.data?.nativeInk?.extent;
    const size=Array.isArray(extent)&&extent.length===2?extent:box&&box.width>0&&box.height>0?[box.width,box.height]:[width,height];
    const frame=source?.layout?.[id];
    const authoritative=frame?.height&&element.parentElement===world;
    const matrix=authoritative?new DOMMatrix(inkFramePose({...frame,height:frame.height!},size))
      :inverse.multiply(clientMatrix(element,width,height)).scale(width/size[0],height/size[1]);
    if(box&&!authoritative)matrix.translateSelf(-box.x,-box.y);
    const clips:NativeObjectProjection["clips"]=[];
    for(let ancestor=element.parentElement;ancestor&&ancestor!==world;ancestor=ancestor.parentElement){
      const style=getComputedStyle(ancestor);
      if(![style.overflowX,style.overflowY].some(value=>value==="hidden"||value==="clip"||value==="auto"||value==="scroll"))continue;
      const owner=ancestor.closest<HTMLElement>("[data-surface-id]");
      clips.push({ownerId:owner?.dataset.surfaceId,matrix:matrixValues(inverse.multiply(clientMatrix(ancestor,ancestor.offsetWidth,ancestor.offsetHeight))),
        rect:[ancestor.clientLeft,ancestor.clientTop,ancestor.clientWidth,ancestor.clientHeight]});
    }
    projections.push({id:element.dataset.surfaceId!,size,cssSize:[width,height],matrix:matrixValues(matrix),clips});
  }
  return projections;
}
