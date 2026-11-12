// Exercises the exported state bridge and the actual mockup listeners.
// DOM replacement is counted; this is not a native-popup browser test.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../mockups/dreamcoder-complete-study.html'),'utf8');
const exported=fs.readFileSync(path.join(__dirname,'../mockups/dreamcoder-preview.html'),'utf8').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const bridge=exported.slice(exported.indexOf('const setWidgetState = async'),exported.indexOf('  const syncTheme ='));
const listeners={};let clicks, renders=0;
const state={appearance:'跟随系统',bodySize:16,scene:'回复完成',permission:'询问权限',model:'Sonnet',effort:'中',settingsTab:'通用',files:false,terminal:false};
const ctx={state,settings:['通用','模型服务商'],root:{addEventListener(name,fn){if(name==='click')clicks=fn;}},renderAll(){renders++;},addEventListener(name,fn){listeners[name]=fn;},dispatchEvent(event){listeners[event.type]?.(event);},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},openai:{widgetState:null},stringify:JSON.stringify,parse:JSON.parse,isArray:Array.isArray,encode:s=>Buffer.from(s),hasOwn:(o,k)=>Object.hasOwn(o,k),statePersistence:'none',persistenceError:()=>new Error('Persistence disabled in check')};
ctx.window=ctx;
vm.createContext(ctx);
// The bridge owns its own serialized state, separate from the app's state.
vm.runInContext('{let state=null;'+bridge+'globalThis.openai.setWidgetState=setWidgetState;}',ctx);
const tail=source.slice(source.indexOf('function restoreDesign('),source.indexOf('if(globalThis.Tweak)'));
vm.runInContext(tail,ctx);
(async()=>{
 const initial=renders;
 clicks();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(renders,initial,'opening a control must not rebuild the page on its own state echo');
 clicks();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(renders,initial,'repeated click keeps existing DOM');
 const snapshot=JSON.parse(JSON.stringify(ctx.openai.widgetState));
 snapshot.modelContent.appearance='深色';
 listeners['openai:set_globals']({detail:{globals:{widgetState:snapshot}}});
 assert.equal(state.appearance,'深色');assert.equal(renders,initial+1,'external design change still renders');
 listeners['openai:set_globals']({detail:{globals:{widgetState:snapshot}}});
 assert.equal(renders,initial+1,'identical external state does not render twice');
 listeners['openai:set_globals']({detail:{globals:{widgetState:{modelContent:{design:'other'}}}}});
 assert.equal(renders,initial+1,'unrelated state does not reset the page');
 console.log('PASS: exported bridge echo preserves DOM; external changes apply once; unrelated state ignored');
})().catch(error=>{console.error(error);process.exitCode=1;});
