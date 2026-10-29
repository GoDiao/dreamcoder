import {initialNativeCameraState,captureNativeCameraIntent,observeNativeCameraAuthority} from "./native-board-camera";
import {captureNativeBoardControl,type NativeBoardControlRecord,type NativeBoardControlHandle} from "./native-board-control";
import {measureNativeSync} from "./native-perf";
import {useEffect,useRef,useState,type RefObject} from "react";
import type {ShowDocument} from "../types";
import type {JSONContent} from "@tiptap/core";
import type {Camera} from "./model";
import type {NodeLayout} from "./types";
import {clientMatrix,matrixValues,measureNativeBoard} from "./board-native-projection";
import {nativeBoardUIRegions} from "./ink-ui-regions";
import {finishBoardDrawing} from "./board-drawing.mjs";
declare global { interface Window { showaiApplyingNativeCamera?:boolean } }

export interface NativeBoardOptions {
  root:RefObject<HTMLDivElement|null>;world:RefObject<HTMLDivElement|null>;camera:RefObject<Camera>;
  document?:ShowDocument;boardId:string;tool?:string|null;color:string;fillColor?:string;width:number;pressure:boolean;ruler:boolean;enabled:boolean;
  onCamera:(value:Camera,final:boolean)=>void;onTool:(tool:string)=>void;onClearSelection:()=>void;
  selection?:()=>string[];onSelection?:(ids:string[])=>void;
  onLayout?:(frames:Record<string,NodeLayout>)=>void;
  onDrawing?:(node:JSONContent,frame:NodeLayout)=>void;
  onActivate?:(id:string)=>void;
  control?:RefObject<NativeBoardControlHandle|null>;
}

/** All tools share one native scene. DOM measurements belong to content/layout
 * changes; native contact/camera frames never ask React to repaint the Board. */
