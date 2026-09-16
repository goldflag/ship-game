/** Run on the shipbuilder diagnostic page with the real WASM compiler and IndexedDB. */
import { controls, mountShipbuilderReview } from './shipbuilder-browser';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { loadSavedConstruction } from '../../src/ships/constructionEditor';
import { openConstructionStore } from '../../src/ships/constructionStore';
import { cornerVertices, selectionCenter, selectionCorners, worldVertex, type HullSelection } from '../../src/ships/constructionVertex';
const sleep = (ms=30) => new Promise(r => setTimeout(r,ms));
const state = () => window.shipbuilderReview!.source!;
async function until(predicate: () => unknown, label: string) {
  const start=performance.now(); while(!predicate()) { if(performance.now()-start>20000) throw new Error(label); await sleep(); }
}
function button(label: string) {
  const b=[...document.querySelectorAll<HTMLButtonElement>('.sb-freeform-tools button,.sb-edit-freeform')].find(b=>b.textContent?.trim()===label||b.getAttribute('aria-label')===label);
  if(!b) throw new Error(`Missing button ${label}`); return b;
}
async function click(label: string) { button(label).click(); await sleep(); }
function input(axis: string) { return document.querySelector<HTMLInputElement>(`.sb-freeform-coordinates input[aria-label="${axis}"]`)!; }
async function coordinate(axis: string,value: number) {
  const field=input(axis); if(field.disabled) throw new Error(`${axis} is locked`); field.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,String(value)); field.dispatchEvent(new Event('input',{bubbles:true}));
  await sleep(); field.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); await sleep();
}
async function select(index: number) {
  const field=document.querySelector<HTMLSelectElement>('select[aria-label="Hull selection"]')!;
  field.value=String(index);field.dispatchEvent(new Event('change',{bubbles:true}));await sleep();
}
async function saved() {
  await sleep(80);
  await until(()=>document.querySelector('.sb-save')?.textContent?.includes('Saved'),'save did not complete');
  await until(()=>!document.querySelector('.sb-ledger h4 span'),'native compile did not complete');
}
export async function mountFreeformReview() {
  const catalog=await loadConstructionCatalog(),source=createStarterSource(catalog,'blank');
  source.name='Freeform controls review'; source.construction.primitives=[
    {id:'a',kind:'box',size:[4,4,4],position:[0,0,0],rotationDeg:0},
    {id:'b',kind:'box',size:[4,4,4],position:[4,0,0],rotationDeg:90},
  ];
  source.construction.surfaces=[{primitiveId:'a',face:'top',thicknessMm:25,material:'steel',paint:'deck-gray'}];
  window.shipbuilderReview?.close(); await mountShipbuilderReview(source);
  await until(()=>state(),'initial source not saved'); await saved();
  await controls.tool('Select'); controls.click(...await controls.screen([0,2,0]));
  await until(()=>document.querySelector('.sb-edit-freeform'),'cube not selected'); await click('Freeform hull');
}
export async function checkFreeformEditor() {
  const checks:string[]=[]; const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
  await mountFreeformReview();
  const handles=()=>document.querySelectorAll('.sb-freeform-handle:not([hidden])').length;
  assert(handles()===8,'X symmetry keeps both sides selectable');
  assert(button('Mirror X').getAttribute('aria-pressed')==='true','local X symmetry starts on');
  assert(button('Move nearby corners').getAttribute('aria-pressed')==='false','neighbor matching starts off');
  assert(!document.querySelector('.sb-freeform-popover'),'split controls start collapsed');
  for(const n of [.5,1,2,.05,.1,.2]) { await click('Cycle move step'); assert(document.querySelector('.sb-unit b')!.textContent===`${n} m`,`Move step cycles to ${n} m`); }
  controls.key('g'); await sleep(); assert(document.querySelector('.sb-unit b')!.textContent==='0.5 m','G cycles move step');
  for(let i=0;i<5;i++) await click('Cycle move step');
  const original=structuredClone(state().construction);
  await click('Edge'); assert(handles()===12,'all twelve edges can be selected');
  await select(10); const edgeBefore=cornerVertices(state().construction.primitives[0]);
  await coordinate('Y',2.4); await saved();
  const edgeAfter=cornerVertices(state().construction.primitives[0]);
  assert([2,6,3,7].every(i=>Math.abs((edgeAfter[i][1]-edgeBefore[i][1])*4-.4)<1e-8),'edge and its mirrored edge move together');
  assert(JSON.stringify(state().construction.primitives[1])===JSON.stringify(original.primitives[1]),'neighbor matching off leaves other block unchanged');
  await click('Reset edit'); await saved();
  await click('Face'); assert(handles()===6,'all six source faces can be selected');
  assert(input('X').disabled && !input('Y').disabled && !input('Z').disabled,'top face spanning X symmetry locks only sideways movement');
  await coordinate('Y',2.4); await saved();
  const top=cornerVertices(state().construction.primitives[0]);
  assert([3,7,6,2].every(i=>Math.abs(top[i][1]*4-2.4)<1e-8),'top face moves once, without duplicate symmetry displacement');
  assert([0,1,4,5].every(i=>top[i][1]===-.5),'unselected bottom corners stay fixed');
  assert(JSON.stringify(state().construction.surfaces)===JSON.stringify(original.surfaces),'armor and paint keep their source face identity');
  await click('Mirror Y');await click('Mirror Z');
  assert(input('X').disabled && input('Z').disabled && !input('Y').disabled,'XYZ locks the spanning axes of a face');
  await select(3);assert(!input('X').disabled && input('Y').disabled && input('Z').disabled,'locks follow selected face');
  await coordinate('X',2.4);await saved();
  assert(cornerVertices(state().construction.primitives[0]).every(v=>Math.abs(Math.abs(v[0]*4)-2.4)<1e-8),'XYZ side face changes width without flattening it');
  await select(2);await coordinate('X',-2.6);await saved();
  assert(cornerVertices(state().construction.primitives[0]).every(v=>Math.abs(Math.abs(v[0]*4)-2.6)<1e-8),'either mirrored side can drive the edit');
  await click('Reset edit');await saved();assert(JSON.stringify(state().construction)===JSON.stringify(original),'Reset restores session-entry shape and original kind');
  await click('Mirror Y');await click('Mirror Z');await select(3);await click('Move nearby corners');
  await coordinate('X',2.2);await saved();const matched=structuredClone(state().construction);
  const [a,b]=matched.primitives;
  assert(selectionCorners({mode:'face',index:3}).every(i=>{
    const anchor=worldVertex(a,cornerVertices(a)[i]);return cornerVertices(b).some(v=>Math.hypot(...worldVertex(b,v).map((n,k)=>n-anchor[k]))<1e-8);
  }),'face edit carries all four shared corners on a rotated neighbor');
  controls.key('z',{ctrlKey:true});await saved();assert(JSON.stringify(state().construction)===JSON.stringify(original),'one undo restores the face and nearby corners');
  controls.key('z',{ctrlKey:true,shiftKey:true});await saved();assert(JSON.stringify(state().construction)===JSON.stringify(matched),'one redo restores the complete edit');
  await click('Move nearby corners');await click('Mirror X');assert(!input('Y').disabled&&!input('Z').disabled,'no mirror axes means unrestricted movement');
  await coordinate('Y',.2);await saved();
  assert(Math.abs(selectionCenter(state().construction.primitives[0],{mode:'face',index:3})[1]-.2)<1e-8,'face center entry translates the face');
  await click('Top');
  const viewport=window.shipbuilderViewport as unknown as {camera:{isOrthographicCamera?:boolean;isPerspectiveCamera?:boolean}};
  assert(viewport.camera.isOrthographicCamera,'Top uses an orthographic camera');
  document.querySelector<HTMLButtonElement>('.sb-freeform-tools button[title="Toggle orthographic and perspective cameras (P)"]')!.click();await sleep();assert(viewport.camera.isPerspectiveCamera,'projection control uses a real perspective camera');
  controls.key('o');await sleep();assert(viewport.camera.isOrthographicCamera,'O restores orthographic projection');
  await click('Split…');assert(!!document.querySelector('.sb-freeform-popover'),'Split opens local axis and count controls');
  controls.key('Escape');await sleep();assert(!document.querySelector('.sb-freeform-popover')&&!!document.querySelector('.sb-freeform-tools'),'Escape closes Split and keeps the edit session');
  await click('Split…');await click('Split block');await saved();assert(state().construction.primitives.length===5,'Split produces independent eight-corner blocks');
  controls.key('z',{ctrlKey:true});await saved();assert(state().construction.primitives.length===2,'one undo restores the unsplit source');
  const store=await openConstructionStore();try { const reopened=await loadSavedConstruction(store,state().id);assert(JSON.stringify(reopened.source)===JSON.stringify(state()),'IndexedDB reopen retains the exact edited source'); } finally { store.close(); }
  const launch=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='SEA TRIALS')!;
  assert(!launch.disabled,'edited hull has a launchable native definition');launch.click();await until(()=>window.shipbuilderReview?.launched,'trial callback was not reached');
  assert(window.shipbuilderReview?.launched?.definition?.construction?.primitives[0].vertices?.length===8,'trial receives the compiled freeform hull');
  return {checks,sourceId:state().id};
}
/** Synthetic capture lifetime is stubbed. Real mouse drags separately verify browser capture. */
export async function checkFreeformDrags() {
  const checks:string[]=[];const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
  await mountFreeformReview();await click('Mirror X');await click('Top');await click('Face');await select(3);
  const axis=()=>document.querySelector<HTMLButtonElement>('.sb-freeform-axis[data-axis="X"]')!;
  async function drag(target:HTMLButtonElement,finish:'commit'|'escape'|'return'|'lost'|'blur'|'secondary',dx=55,dy=25) {
    const r=target.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    target.setPointerCapture=target.releasePointerCapture=()=>{};target.hasPointerCapture=()=>false;
    const event=(type:string,px:number,py:number,button=0)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:71,pointerType:'mouse',button,buttons:type==='pointerup'?0:1,clientX:px,clientY:py}));
    event('pointerdown',x,y);await sleep();event('pointermove',x+dx,y+dy);await sleep();
    if(finish==='escape')controls.key('Escape');
    if(finish==='return')event('pointermove',x,y);
    if(finish==='lost')target.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:71}));
    if(finish==='blur')window.dispatchEvent(new Event('blur'));
    if(finish==='secondary')event('pointerdown',x+dx,y+dy,2);
    event('pointerup',x+(finish==='return'?0:dx),y+(finish==='return'?0:dy));await saved();
  }
  const before=JSON.stringify(state().construction),rev=state().revision;
  for(const reason of ['escape','return','lost','blur','secondary'] as const) {await drag(axis(),reason);assert(JSON.stringify(state().construction)===before&&state().revision===rev,`${reason} cancels without source or history changes`);}
  await drag(axis(),'commit');const after=cornerVertices(state().construction.primitives[0]);
  assert([1,2,5,6].every(i=>after[i][0]!==.5&&after[i][1]===cornerVertices({ ...state().construction.primitives[0],vertices:undefined })[i][1]),'face axis drag translates four corners along local X only');
  controls.key('z',{ctrlKey:true});await saved();assert(JSON.stringify(state().construction)===before,'one undo reverses a face drag');
  await click('Edge');await select(10);
  const selection:HullSelection={mode:'edge',index:10};await drag(document.querySelector<HTMLButtonElement>('.sb-freeform-plane')!,'commit');
  const edge=cornerVertices(state().construction.primitives[0]);
  assert(selectionCorners(selection).every(i=>edge[i][0]!==.5&&edge[i][2]!==cornerVertices({...state().construction.primitives[0],vertices:undefined})[i][2]&&edge[i][1]===.5),'edge plane drag changes X/Z together and holds Y fixed');
  controls.key('z',{ctrlKey:true});await saved();
  await click('Vertex');await select(2);await drag(axis(),'commit');
  assert(cornerVertices(state().construction.primitives[0]).filter((v,i)=>JSON.stringify(v)!==JSON.stringify(cornerVertices({...state().construction.primitives[0],vertices:undefined})[i])).length===1,'vertex gizmo moves one corner with symmetry off');
  return checks;
}
