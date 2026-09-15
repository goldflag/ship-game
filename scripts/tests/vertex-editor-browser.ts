/** Run on scripts/diagnostics/shipbuilder.html with the real WASM compiler and IndexedDB. */
import {controls,mountShipbuilderReview} from './shipbuilder-browser';
import {loadConstructionCatalog} from '../../src/ships/constructionEquipment';
import {createStarterSource} from '../../src/ships/constructionStarter';
import {loadSavedConstruction} from '../../src/ships/constructionEditor';
import {openConstructionStore} from '../../src/ships/constructionStore';
import {cornerVertices} from '../../src/ships/constructionVertex';
const sleep=(ms=30)=>new Promise(r=>setTimeout(r,ms));
const state=()=>window.shipbuilderReview!.source!;
async function until(predicate:()=>unknown,label:string){const start=performance.now();while(!predicate()){if(performance.now()-start>20000)throw new Error(label);await sleep();}}
function button(label:string){const b=[...document.querySelectorAll<HTMLButtonElement>('.sb-vertex-tools button,.sb-edit-vertices')].find(b=>b.textContent?.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw new Error(`Missing button ${label}`);return b;}
async function click(label:string){button(label).click();await sleep();}
async function coordinate(axis:string,value:number){const input=document.querySelector<HTMLInputElement>(`input[aria-label="Corner ${axis}"]`)!;input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));await sleep();input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));await sleep();}
async function saved(){await sleep(60);await until(()=>document.querySelector('.sb-save')?.textContent?.includes('Saved')||document.querySelector('[role=status]')?.textContent?.includes('Saved'),'save did not complete');await until(()=>!document.querySelector('.sb-ledger h4 span'),'native compile did not complete');}
export async function checkVertexEditor(){
 const checks:string[]=[];const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
 const catalog=await loadConstructionCatalog(),source=createStarterSource(catalog,'blank');
 source.name='Vertex controls review';source.construction.primitives=[{id:'a',kind:'box',size:[4,4,4],position:[0,0,0],rotationDeg:0},{id:'b',kind:'box',size:[4,4,4],position:[4,0,0],rotationDeg:90}];
 window.shipbuilderReview?.close();await mountShipbuilderReview(source);await until(()=>state(),'initial source not saved');await saved();
 await controls.tool('Select');controls.click(...await controls.screen([0,2,0]));await until(()=>document.querySelector('.sb-edit-vertices'),'cube not selected');await click('Edit vertices');
 const handles=()=>document.querySelectorAll('.sb-vertex-handle:not([hidden])').length;
 assert(handles()===4,'X symmetry exposes four corners');assert(button('Snap Off').getAttribute('aria-pressed')==='false','SNAP starts off');
 assert(!document.querySelector('.sb-vertex-tools select'),'vertex controls have no UNIT dropdown');
 const units=[.5,1,2,.05,.1,.2];for(const n of units){document.querySelector<HTMLButtonElement>('.sb-unit')!.click();await sleep();assert(document.querySelector('.sb-unit b')!.textContent===`${n} m`,`UNIT cycles to ${n} m`);}
 controls.key('g');await sleep();assert(document.querySelector('.sb-unit b')!.textContent==='.5 m'||document.querySelector('.sb-unit b')!.textContent==='0.5 m','G cycles UNIT');
 for(let i=0;i<5;i++){document.querySelector<HTMLButtonElement>('.sb-unit')!.click();await sleep();}
 await click('Mirror Y');assert(handles()===2,'XY exposes two corners');await click('Mirror Z');assert(handles()===1,'XYZ exposes one corner');
 const before=structuredClone(state().construction),revision=state().revision;
 await coordinate('X',2.4);await until(()=>state().revision!==revision,'XYZ edit was not saved');await saved();
 assert(cornerVertices(state().construction.primitives[0]).every(v=>Math.abs(Math.abs(v[0]*4)-2.4)<1e-8),'XYZ drag-equivalent edit resizes symmetrically');
 assert(JSON.stringify(state().construction.primitives[1])===JSON.stringify(before.primitives[1]),'SNAP off leaves neighbor unchanged');
 await click('Reset edit');await saved();assert(JSON.stringify(state().construction)===JSON.stringify(before),'Reset restores session-entry shape');
 await click('Symmetry');assert(handles()===8,'symmetry off exposes all corners');
 await click('Snap Off');const snapBefore=structuredClone(state().construction);await coordinate('X',2.2);await saved();
 assert(state().construction.primitives.every(p=>p.kind==='vertex'),'SNAP edits the rotated neighbor too');
 controls.key('z',{ctrlKey:true});await saved();assert(JSON.stringify(state().construction)===JSON.stringify(snapBefore),'one undo restores primary and SNAP neighbor');
 await click('Snap On');await click('Top');
 const viewport=window.shipbuilderViewport as unknown as {camera:{isOrthographicCamera?:boolean;isPerspectiveCamera?:boolean};props:{vertex?:unknown}};
 assert(viewport.camera.isOrthographicCamera,'Top uses an orthographic camera');
 document.querySelector<HTMLButtonElement>('.sb-vertex-tools button[title="Toggle orthographic and perspective cameras (P)"]')!.click();await sleep();assert(viewport.camera.isPerspectiveCamera,'View Mode uses a real perspective camera');
 controls.key('o');await sleep();assert(viewport.camera.isOrthographicCamera,'O restores orthographic projection');
 await click('Axis On');assert(button('Axis Off').getAttribute('aria-pressed')==='false','plane dragging can be selected');
 await click('Split');await saved();assert(state().construction.primitives.length===5,'Split produces four independent children');assert(!document.querySelector('.sb-vertex-tools'),'split exits the edit session');
 controls.key('z',{ctrlKey:true});await saved();assert(state().construction.primitives.length===2,'one undo restores unsplit source');
 await controls.tool('Select');controls.click(...await controls.screen([0,2,0]));await until(()=>document.querySelector('.sb-edit-vertices'),'restored cube not selected');await click('Edit vertices');await coordinate('X',2.2);await saved();
 assert(state().construction.primitives[0].vertices?.length===8,'edited corner source remains after split undo');
 const store=await openConstructionStore();try{const reopened=await loadSavedConstruction(store,state().id);assert(JSON.stringify(reopened.source)===JSON.stringify(state()),'IndexedDB reopen retains the exact edited source');}finally{store.close();}
 const launch=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='SEA TRIALS')!;
 assert(!launch.disabled,'edited hull has a launchable native definition');launch.click();await until(()=>window.shipbuilderReview?.launched,'trial callback was not reached');
 assert(window.shipbuilderReview?.launched?.definition?.construction?.primitives[0].vertices?.length===8,'trial receives the compiled vertex hull');
 return {checks,sourceId:state().id};
}