export function useNativeBoard(options:NativeBoardOptions){
  const current=useRef(options);current.current=options;
  const [owner,setOwner]=useState<{pageId:string;boardId:string;token:string}|null>(null);
  const cameraAuthority=useRef(initialNativeCameraState()),bindingToken=useRef<string|undefined>(undefined);
  const invalidation=useRef<(()=>void)|null>(null), cameraVersion=useRef(0), previousInk=useRef("pen");
  const active=options.enabled&&typeof window!=="undefined"&&window.showai?.inlineInk?.nativeScene===true;
  const controlState=useRef<{key:string;record:NativeBoardControlRecord;token?:string;send?:()=>void}|undefined>(undefined);
  const controlKey=options.document?.id+":"+options.boardId;
  const laneAvailable=active&&typeof window.showai?.inlineInk?.toolIntent==="function";
  if(laneAvailable&&(!controlState.current||controlState.current.key!==controlKey)){
    controlState.current={key:controlKey,record:captureNativeBoardControl(undefined,{tool:options.tool??"select",color:options.color,fillColor:options.fillColor??"none",width:options.width,pressure:options.pressure,ruler:options.ruler})};
    if(options.tool==="pen"||options.tool==="highlighter")previousInk.current=options.tool;
  }
  if(options.control)options.control.current=laneAvailable?{update(patch){const state=controlState.current!;state.record=captureNativeBoardControl(state.record,{...state.record.control,...patch});if(patch.tool==="pen"||patch.tool==="highlighter")previousInk.current=patch.tool;state.send?.()}}:null;
  useEffect(()=>{invalidation.current?.()});
  useEffect(()=>{
    const bridge=window.showai?.inlineInk;
    if(!active||!bridge||!options.document)return;
    return bridge.onCommand(value=>{
      const o=current.current;
      if(value.pageId!==o.document?.id||value.boardId!==o.boardId||value.token&&value.token!==bindingToken.current)return;
      if(value.error)throw new Error(value.error);
      if(value.clearSelection)o.onClearSelection();
      if(value.selection)o.onSelection?.(value.selection);
      if(value.layouts)o.onLayout?.(value.layouts);
      if(value.activate)o.onActivate?.(value.activate);
      if(value.cameraAuthority)cameraAuthority.current=observeNativeCameraAuthority(cameraAuthority.current,value.cameraAuthority);
      if(value.camera){
        cameraVersion.current=value.cameraVersion??cameraVersion.current;
        const previous=window.showaiApplyingNativeCamera;window.showaiApplyingNativeCamera=true;
        try{const actual=o.camera.current;if(actual.x!==value.camera.x||actual.y!==value.camera.y||actual.scale!==value.camera.scale)o.onCamera(value.camera,true)}finally{window.showaiApplyingNativeCamera=previous}
      }
      if(value.primitive){
        const p=value.primitive;
        if(!["rectangle","ellipse","arrow","region"].includes(p.tool))throw new Error("Unsupported native primitive");
        const result=finishBoardDrawing(p.tool as Parameters<typeof finishBoardDrawing>[0],p.style??{color:o.color,fillColor:o.fillColor??"none",strokeWidth:o.width},
          {origin:p.start,release:p.end,points:[p.start,p.end],moved:Math.hypot(p.end.x-p.start.x,p.end.y-p.start.y)*o.camera.current.scale>=3,scale:o.camera.current.scale});
        result.node.attrs!.id=p.id;o.onDrawing?.(result.node,result.frame);
      }
      if(value.tool)o.onTool(value.tool==="toggleEraser"?((controlState.current?.record.control.tool??o.tool)==="eraser"?previousInk.current:"eraser"):value.tool==="previous"?previousInk.current:value.tool);
    });
  },[active,options.document?.id,options.boardId]);
  useEffect(()=>{
    const bridge=window.showai?.inlineInk,o=current.current,surface=o.root.current,world=o.world.current;
    if(!active||!bridge||!surface||!world||!o.document)return;
    cameraAuthority.current=initialNativeCameraState();cameraVersion.current=0;
    const token=crypto.randomUUID(),control=controlState.current,lane=typeof bridge.toolIntent==="function";
    const sendControl=()=>{if(!alive||!lane||!control)return;const record=control.record;
      void bridge.toolIntent!({pageId:o.document!.id,boardId:o.boardId,token,...record}).catch(error=>{if(alive)surface.dispatchEvent(new CustomEvent("showai:ink-error",{bubbles:true,detail:String(error)}))});
    };
    bindingToken.current=token;
    let alive=true,pending=false,dirty=false,frame=0,controlStarted=false,lastKey="",lastDocument:ShowDocument|undefined;
    let poseDocument:ShowDocument|undefined,poseSize="",poses:ReturnType<typeof measureNativeBoard>|undefined,lastPoses:typeof poses;
    const schedule=()=>{dirty=true;if(alive&&!pending&&!frame)frame=requestAnimationFrame(()=>{frame=0;void send()})};
    const send=async()=>{
      dirty=false;const v=current.current,source=v.document;
      if(!alive||!source)return;
      if(measureNativeSync("board.visibility",()=>!surface.getClientRects().length||document.visibilityState==="hidden"))return;
      const size=measureNativeSync("board.surfaceSize",()=>surface.clientWidth+":"+surface.clientHeight);
      if(poseDocument!==source||poseSize!==size){poses=measureNativeBoard(surface,world,source);poseDocument=source;poseSize=size}
      const holes=measureNativeSync("board.inkUIRegions",()=>nativeBoardUIRegions(document.querySelectorAll<HTMLElement>("[data-surface-ui],.surface-toolbar,.studio-context-menu,.studio-modal-shade,.container-inspector,.studio-sidebar-shell:not([data-sidebar-mode=hidden]) .studio-sidebar,.studio-mobile-sidebar-edge,.studio-mobile-sidebar-scrim,.studio-mobile-navigation-tools")));
      const style=measureNativeSync("board.surfaceStyle",()=>getComputedStyle(surface));
      const capturedControl=lane?control?.record:undefined;
      const packet=measureNativeSync("board.packet",()=>({...(capturedControl?{controlIntent:capturedControl}:{}),token,pageId:source.id,boardId:v.boardId,nativeScene:true,tool:v.tool??"select",color:v.color,fillColor:v.fillColor??"none",width:v.width,pressure:v.pressure,ruler:v.ruler,
        dark:document.documentElement.dataset.theme==="dark",widthPx:surface.clientWidth,heightPx:surface.clientHeight,
        viewport:measureNativeSync("board.viewportMatrix",()=>matrixValues(clientMatrix(surface,surface.offsetWidth,surface.offsetHeight))),camera:{...v.camera.current},cameraVersion:cameraVersion.current,...(cameraAuthority.current.intent?{cameraIntent:cameraAuthority.current.intent}:{}),
        selection:v.selection?.()??[],holes,grid:surface.classList.contains("has-board-grid"),background:measureNativeSync("board.backgroundColor",()=>style.backgroundColor)}));
      const key=measureNativeSync("board.packetKey",()=>JSON.stringify(packet));
      if(key===lastKey&&source===lastDocument&&poses===lastPoses)return;
      pending=true;
      try{
        surface.dataset.nativeInkToken=token;
        if(lane&&!controlStarted){controlStarted=true;sendControl()}
        const accepted=await bridge.frame({...packet,...(poses!==lastPoses?{objects:poses}:{}),document:source});
        if(!alive||accepted===false)return;
        lastKey=key;lastDocument=source;lastPoses=poses;
        surface.dataset.nativeBoardActive="true";
        setOwner(previous=>previous?.token===token?previous:{pageId:source.id,boardId:v.boardId,token});
      }catch(error){surface.dispatchEvent(new CustomEvent("showai:ink-error",{bubbles:true,detail:String(error)}));throw error}
      finally{pending=false;if(dirty)schedule()}
    };
    if(control){control.token=token;control.send=sendControl}
    invalidation.current=schedule;
    const observer=new MutationObserver(changes=>{
      if(changes.some(change=>change.target!==world&&world.contains(change.target)))poseDocument=undefined;
      if(changes.some(change=>change.target!==world&&change.attributeName!=="data-native-board-active"))schedule();
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["style","class","hidden","open","data-sidebar-mode","data-mobile-sidebar","data-theme","data-native-orientation","data-dragging"]});
    const resize=new ResizeObserver(()=>{poseSize="";schedule()});resize.observe(surface);
    const viewport=()=>{if(window.showaiApplyingNativeCamera)return;cameraVersion.current++;cameraAuthority.current=captureNativeCameraIntent(cameraAuthority.current,current.current.camera.current);schedule()};
    const refresh=()=>{lastDocument=undefined;poseDocument=undefined;lastKey="";schedule()};
    surface.addEventListener("showai:viewport-change",viewport);surface.addEventListener("showai:ink-refresh",refresh);
    window.addEventListener("resize",schedule);document.addEventListener("scroll",schedule,true);document.addEventListener("visibilitychange",schedule);
    schedule();
    return()=>{alive=false;if(bindingToken.current===token)bindingToken.current=undefined;if(control?.send===sendControl){control.send=undefined;control.token=undefined}setOwner(previous=>previous?.token===token?null:previous);if(invalidation.current===schedule)invalidation.current=null;cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();
      surface.removeEventListener("showai:viewport-change",viewport);surface.removeEventListener("showai:ink-refresh",refresh);window.removeEventListener("resize",schedule);document.removeEventListener("scroll",schedule,true);document.removeEventListener("visibilitychange",schedule);
      void bridge.hide(o.document!.id,o.boardId,token).finally(()=>{if(surface.dataset.nativeInkToken===token){delete surface.dataset.nativeBoardActive;delete surface.dataset.nativeInkToken}});
    };
  },[active,options.document?.id,options.boardId,options.root,options.world]);
  // Ownership follows an accepted native scene, scoped to this exact Board.
  // An inactive/printing/locked surface immediately keeps its DOM renderer.
  return active&&!!owner&&owner.pageId===options.document?.id&&owner.boardId===options.boardId;
}
