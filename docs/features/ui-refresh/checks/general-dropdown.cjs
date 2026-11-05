// Actual page-menu functions and delegated events; no browser popup emulation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../mockups/dreamcoder-complete-study.html'),'utf8');
const listeners={};let items=[],active,trigger;
function button(dataset){return {dataset,attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||'';},focus(){active=this;},closest(){return this;},contains(t){return t===this;},getBoundingClientRect(){return {left:400,top:120,bottom:152,width:160,height:32};}};}
const menu={hidden:true,classList:{toggle(){}},setAttribute(){},removeAttribute(){},style:{},contains:t=>items.includes(t),getBoundingClientRect:()=>({width:240,height:260}),set innerHTML(v){this.html=v;items=[...v.matchAll(/<button data-menu-index="(\d+)"([^>]*)>/g)].map(m=>Object.assign(button({menuIndex:m[1]}),{checked:m[2].includes('aria-checked="true"')}));},get innerHTML(){return this.html;}};
const overlay={hidden:true};const document={addEventListener:(name,fn)=>listeners['doc-'+name]=fn,get activeElement(){return active;}};
const ctx={document,root:{addEventListener:(name,fn)=>listeners[name]=fn,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:900})},prefs:{values:{theme:'经典暖色'}},menuAnchor:null,menuActions:[],icons(){},esc:String,icon:s=>`<i data-lucide="${s}"></i>`,$:s=>s==='#menu'?menu:s==='#overlay'?overlay:s.includes('aria-checked')?items.find(b=>b.checked):s==='#menu button'?items[0]:null,$$:s=>s==='[data-general-key]'?[trigger]:s.startsWith('#menu button')?items:[],renderSettings(){trigger=button({menu:'general-select',generalKey:'theme'});},state:{scene:'回复完成'}};
vm.createContext(ctx);
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const rootStart=source.indexOf("root.addEventListener('click',e=>{");
const program=source.split('\n').find(l=>l.startsWith('function closeMenu()'))+'\n'+slice('function menu(', 'function openDialog(')+slice('const generalOptions=', 'function generalSwitch(')+slice('function showMenu(', 'async function copyText(')+source.slice(rootStart,source.indexOf("root.addEventListener('change',",rootStart))+'\n'+source.split('\n').find(l=>l.startsWith("document.addEventListener('click',"))+'\n'+slice("root.addEventListener('keydown',e=>{\n if(e.key==='Escape')",'function restoreDesign(');
vm.runInContext(program,ctx);
const markup=vm.runInContext("generalSelect('配色主题','theme',['纯白','经典暖色','暗色','午夜','DreamField 翡翠','秋日琥珀','极光'])",ctx);
assert(!markup.includes('<select'),'no native popup remains');assert(markup.includes('aria-haspopup="menu"'));
ctx.renderSettings();trigger.setAttribute('aria-label','配色主题');
function click(target,inside=true){let stopped=false;const e={target,stopPropagation(){stopped=true;}};if(inside)listeners.click(e);if(!stopped)listeners['doc-click'](e);}
click(trigger);assert.equal(menu.hidden,false);assert.equal(items.length,7);assert.equal(trigger.attrs['aria-expanded'],'true');
assert(!listeners.pointerdown&&!listeners.pointerup&&!listeners.mouseup,'menu lifetime is not tied to pressed mouse state');
click(items[2]);assert.equal(ctx.prefs.values.theme,'暗色');assert.equal(menu.hidden,true);assert.equal(active,trigger,'focus returns to new trigger');
click(trigger);assert.equal(menu.hidden,false);listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(menu.hidden,true);
click(trigger);click({closest:()=>null},false);assert.equal(menu.hidden,true,'outside click closes');
click(trigger);click(trigger);assert.equal(menu.hidden,true,'same trigger toggles');
console.log('PASS: 7 page-menu choices, stable click-open, select+focus, Escape, outside click and trigger toggle; browser interaction still unverified');
