import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('.build/surface-fittings',{recursive:true});
const ready=()=>page.waitForFunction(()=>{const e=window.constructionEditor;return !!e?.result()?.definition&&e.result()?.revision===e.source().revision;},{},{timeout:45000});
const screen=(p:number[])=>page.evaluate(async p=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');return controls.screen(p);},p);
try {
  await page.goto((process.env.SHIPBUILDER_URL??'http://127.0.0.1:5217')+'/scripts/diagnostics/shipbuilder.html');await ready();
  await page.evaluate(async()=>{
    window.shipbuilderReview?.close();const {createStarterSource}=await import('/src/ships/constructionStarter.ts');const {mountShipbuilderReview}=await import('/scripts/tests/shipbuilder-browser.tsx');const catalog=await(await fetch('/models/components/catalog.json')).json();const s=createStarterSource(catalog,'blank');s.construction.primitives[0].size=[8,8,20];await mountShipbuilderReview(s);
  });await ready();
  await page.getByRole('tab',{name:'Outfit',exact:true}).click();
  await page.getByRole('tab',{name:'Access',exact:true}).click();
  const choose=async(name:string)=>{let button=page.getByRole('button',{name,exact:true});if(!await button.count()){await page.locator('.sb-slot.more').click();button=page.getByRole('button',{name,exact:true});}await button.click();};
  await choose('Surface rung ladder');
  if(await page.getByRole('button',{name:'Bulkhead ladder',exact:true}).count())throw new Error('Old fixed ladder remains in the shelf');
  const a=await screen([4,-1,0]),b=await screen([4,2,0]);
  await page.mouse.click(...a);
  if(await page.evaluate(()=>window.constructionEditor!.source().construction.equipment.length))throw new Error('First click committed a ladder');
  await page.mouse.move(...b,{steps:10});await page.screenshot({path:'.build/surface-fittings/ladder-preview.png'});await page.mouse.click(...b);
  await page.waitForFunction(()=>window.constructionEditor!.source().construction.equipment.length===2);await ready();
  const placed=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment);
  if(placed.some(p=>p.partId!=='generic-surface-ladder'||p.path?.points.length!==2))throw new Error('Two clicks did not make a ladder path');
  await page.keyboard.press('Control+z');await ready();
  if(await page.evaluate(()=>window.constructionEditor!.source().construction.equipment.length))throw new Error('Ladder undo was not atomic');
  await page.keyboard.press('Control+Shift+z');await ready();
  await page.getByRole('tab',{name:'Doors & windows',exact:true}).click();
  for(const [i,name] of ['Utility door','Watertight door','Windowed door'].entries()){
    await choose(name);const p=await screen([4,-1,-6+i*2]);await page.mouse.move(...p);await page.mouse.click(...p);await page.waitForFunction(n=>window.constructionEditor!.source().construction.equipment.length===n,4+i*2);await ready();
  }
  await page.getByRole('tab',{name:'Fixtures',exact:true}).click();
  for(const [i,name] of ['Louvered wall vent','Round wall vent'].entries()){
    await choose(name);const p=await screen([4,1,3+i*2]);await page.mouse.move(...p);await page.mouse.click(...p);await page.waitForFunction(n=>window.constructionEditor!.source().construction.equipment.length===n,10+i*2);await ready();
  }
  // Separate catalog fittings determine the rail count; height remains editable.
  const mirror=page.locator('.sb-rail button[aria-label^="Mirror"]');
  if(await mirror.getAttribute('aria-pressed')==='true')await mirror.click();
  await choose('Two-rail railing');
  const height=page.locator('input[aria-label="Railing height"]');
  await height.fill('1.5');await height.press('Tab');
  if(await page.getByLabel('Rail count',{exact:true}).count())throw new Error('Rail count remains an option');
  for(const point of [[3,4,-6],[3,4,0],[1,4,0]])await page.mouse.click(...await screen(point));
  await page.screenshot({path:'.build/surface-fittings/railing-preview.png'});
  await page.keyboard.press('Enter');await ready();
  const rail=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment.at(-1)!);
  if(rail.partId!=='generic-railing-two-rail'||rail.path?.heightM!==1.5||rail.path?.railCount!==2)throw new Error('Two-rail fitting was not saved');
  await height.fill('1.8');await height.press('Tab');await ready();
  await page.screenshot({path:'.build/surface-fittings/railing-selected.png'});
  await page.mouse.click(850,180);await page.keyboard.press('Control+z');await ready();
  if(await page.evaluate(()=>window.constructionEditor!.source().construction.equipment.at(-1)!.path!.heightM)!==1.5)throw new Error('Railing height undo failed');
  await choose('Three-rail railing');
  for(const point of [[-3,4,-6],[-3,4,0],[-1,4,0]])await page.mouse.click(...await screen(point));
  await page.keyboard.press('Enter');await ready();
  const three=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment.at(-1)!);
  if(three.partId!=='generic-railing'||three.path?.railCount!==3)throw new Error('Three-rail fitting inherited the previous count');
  if(await page.getByLabel('Rail count',{exact:true}).count())throw new Error('Selected railing still offers a count option');
  await choose('Surface rung ladder');await page.mouse.click(...await screen([4,-1,2]));await page.keyboard.press('Escape');
  if(await page.evaluate(()=>window.constructionEditor!.source().construction.equipment.length)!==14)throw new Error('Cancelled ladder changed source');
  await page.keyboard.press('v');await page.screenshot({path:'.build/surface-fittings/editor-wide.png'});await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'.build/surface-fittings/editor-narrow.png'});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS: surface ladder clicks, mirror, undo/redo, three doors and two wall vents, separate square-bar two/three-rail fittings, height undo and cancellation with real pointer input.');
} catch(e){console.log((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:'.build/surface-fittings/browser-failure.png'});throw e;}finally{await browser.close();}
