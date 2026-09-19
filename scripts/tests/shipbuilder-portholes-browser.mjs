// bun scripts/tests/shipbuilder-portholes-browser.mjs <vite-url>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

await mkdir('.build/porthole-review', { recursive: true });
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:960}});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2] ?? 'http://127.0.0.1:5173').href);
 await page.evaluate(async()=>{
  const {loadConstructionCatalog}=await import('/src/ships/constructionEquipment.ts');
  const {createStarterSource}=await import('/src/ships/constructionStarter.ts');
  const {openConstructionStore}=await import('/src/ships/constructionStore.ts');
  const {mountShipbuilderReview}=await import('/scripts/tests/shipbuilder-browser.tsx');
  const catalog=await loadConstructionCatalog(),source=createStarterSource(catalog,'blank');
  source.name='Porthole review';source.construction.primitives[0].size=[3,2,5];
  source.construction.equipment=[{id:'porthole',partId:'generic-rimmed-porthole',position:[1.5,0,0],bearingDeg:90,paint:'naval-gray',wall:{version:1,widthM:.6,heightM:.6}}];
  await mountShipbuilderReview(source,catalog,()=>openConstructionStore({name:'porthole-review'}));
 });
 await page.waitForFunction(()=>window.constructionEditor?.result()?.definition);
 await page.evaluate(async()=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');await controls.tab('Outfit');await controls.tool('Select');controls.click(...await controls.screen([1.5,0,0]));});
 const scale=page.getByRole('spinbutton',{name:'Scale',exact:true});await scale.waitFor();
 if(await page.getByRole('spinbutton',{name:/Width|Height|Diameter/}).count())throw Error('Independent dimensions visible');
 await scale.fill('1.5');await scale.press('Enter');
 await page.waitForFunction(()=>Math.abs(window.constructionEditor.source().construction.equipment[0].wall.widthM-.9)<1e-6);
 await page.waitForFunction(()=>!!window.constructionEditor.result()?.definition);
 const wall=await page.evaluate(()=>window.constructionEditor.source().construction.equipment[0].wall);
 if(Math.abs(wall.heightM-.9)>1e-6)throw Error('Scale distorted porthole');
 await page.waitForFunction(()=>document.querySelector('input[aria-label=Scale]')?.value==='1.5');
 // A second edit uses the catalog size, never the already-resized installation.
 await scale.fill('1.25');await scale.press('Enter');
 await page.waitForFunction(()=>window.constructionEditor.source().construction.equipment[0].wall.widthM===.75);
 await page.waitForFunction(()=>document.querySelector('input[aria-label=Scale]')?.value==='1.25');
 await page.waitForFunction(()=>!!window.constructionEditor.result()?.definition);
 await scale.fill('1.5');await scale.press('Enter');
 await page.waitForFunction(()=>Math.abs(window.constructionEditor.source().construction.equipment[0].wall.widthM-.9)<1e-6);
 await page.waitForFunction(()=>document.querySelector('input[aria-label=Scale]')?.value==='1.5');
 await page.waitForFunction(()=>!!window.constructionEditor.result()?.definition);
 await page.screenshot({path:'.build/porthole-review/editor-desktop.png'});
 await page.keyboard.press('ArrowUp');
 await page.waitForFunction(()=>window.constructionEditor.source().construction.equipment[0].wall.widthM===1);
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>Math.abs(window.constructionEditor.source().construction.equipment[0].wall.widthM-.9)<1e-6);
 await page.setViewportSize({width:900,height:700});
 await page.screenshot({path:'.build/porthole-review/editor-compact.png'});
 await page.getByRole('tab',{name:'Doors & windows',exact:true}).click();
 await page.getByRole('button',{name:'Rimmed porthole',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.sb-cursor input[aria-label=Scale]'));
 await page.locator('.sb-cursor input[aria-label=Scale]').fill('2');await page.locator('.sb-cursor input[aria-label=Scale]').press('Enter');
 if(await page.getByRole('spinbutton',{name:/Width|Height|Diameter/}).count())throw Error('Placement exposes independent dimensions');
 await page.screenshot({path:'.build/porthole-review/placement-compact.png'});
 await page.waitForFunction(()=>!!window.constructionEditor.result()?.definition);
 await page.evaluate(async()=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');await controls.tool('Select');controls.key('Escape'); const v=window.shipbuilderViewport;v.controls.enableDamping=false;v.controls.target.set(1.5,0,0);v.camera.position.set(3.8,.35,-.6);v.camera.zoom=1;v.camera.updateProjectionMatrix();v.controls.update();});
 await page.locator('.sb-canvas canvas').screenshot({path:'.build/porthole-review/installed-quarter.png'});
 await page.evaluate(()=>{const v=window.shipbuilderViewport;v.camera.position.set(3.8,0,0);v.controls.update();});
 await page.locator('.sb-canvas canvas').screenshot({path:'.build/porthole-review/installed-front.png'});
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Passed: uniform scale field, native compile, keyboard resize, undo, palette placement, desktop/compact captures');
} finally {await browser.close()}
