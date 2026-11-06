// Isolated event regression: simulate a menu render replacing the clicked icon.
// Exercises the source click handlers; does not replace browser interaction checks.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../mockups/dreamcoder-complete-study.html'), 'utf8');
const rootStart = source.indexOf("root.addEventListener('click',e=>{");
const rootHandler = source.slice(rootStart, source.indexOf("root.addEventListener('change',", rootStart));
const outsideHandler = source.split('\n').find(line => line.startsWith("document.addEventListener('click',"));
function scenario(detachIcon) {
  const listeners = {};
  const menu = {hidden:true, contains:target=>target===menu};
  let detached=false;
  const button = {dataset:{menu:'session-row'}, contains:target=>target===button || target===icon&&!detached};
  button.closest=()=>button;
  const icon={closest:()=>button};
  const context={
    root:{addEventListener:(_,fn)=>listeners.root=fn},
    document:{addEventListener:(_,fn)=>listeners.document=fn},
    $:()=>menu, menuAnchor:null,
    closeMenu:()=>{menu.hidden=true;context.menuAnchor=null;},
    showMenu:(_,anchor)=>{menu.hidden=false;context.menuAnchor=anchor;detached=detachIcon;}
  };
  vm.createContext(context);
  vm.runInContext(rootHandler+'\n'+outsideHandler,context);
  function click(target,inside=true){
    let stopped=false;
    const event={target,stopPropagation(){stopped=true;},composedPath(){return inside?[target,button,context.root,context.document]:[target,context.document];}};
    if(inside)listeners.root(event);
    if(!stopped)listeners.document(event);
  }
  click(detachIcon?icon:button);
  assert.equal(menu.hidden,false,`menu stays open after ${detachIcon?'icon replacement':'button click'}`);
  click(button);
  assert.equal(menu.hidden,true,'second trigger click closes');
  click(button);
  click({closest:()=>null},false);
  assert.equal(menu.hidden,true,'outside click closes');
}
scenario(false);
scenario(true);
console.log('PASS: button, replaced icon, toggle and outside-click cases');
