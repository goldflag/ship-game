/** Production controls, worker compilation, history, and a save/reopen round trip. */
import { mountShipbuilderReview, controls } from './shipbuilder-browser';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { decodeConstructionSource } from '../../src/ships/constructionEditor';
const pause=()=>new Promise(r=>setTimeout(r,40));
const button=(label:string)=>{
  const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label || b.getAttribute('aria-label')===label);
  if(!b||b.disabled)throw new Error('Unavailable control '+label);return b;
};
async function click(label:string){button(label).click();await pause();}
async function field(label:string,value:number){
  const input=document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  if(!input)throw new Error('Missing field '+label);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));await pause();input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));await pause();
}
async function ready(){
  const start=performance.now();while(!window.constructionEditor?.result()||window.constructionEditor.result()!.revision!==window.constructionEditor.source()!.revision){if(performance.now()-start>45000)throw new Error('Shape compile timed out');await pause();}
  const errors=window.constructionEditor.result()!.diagnostics.filter(d=>d.severity==='error');if(errors.length)throw new Error(JSON.stringify(errors));
  await window.constructionEditor.flush();
}
export async function mountShapingReview(){
  window.shipbuilderReview?.close();
  const catalog=await loadConstructionCatalog(),source=createStarterSource(catalog,'blank');source.name='Round / chamfer test';
  source.construction.primitives=[{id:'test-block',kind:'box',size:[8,6,12],position:[0,0,0],rotationDeg:0}];
  await mountShipbuilderReview(source,catalog);await ready();await controls.tool('Select');controls.click(...await controls.screen([0,3,0]));await pause();await click('Freeform hull');await pause();
}
export async function checkFreeformShaping(){
  const checks:string[]=[];const assert=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
  await mountShapingReview();const part=()=>window.constructionEditor!.source()!.construction.primitives[0];
  await click('Round / chamfer');await click('All edges');await ready();await field('Radius',.8);await ready();
  assert(part().shaping?.edges.length===12 && part().shaping?.radius===.8,'round all edges on one block');
  await click('Chamfer');await ready();assert(part().shaping?.style==='chamfer','switch to physical chamfer');
  await click('Round');await ready();await click('Clear edges');await ready();
  await click('Treat edge 9');await ready();assert(JSON.stringify(part().shaping!.edges)==='[8,9]','mirrored edge selection');
  const before=part().shaping!.radius;
  await field('Radius',1.2);await ready();
  assert(part().shaping!.radius===1.2,'radius updates native geometry');
  await window.constructionEditor!.undo();await ready();assert(part().shaping!.radius===before,'undo restores radius');
  await window.constructionEditor!.redo();await ready();assert(part().shaping!.radius===1.2,'redo restores radius');
  await field('Radius',0);await ready();assert(part().shaping!.radius===0,'zero radius restores sharp edges');
  await click('Remove edge treatment');await ready();assert(!part().shaping,'remove edge treatment retains cage');
  await click('All edges');await ready();await field('Radius',.8);await ready();
  const saved=decodeConstructionSource(JSON.parse(JSON.stringify(window.constructionEditor!.source()!)));window.shipbuilderReview!.close();await mountShipbuilderReview(saved);await ready();
  assert(JSON.stringify(window.constructionEditor!.source()!.construction)===JSON.stringify(saved.construction),'reopening saved source retains complete shape');
  assert(saved.construction.primitives.length===1,'edge operations retain one hull block');
  return checks;
}
