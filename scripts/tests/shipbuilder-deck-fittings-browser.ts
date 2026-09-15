import type { Vec3 } from '../../src/ships/blueprint';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { mountShipbuilderReview, controls } from './shipbuilder-browser';

import { deckFittingsFixture } from './construction-model-fixtures';
export { deckFittingsFixture } from './construction-model-fixtures';

export async function mountDeckFittingsReview() {
  const catalog=await loadConstructionCatalog();
  window.shipbuilderReview?.close();
  return mountShipbuilderReview(deckFittingsFixture(catalog));
}

/** Uses actual mounted editor controls, native worker compilation and local saves. */
export async function checkDeckFittingsEditor() {
  const checks:string[]=[];
  const wait=async(predicate:()=>unknown,label:string)=>{
    const start=performance.now();
    while(!predicate()) {
      if(performance.now()-start>45000)throw new Error(`Timed out: ${label}`);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    checks.push(label);
  };
  await mountDeckFittingsReview();
  const source=()=>window.shipbuilderReview?.source;
  const compiled=()=>!document.querySelector('.sb-ledger h4 span');
  await wait(()=>source()&&compiled(),'all fixed fittings and connected paths compile and save');
  const launch=document.querySelector<HTMLButtonElement>('.sb-cmd');
  if(!launch||launch.disabled)throw new Error(`Review installation blocked: ${controls.warnings()}`);
  launch.click();
  await wait(()=>window.shipbuilderReview?.launched?.definition,'the complete fitting deck is launchable');
  const catalog=await loadConstructionCatalog();
  const searchlight=catalog.equipment.find(p=>p.id==='generic-static-searchlight')!;
  const bytes=await fetch(searchlight.modelUrl).then(r=>r.arrayBuffer());
  const jsonLength=new DataView(bytes).getUint32(12,true);
  const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength)));
  if(gltf.extensions?.KHR_lights_punctual||gltf.nodes?.some((n:any)=>n.extensions?.KHR_lights_punctual)||gltf.materials?.some((m:any)=>m.emissiveFactor?.some((v:number)=>v>0)))throw new Error('Searchlight contains active light or emissive material');
  if(searchlight.kind!=='deck-fitting'||searchlight.powerKw)throw new Error('Searchlight declares runtime capability');
  checks.push('searchlight is static, non-emissive equipment with no power or lighting behavior');
  await controls.tab('Fittings');
  document.querySelector<HTMLButtonElement>('.sb-slot.more')!.click();
  await controls.settled(()=>!!document.querySelector('.sb-drawer'),'fittings drawer');
  const card=[...document.querySelectorAll<HTMLButtonElement>('.sb-drawer .sb-slot')].find(b=>b.getAttribute('aria-label')?.includes('Three-rail railing'));
  if(!card)throw new Error('Railing is not discoverable in the fittings drawer');
  card.click();
  await controls.settled(()=>!document.querySelector('.sb-drawer'),'path part selected');
  const mirror=document.querySelector<HTMLButtonElement>('.sb-rail button[title^="Mirror"]');
  if(mirror?.getAttribute('aria-pressed')==='true')mirror.click();
  await controls.settled(()=>mirror?.getAttribute('aria-pressed')!=='true','single path placement');
  const before=JSON.stringify(source()!.construction.equipment);
  for(const point of [[-4,1,-6],[-4,1,-2],[-2,1,-2]] as Vec3[]) {
    controls.click(...await controls.screen(point));
    await controls.settled(()=>true,'path point');
  }
  if(JSON.stringify(source()!.construction.equipment)!==before)throw new Error('Draft path saved before finishing');
  checks.push('connected route stays a preview until finished');
  controls.key('Enter');
  await wait(()=>source()!.construction.equipment.length===JSON.parse(before).length+1&&compiled(),'Enter finishes one connected three-point railing');
  const path=source()!.construction.equipment.at(-1)!;
  if(path.path?.points.length!==3)throw new Error('Route points were not retained');
  if(document.querySelector<HTMLButtonElement>('.sb-cmd')?.disabled)throw new Error(`New path blocked: ${controls.warnings()}`);
  controls.key('z',{ctrlKey:true});
  await wait(()=>JSON.stringify(source()!.construction.equipment)===before&&compiled(),'one undo removes the complete path');
  controls.key('z',{ctrlKey:true,shiftKey:true});
  await wait(()=>source()!.construction.equipment.some(p=>p.id===path.id)&&compiled(),'redo restores stable path identity and points');
  controls.key('Escape');
  await controls.settled(()=>!document.querySelector('.sb-path-editor'),'clear railing selection');
  controls.click(...await controls.screen([-7.54,1.26,-13]));
  await wait(()=>document.querySelector('.sb-path-editor input[aria-label="Rope slack"]'),'a connected rope can be picked in the viewport');
  const slack=document.querySelector<HTMLInputElement>('.sb-path-editor input[aria-label="Rope slack"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slack,'0.35');
  slack.dispatchEvent(new Event('input',{bubbles:true})); slack.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
  await wait(()=>source()!.construction.equipment.find(p=>p.id==='review-rope')?.path?.slackM===.35&&compiled(),'rope slack edits save and compile');
  if(document.querySelector<HTMLButtonElement>('.sb-cmd')?.disabled)throw new Error(`Adjusted rope blocked: ${controls.warnings()}`);
  const {openConstructionStore}=await import('../../src/ships/constructionStore');
  const store=await openConstructionStore();
  try {
    const saved=JSON.parse((await store.load(source()!.id)).revision.sourceJson);
    if(JSON.stringify(saved)!==JSON.stringify(source()))throw new Error('Saved routes differ from the visible source');
    checks.push('reloaded source preserves path points and rope slack');
  } finally {store.close();}
  return {passed:checks.length,checks,catalogRevision:catalog.revision,source:source()};
}