/** Synthetic capture lifetime is stubbed; production ray/plane math, previews,
 * source commits, cancellation and history still run through the real viewport. */
export async function checkVertexDrags(){
 const checks:string[]=[];const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
 await click('Top');if([...document.querySelectorAll('.sb-vertex-tools button')].some(b=>b.textContent?.trim()==='Axis Off'))await click('Axis Off');
 const handle=()=>document.querySelectorAll<HTMLButtonElement>('.sb-vertex-handle')[2];
 const begin=()=>{
   const b=handle(),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
   const capture=b.setPointerCapture,release=b.releasePointerCapture;b.setPointerCapture=b.releasePointerCapture=()=>{};
   const event=(type:string,dx=0,dy=0)=>b.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:77,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:x+dx,clientY:y+dy}));
   event('pointerdown');return {event,restore(){b.setPointerCapture=capture;b.releasePointerCapture=release;}};
 };
 const before=structuredClone(state()),history=Number(document.querySelector('button[title^="Undo"]')!.textContent!.replace(/\D/g,''));
 let drag=begin();drag.event('pointermove',40,10);
 assert(state().revision===before.revision,'drag previews without saving intermediate geometry');
 drag.event('pointerup',40,10);drag.restore();await saved();
 const p=state().construction.primitives[0],v=cornerVertices(p)[2],old=cornerVertices(before.construction.primitives[0])[2];
 assert(v[0]!==old[0]&&v[1]===old[1]&&v[2]===old[2],'initial drag direction locks the local X axis');
 assert(Math.abs((v[0]-old[0])*p.size[0]/.2-Math.round((v[0]-old[0])*p.size[0]/.2))<1e-8,'drag displacement uses UNIT increments');
 assert(Number(document.querySelector('button[title^="Undo"]')!.textContent!.replace(/\D/g,''))===history+1,'one completed drag creates one undo step');
 assert(JSON.stringify(state().construction.primitives[1])===JSON.stringify(before.construction.primitives[1]),'drag with SNAP off preserves the neighbor');
 const cancelBefore=JSON.stringify(state().construction);drag=begin();drag.event('pointermove',40,30);controls.key('Escape');drag.restore();await sleep(100);
 assert(JSON.stringify(state().construction)===cancelBefore,'Escape cancels a preview without a source edit');
 await click('Axis On');const planeBefore=cornerVertices(state().construction.primitives[0])[2];drag=begin();drag.event('pointermove',30,30);drag.event('pointerup',30,30);drag.restore();await saved();
 const plane=cornerVertices(state().construction.primitives[0])[2];assert(plane[0]!==planeBefore[0]&&plane[2]!==planeBefore[2]&&plane[1]===planeBefore[1],'Top view plane drag changes X/Z and holds Y fixed');
 return checks;
}
