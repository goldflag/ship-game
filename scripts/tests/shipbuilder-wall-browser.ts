import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

// Run against Vite with: node --experimental-strip-types scripts/tests/shipbuilder-wall-browser.ts
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('.build/flush-fittings',{recursive:true});
const ready=()=>page.waitForFunction(()=>{const e=window.constructionEditor;return !!e?.result()?.definition&&e.result()?.revision===e.source().revision;},{},{timeout:120000});
try {
  await page.goto((process.env.SHIPBUILDER_URL??'http://127.0.0.1:5197')+'/scripts/diagnostics/shipbuilder.html');await ready();
  await page.evaluate(async()=>{
    window.shipbuilderReview?.close();
    const {createStarterSource}=await import('/src/ships/constructionStarter.ts');
    const {mountShipbuilderReview}=await import('/scripts/tests/shipbuilder-browser.tsx');
    const catalog=await(await fetch('/models/components/catalog.json')).json();
    await mountShipbuilderReview(createStarterSource(catalog,'fletcher-hull'));
  });
  await page.waitForFunction(()=>window.constructionEditor?.source().construction.primitives[0].kind==='custom-hull');await ready();
  await page.getByRole('tab',{name:'Outfit',exact:true}).click();
  await page.getByRole('tab',{name:'Doors & windows',exact:true}).click();
  await page.getByRole('button',{name:'Round porthole',exact:true}).click();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowUp');
  const diameter=page.locator('.sb-cursor input[aria-label="Diameter"]');
  await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('.sb-cursor input[aria-label="Diameter"]')?.value==='0.61');
  const point=await page.evaluate(()=>{
    const s=window.constructionEditor!.result()!.surfaces.filter(f=>f.normal[0]>.9&&Math.abs(f.normal[1])<.7).sort((a,b)=>Math.abs(a.vertices[0][2])-Math.abs(b.vertices[0][2]))[0];
    const point=s.vertices.reduce((a,v)=>a.map((n,k)=>n+v[k]/s.vertices.length),[0,0,0]);point[1]-=.5;return point;
  });
  const xy=await page.evaluate(async p=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');return controls.screen(p);},point);
  await page.mouse.move(...xy);await page.mouse.click(...xy);
  await page.waitForFunction(()=>window.constructionEditor!.source().construction.equipment.length===2);await ready();
  const original=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment);
  if(original.some(e=>e.wall?.widthM!==.61||e.wall?.heightM!==.61||!e.wall?.mirrorId))throw new Error('Mirrored placement lost dimensions or link');
  await page.keyboard.press('v');
  const pick=await page.evaluate(async p=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');return controls.screen(p);},original[0].position);
  await page.mouse.click(...pick);
  await page.waitForFunction(()=>!!document.querySelector('.sb-tag input[aria-label="Diameter"]'));
  await page.keyboard.press('ArrowRight');await ready();
  const resized=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment);
  if(resized.some(e=>e.wall?.widthM!==.71||e.wall?.heightM!==.71))throw new Error('Linked selection did not resize both partners');
  if(JSON.stringify(resized.map(e=>e.position))!==JSON.stringify(original.map(e=>e.position)))throw new Error('Arrow resized by moving the fitting');
  await page.keyboard.press('Control+z');await ready();
  const beforeMove=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment);
  await page.keyboard.press('PageDown');await ready();
  const moved=await page.evaluate(()=>window.constructionEditor!.source().construction.equipment);
  if(moved[0].position[1]>=beforeMove[0].position[1] || Math.abs(moved[0].position[0]+moved[1].position[0])>1e-6)throw new Error('Hull-following linked movement failed');
  if(await page.locator('input[aria-label="x"],input[aria-label="y"],input[aria-label="z"],[data-coords]').count())throw new Error('Coordinate controls remain');
  if((await page.locator('body').innerText()).includes('CG x'))throw new Error('Coordinate ledger row remains');
  await page.screenshot({path:'.build/flush-fittings/editor-wide.png'});
  await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'.build/flush-fittings/editor-narrow.png'});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS: sloped hull pointer placement, linked mirror, cursor and selection resizing, fine steps, undo, hull-following movement, absent coordinates, desktop layouts.');
} catch(error) {
  console.log((await page.locator('body').innerText()).slice(-4000));await page.screenshot({path:'.build/flush-fittings/browser-failure.png'});throw error;
} finally {await browser.close();}