/** Existing designs opt into new parts while retaining their exact source and undo history. */
export async function checkDeckCatalogUpgrade(retainedRevision:string) {
  const {createStarterSource}=await import('../../src/ships/constructionStarter');
  const retained=await loadConstructionCatalog(retainedRevision),latest=await loadConstructionCatalog();
  const template=createStarterSource(retained,'patrol'); template.name='Parts library upgrade review';
  window.shipbuilderReview?.close(); await mountShipbuilderReview(template,retained);
  const checks:string[]=[],source=()=>window.shipbuilderReview?.source;
  const wait=async(predicate:()=>unknown,label:string)=>{
    const start=performance.now();
    while(!predicate()){if(performance.now()-start>45000)throw new Error(`Timed out: ${label}`);await new Promise(r=>setTimeout(r,25));}
    checks.push(label);
  };
  await wait(()=>source()?.construction.catalogRevision===retainedRevision&&!document.querySelector('.sb-ledger h4 span'),'retained catalog source opens unchanged');
  const original=JSON.stringify(source()!.construction);
  document.querySelector<HTMLButtonElement>('.sb-meta')!.click();
  await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Update parts library'),'existing design offers the latest parts');
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Update parts library')!.click();
  await wait(()=>source()?.construction.catalogRevision===latest.revision&&!document.querySelector('.sb-ledger h4 span'),'parts update recompiles against the current catalog');
  const changed={...source()!.construction,catalogRevision:retainedRevision};
  if(JSON.stringify(changed)!==original)throw new Error('Library update changed authored fittings or hull geometry');
  checks.push('upgrade preserves exact authored pieces and fitted variants');
  controls.key('z',{ctrlKey:true});
  await wait(()=>JSON.stringify(source()?.construction)===original&&!document.querySelector('.sb-ledger h4 span'),'one undo restores the retained catalog and source');
  controls.key('z',{ctrlKey:true,shiftKey:true});
  await wait(()=>source()?.construction.catalogRevision===latest.revision&&!document.querySelector('.sb-ledger h4 span'),'redo restores the parts upgrade');
  return {passed:checks.length,checks};
}
