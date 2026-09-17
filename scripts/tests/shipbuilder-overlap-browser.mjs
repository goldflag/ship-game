// Run against this checkout's Vite server. Local test storage requires no account.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('.build/overlap-review', {recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
let phase="mount"; page.setDefaultTimeout(10000);
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(new URL('/scripts/diagnostics/construction-check.html',process.argv[2]??'http://127.0.0.1:5205').href);
  await page.evaluate(async()=>{
    const {mountShipbuilderReview,controls}=await import('/scripts/tests/shipbuilder-browser.tsx');
    const {loadConstructionCatalog}=await import('/src/ships/constructionEquipment.ts');
    const {createStarterSource}=await import('/src/ships/constructionStarter.ts');
    const {openConstructionStore}=await import('/src/ships/constructionStore.ts');
    const c=await loadConstructionCatalog(),s=createStarterSource(c,'blank');
    s.construction.primitives=[{id:'deck',kind:'box',size:[12,2,12],position:[0,0,0],rotationDeg:0}];
    await mountShipbuilderReview(s,c,()=>openConstructionStore({name:'overlap-placement-review'}));
    await controls.settled(()=>!!window.shipbuilderReview?.source,'source');
    await controls.tool('Place');
    controls.key('n');
  });
  await page.waitForFunction(()=>!document.querySelector('.sb-ledger h4 span'));
  const point=await page.evaluate(async()=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');return controls.screen([.02,1,0]);});
  phase="initial hover"; await page.mouse.move(...point);
  await page.waitForFunction(()=>document.querySelector('[data-coords]')?.textContent.includes('10%'));
  const before=await page.evaluate(()=>window.constructionEditor.source().revision);
  const color=await page.evaluate(()=>window.shipbuilderViewport.ghost.children[0].material.color.getHexString());
  if(color!=='ffb5a6')throw new Error('Invalid preview must be salmon');
  await page.screenshot({path:'.build/overlap-review/blocked-desktop.png'});
  await page.mouse.click(...point);await page.waitForTimeout(150);
  if(await page.evaluate(()=>window.constructionEditor.source().revision)!==before)throw new Error('Rejected placement changed history');
  // Turn mirror off: the exact same seating is now valid.
  await page.evaluate(async()=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');controls.key('m');});
  await page.mouse.move(point[0]+1,point[1]);
  phase='unmirror'; await page.waitForFunction(()=>!window.shipbuilderViewport.placementBlocked);
  await page.mouse.click(...point);
  phase='valid click'; await page.waitForFunction(()=>window.constructionEditor.source().construction.primitives.length===2);
  await page.keyboard.press('Meta+z');
  phase='undo'; await page.waitForFunction(()=>window.constructionEditor.source().construction.primitives.length===1);
  await page.evaluate(async()=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');controls.key('m');});
  await page.setViewportSize({width:900,height:700});
  const compact=await page.evaluate(async()=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');return controls.screen([.02,1,0]);});
  phase='compact hover'; await page.mouse.move(...compact);
  await page.waitForFunction(()=>document.querySelector('[data-coords]')?.textContent.includes('10%'));
  await page.screenshot({path:'.build/overlap-review/blocked-compact.png'});
  if(errors.length)throw new Error(errors.join('; '));
  console.log('Passed: invalid mirrored preview, rejection without history, valid seating, undo, desktop and compact feedback.');
} catch(error) { console.error(phase, errors, await page.evaluate(()=>({blocked:window.shipbuilderViewport?.placementBlocked, position:window.shipbuilderViewport?.ghostPosition, coords:document.querySelector('[data-coords]')?.textContent,mirror:!!window.shipbuilderViewport?.props.scene.placementMirror})));  throw error; } finally {await browser.close();}
