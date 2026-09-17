import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

// Run after starting Vite: bun scripts/tests/shipbuilder-balcony-browser.ts
// Uses an isolated browser library; the repository playground source is read-only.
const baseUrl = process.env.SHIPBUILDER_URL ?? 'http://localhost:5196';

const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('.build/balcony-review',{recursive:true});
try {
  await page.goto(baseUrl + '/scripts/diagnostics/shipbuilder.html');
  console.log('Loaded diagnostic page');
  await page.waitForFunction(()=>!!window.constructionEditor?.result()?.definition);
  console.log('Starter compiled');
  await page.evaluate(async()=>{
    window.shipbuilderReview?.close();
    const fixture=await (await fetch('/assets/ships/balcony-playground/blueprint.json')).json();
    fixture.id='balcony-browser-'+crypto.randomUUID();fixture.revision=crypto.randomUUID();
    const {mountShipbuilderReview}=await import('/scripts/tests/shipbuilder-browser.tsx');
    await mountShipbuilderReview(fixture);
  });
  await page.waitForFunction(()=>window.constructionEditor?.source().construction.primitives.some(p=>p.id==='railing-balcony') && !!window.constructionEditor?.result()?.definition);
  console.log('Fixture compiled');
  const palette = await page.locator('.sb-hotbar .sb-slot').evaluateAll(items => items.slice(0, 2).map(item => item.getAttribute('aria-label')));
  if (JSON.stringify(palette) !== JSON.stringify(['Freeform hull', 'Balcony'])) throw new Error('Hull palette order: ' + JSON.stringify(palette));
  const position=await page.evaluate(async()=>{const {controls}=await import('/scripts/tests/shipbuilder-browser.tsx');return controls.screen([4.3,5.54,-2]);});
  await page.mouse.click(...position);
  await page.getByRole('button',{name:'Edit balcony outline',exact:true}).click();
  console.log('Outline open');
  const grid = page.getByRole('group', { name: 'Balcony grid step' });
  if (await grid.getByRole('button', { name: '0.25 m', exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('Grid must default to 0.25 m');
  const options = await grid.getByRole('button').evaluateAll(items => items.map(item => item.getAttribute('aria-label')));
  if (JSON.stringify(options) !== JSON.stringify(['No grid', '0.125 m', '0.25 m', '0.5 m', '1 m'])) throw new Error('Unexpected grid options');
  for (const name of options) {
    await grid.getByRole('button', { name: name!, exact: true }).click();
    if (await grid.locator('[aria-pressed=true]').count() !== 1 || await grid.getByRole('button', { name: name!, exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('Grid buttons must select exactly one step');
  }
  await grid.getByRole('button', { name: '0.25 m', exact: true }).click();
  if (await page.locator('.sb-balcony').getByText(/^Point(?: X| Z)?$/).count()) throw new Error('Point coordinate row remains');
  const edge = page.getByRole('button', { name: 'Edge 1 to 2: railing', exact: true });
  await edge.focus();
  if (await edge.evaluate(item => getComputedStyle(item).outlineStyle) !== 'none') throw new Error('Native SVG focus outline remains');
  await page.getByRole('button',{name:'Solid wall',exact:true}).click();
  await page.waitForFunction(()=>window.constructionEditor?.source().construction.primitives.find(p=>p.id==='railing-balcony')?.balcony?.points[0].edge==='wall');
  await page.getByRole('button',{name:'Add point after 1',exact:true}).click();
  console.log('Point added');
  const handle=page.getByRole('button',{name:'Outline point 2',exact:true});const box=await handle.boundingBox();
  if(!box)throw new Error('Point handle missing');
  const before=await page.evaluate(()=>JSON.stringify(window.constructionEditor!.source().construction));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-12,box.y+box.height/2+15,{steps:8});await page.mouse.up();
  await page.waitForFunction(before=>JSON.stringify(window.constructionEditor!.source().construction)!==before,before);
  const snapped = await page.evaluate(() => { const primitive = window.constructionEditor!.source().construction.primitives.find(p => p.id === 'railing-balcony')!; const point = primitive.balcony!.points[1]; return [point.x * primitive.size[0], point.z * primitive.size[2]].every(value => Math.abs(value / .25 - Math.round(value / .25)) < 1e-8); });
  if (!snapped) throw new Error('Dragged point missed the quarter-metre grid');
  await page.evaluate(()=>window.constructionEditor!.undo());
  await page.waitForFunction(before=>JSON.stringify(window.constructionEditor!.source().construction)===before,before);
  await page.evaluate(()=>window.constructionEditor!.redo());
  await page.waitForFunction(before=>JSON.stringify(window.constructionEditor!.source().construction)!==before,before);
  const after=await page.evaluate(()=>JSON.stringify(window.constructionEditor!.source().construction));
  const moved=await handle.boundingBox();if(!moved)throw new Error('Moved handle missing');
  await page.mouse.move(moved.x+3,moved.y+3);await page.mouse.down();await page.mouse.move(moved.x+30,moved.y+30,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
  const cancelled=await page.evaluate(()=>JSON.stringify(window.constructionEditor!.source().construction));if(cancelled!==after)throw new Error('Cancelled drag changed source');
  await grid.getByRole('button', { name: 'No grid', exact: true }).click();
  if (await page.locator('.sb-balcony-grid').count()) throw new Error('No grid still draws grid lines');
  await handle.focus(); await page.keyboard.press('ArrowRight');
  const freeNudge = await page.evaluate(() => { const primitive = window.constructionEditor!.source().construction.primitives.find(p => p.id === 'railing-balcony')!; return primitive.balcony!.points[1].x * primitive.size[0]; });
  const previous = JSON.parse(after).primitives.find((p: { id: string }) => p.id === 'railing-balcony');
  if (Math.abs(freeNudge - previous.balcony.points[1].x * previous.size[0] - .1) > 1e-8) throw new Error('No-grid nudge still snapped');
  await page.evaluate(()=>window.constructionEditor!.undo());
  await grid.getByRole('button', { name: '0.25 m', exact: true }).click();
  await page.waitForFunction(()=>{const e=window.constructionEditor;return e?.result()?.revision===e?.source().revision && !!e?.result()?.definition;});
  await page.evaluate(()=>window.constructionEditor!.flush());
  await page.screenshot({path:'.build/balcony-review/desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.build/balcony-review/mobile.png'});
  if(await page.locator('.sb-move-handles').isVisible())throw new Error('Move handles overlap the outline editor');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw new Error('Mobile document overflow');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS: palette order, grid choices/default/snapping/no-grid, removed coordinate row, no native focus outline, edge change, add point, real pointer drag, one-step undo/redo, Escape cancellation, native compile, save, desktop/mobile capture.');
} catch(error) { console.log(await page.locator('body').innerText()); console.log(errors); await page.screenshot({path:'.build/balcony-review/failure.png'}); throw error; } finally {await browser.close();}
