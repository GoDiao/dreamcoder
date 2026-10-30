declare global {
  interface Window {__showaiNativePerf?:(stage:string,durationMs:number)=>void}
}

/** Diagnostic only: time this synchronous stack, never an awaited operation.
 * No observer means no clock read or diagnostic work. Observer failures cannot
 * change the editor's result or replace its original exception. */
export function measureNativeSync<T>(stage:string,run:()=>T):T {
  const observe=typeof window==='undefined'?undefined:window.__showaiNativePerf;
  if(typeof observe!=='function')return run();
  const start=performance.now();
  try{return run()}
  finally{try{observe(stage,performance.now()-start)}catch{/* Diagnostic observers do not control editor execution. */}}
}
