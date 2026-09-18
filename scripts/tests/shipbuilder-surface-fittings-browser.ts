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
  await page.getByRole('tab',{name:'Fittings',exact:true}).click();
  await page.getByRole('tab',{name:'Deck gear',exact:true}).click();
  const choose=async(name:string)=>{let button=page.getByRole('button',{name,exact:true});if(!await button.count()){await page.locator('.sb-slot.more').click();button=page.getByRole('button',{name,exact:true});}await button.click();};
  await choose('Surface rung ladder');
  if(await page.getByRole('button',{name:'Bulkhead ladder',exact:true}).count())throw new Error('Old fixed ladder remains in the shelf');
  const a=await screen([4,-1,0]),b=await screen([4,2,0]);
  await page.mouse.move(...a);await page.mouse.down();await page.mouse.move(...b,{steps:10});await page.screenshot({path:'.build/surface-fittings/ladder-drag.png'});await page.mouse.up();
  await page.waitForFunction(()=>window.constructionEditor!.source().construction.equipment.length===2);await ready();
  const placed=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment);
  if(placed.some(p=>p.partId!=='generic-surface-ladder'||p.path?.points.length!==2))throw new Error('Drag did not make a ladder path');
  await page.keyboard.press('Control+z');await ready();
  if(await page.evaluate(()=>window.constructionEditor!.source().construction.equipment.length))throw new Error('Ladder undo was not atomic');
  await page.keyboard.press('Control+Shift+z');await ready();
  await page.getByRole('tab',{name:'Doors & windows',exact:true}).click();
  for(const [i,name] of ['Utility door','Watertight door','Windowed door'].entries()){
    await choose(name);const p=await screen([4,-1,-6+i*2]);await page.mouse.move(...p);await page.mouse.click(...p);await page.waitForFunction(n=>window.constructionEditor!.source().construction.equipment.length===n,4+i*2);await ready();
  }
  await page.getByRole('tab',{name:'Deck gear',exact:true}).click();
  for(const [i,name] of ['Louvered wall vent','Round wall vent'].entries()){
    await choose(name);const p=await screen([4,1,3+i*2]);await page.mouse.move(...p);await page.mouse.click(...p);await page.waitForFunction(n=>window.constructionEditor!.source().construction.equipment.length===n,10+i*2);await ready();
  }
  await page.keyboard.press('v');await page.screenshot({path:'.build/surface-fittings/editor-wide.png'});await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'.build/surface-fittings/editor-narrow.png'});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS: surface ladder drag, mirror, undo/redo, three doors and two wall vents placed with real pointer input.');
} catch(e){console.log((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:'.build/surface-fittings/browser-failure.png'});throw e;}finally{await browser.close();}
