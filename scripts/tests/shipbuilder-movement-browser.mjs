// Run against this checkout's Vite server: bun scripts/tests/shipbuilder-movement-browser.mjs http://127.0.0.1:5205
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('.build/move-review', { recursive: true });
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:960}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const checks=[];
page.setDefaultTimeout(15000);
const assert=(v,label)=>{if(!v)throw new Error(label);checks.push(label);};
try {
await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2] ?? 'http://127.0.0.1:5200').href);
await page.evaluate(async()=>{
 const {mountShipbuilderReview,controls}=await import('/scripts/tests/shipbuilder-browser.tsx');
 const {loadConstructionCatalog}=await import('/src/ships/constructionEquipment.ts');
 const {createStarterSource}=await import('/src/ships/constructionStarter.ts');
 const c=await loadConstructionCatalog(),s=createStarterSource(c,'blank');
 s.name='Block movement review';
 s.construction.primitives=[{id:'a',kind:'box',size:[4,4,4],position:[0,0,0],rotationDeg:0},{id:'b',kind:'box',size:[4,4,4],position:[6,0,0],rotationDeg:0}];
 const {openConstructionStore}=await import('/src/ships/constructionStore.ts');
 await mountShipbuilderReview(s,c,()=>openConstructionStore({name:'overlap-review'}));
 await controls.settled(()=>!!window.shipbuilderReview?.source,'source');
 await controls.tool('Select');
 controls.click(...await controls.screen([0,2,0]));
});
await page.waitForSelector('.sb-move-handles:not([hidden])');
await page.waitForFunction(()=>!document.querySelector('.sb-ledger h4 span'));
const pos=()=>page.evaluate(()=>window.shipbuilderViewport.props.scene.source.construction.primitives.find(p=>p.id==='a').position);
const revision=()=>page.evaluate(()=>window.shipbuilderViewport.props.scene.source.revision);
const waitPos=async(x,y=0,z=0)=>page.waitForFunction(([x,y,z])=>{const p=window.shipbuilderViewport.props.scene.source.construction.primitives.find(p=>p.id==='a').position;return [x,y,z].every((v,k)=>Math.abs(v-p[k])<1e-6);},[x,y,z]);
const x=page.getByRole('button',{name:'Move selection X',exact:true});
assert(await x.isVisible(),'Selected blocks show the X gizmo');
assert(await page.getByRole('button',{name:'Move selection Y',exact:true}).isVisible(),'Selected blocks show the Y gizmo');
assert(await page.getByRole('button',{name:'Move selection Z',exact:true}).isVisible(),'Selected blocks show the Z gizmo');
const drag=async(delta,finish='commit',axis='X')=>{
 const b=await page.getByRole('button',{name:`Move selection ${axis}`,exact:true}).boundingBox();
 const screen=await page.evaluate(async delta=>{
  const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');
  const p=window.shipbuilderViewport.props.scene.source.construction.primitives.find(p=>p.id==='a').position;
  return [await controls.screen(p),await controls.screen(p.map((v,k)=>v+delta[k]))];
 },delta);
 const [from,to]=screen, px=b.x+b.width/2,py=b.y+b.height/2;
 await page.mouse.move(px,py);await page.mouse.down();
 await page.mouse.move(px+to[0]-from[0],py+to[1]-from[1],{steps:8});
 await page.waitForTimeout(80);
 if(finish==='escape')await page.keyboard.press('Escape');
 else if(finish==='blocked')assert((await page.locator('[data-coords]').textContent()).includes('Hull overlap limit'),'Collision feedback appears during a blocked drag');
 else if(finish==='return')await page.mouse.move(px,py);
 await page.mouse.up();await page.waitForTimeout(100);
};
await drag([10,0,0],'blocked');await waitPos(5.6);checks.push('Real pointer capture clamps a fast X drag at 90% overlap');
await page.keyboard.press('Meta+z');await waitPos(0);checks.push('One undo restores the entire drag');
await page.keyboard.press('Meta+Shift+z');await waitPos(5.6);checks.push('Redo restores the stopped position');
const before=await revision();await x.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);
assert(await revision()===before,'Blocked focused-axis nudge creates no undo entry');
await page.keyboard.press('ArrowLeft');await waitPos(4.6);checks.push('Focused-axis arrow moves exactly one metre');
await drag([0,3,0],'escape','Y');await waitPos(4.6);checks.push('Escape cancels a real Y drag without moving the block');
await drag([0,3,0],'return','Y');await waitPos(4.6);checks.push('Returning the pointer to its origin leaves no move');
assert(await page.locator('[data-tag="piece-a"] input[aria-label="x"], [data-tag="piece-a"] input[aria-label="y"], [data-tag="piece-a"] input[aria-label="z"]').count()===0,'Selection omits coordinate inputs');
// Body keyboard shortcuts use the same guard.
await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('ArrowRight');await waitPos(5.6);
await page.keyboard.press('ArrowRight');await waitPos(5.6);
checks.push('General keyboard nudges cannot exceed 90% overlap');
await page.keyboard.press('PageUp');await waitPos(5.6,1);checks.push('An intersecting block can slide vertically');
await page.keyboard.press('Meta+z');await waitPos(5.6);
await page.waitForFunction(()=>!document.querySelector('.sb-ledger h4 span'));await page.waitForTimeout(150);
await page.screenshot({path:'.build/move-review/final-desktop.png'});
await page.setViewportSize({width:900,height:700});await page.waitForTimeout(150);await page.screenshot({path:'.build/move-review/final-compact.png'});
assert(!errors.length,`No browser errors: ${errors.join('; ')}`);
console.log(JSON.stringify({checks,position:await pos()},null,2));
} finally { await browser.close(); }
