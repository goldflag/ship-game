// Run against this checkout’s Vite server: node scripts/tests/freeform-mesh-browser.mjs <url>
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('.build/freeform',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('/scripts/diagnostics/construction-check.html',process.argv[2]??'http://127.0.0.1:5173').href);
async function mount(kind){
 await page.evaluate(async(kind)=>{
  window.shipbuilderReview?.close();
  const {mountShipbuilderReview}=await import('/scripts/tests/shipbuilder-browser.tsx');
  const {createStarterSource}=await import('/src/ships/constructionStarter.ts');
  const {loadConstructionCatalog}=await import('/src/ships/constructionEquipment.ts');
  const {openConstructionStore}=await import('/src/ships/constructionStore.ts');
  const catalog=await loadConstructionCatalog(),source=createStarterSource(catalog,'blank');source.construction.primitives[0]={id:'shape',kind,size:[8,8,8],position:[0,0,0],rotationDeg:0};
  await mountShipbuilderReview(source,catalog,()=>openConstructionStore({name:'freeform-mesh-browser-'+crypto.randomUUID()}));
 },kind);
 await page.waitForSelector('.sb-canvas canvas');await page.waitForFunction(()=>!!window.constructionEditor?.result()?.definition);await page.waitForFunction(()=>document.querySelector('.sb-save')?.textContent?.includes('Saved'));
 await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Control+a');await page.waitForTimeout(100);await page.keyboard.press('d');
 await page.waitForSelector('.sb-freeform-tools');
}
try{
 for(const kind of ['prism','wedge','corner','cylinder','half-cylinder','quarter-cylinder','cone','hemisphere','half-hemisphere','quarter-hemisphere']){
  await mount(kind);
  assert.ok(await page.evaluate(()=>!!window.constructionEditor.source().construction.primitives[0].mesh),kind);
  if(['cylinder','half-cylinder','quarter-cylinder','cone','hemisphere','half-hemisphere','quarter-hemisphere'].includes(kind)){
   await page.getByRole('button',{name:'Ring',exact:true}).click();
   const before=await page.evaluate(()=>window.constructionEditor.source().construction.primitives[0].mesh.vertices);
   await page.getByRole('button',{name:'Move local Y',exact:true}).press('ArrowUp');
   assert.notDeepEqual(await page.evaluate(()=>window.constructionEditor.source().construction.primitives[0].mesh.vertices),before,'ring gizmo changes source vertices');
   await page.keyboard.press('Control+z');
   assert.deepEqual(await page.evaluate(()=>window.constructionEditor.source().construction.primitives[0].mesh.vertices),before,'ring movement is one undoable edit');
   await page.getByRole('button',{name:'Add ring above',exact:true}).click();
   await page.waitForTimeout(700);
   assert.equal(await page.locator('[aria-label="Control ring"]').inputValue(),'1');
   await page.getByRole('button',{name:'Remove ring',exact:true}).click();
  }
  if(kind==='prism'){
   await page.getByRole('button',{name:'Add outline point',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.constructionEditor.source().construction.primitives[0].mesh.rings[0].length),9);
   await page.getByRole('button',{name:'Remove outline point',exact:true}).click();
  }
  await page.waitForFunction(()=>{const e=window.constructionEditor;return e?.result()?.revision===e?.source().revision;});
  const error=await page.evaluate(()=>window.constructionEditor.result().diagnostics.filter(d=>d.severity==='error'));assert.deepEqual(error,[],kind);
  await page.screenshot({path:`.build/freeform/${kind}.png`});
  await page.keyboard.press('d');await page.waitForSelector('.sb-freeform-tools',{state:'detached'});
  await page.keyboard.press('d');await page.waitForSelector('.sb-freeform-tools');
  await page.keyboard.press('Escape');await page.waitForSelector('.sb-freeform-tools',{state:'detached'});
  console.log('PASS',kind);
 }
 await mount('half-hemisphere');await page.setViewportSize({width:740,height:900});await page.screenshot({path:'.build/freeform/narrow.png'});
 assert.deepEqual(errors,[]);console.log('PASS no browser errors');
}catch(e){await page.screenshot({path:'.build/freeform/failure.png'});console.log('ERRORS',errors);console.log(await page.evaluate(()=>({text:document.body.innerText,source:window.constructionEditor?.source(),errors:window.constructionEditor?.result()?.diagnostics})));throw e;}finally{await browser.close();}
