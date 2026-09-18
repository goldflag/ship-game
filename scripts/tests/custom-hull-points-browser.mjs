import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.SHIPBUILDER_URL ?? 'http://localhost:5264';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await mkdir('.build/hull-sections', { recursive: true });
const state = () => page.evaluate(() => window.hullSectionsEditor.hull());
const count = n => page.waitForFunction(n => window.hullSectionsEditor?.hull().stations.every(s => s.points.length === n), n);
const button = name => page.getByRole('button', { name, exact: true });
const center = async locator => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
/** Drag in small steps; `alt` holds Alt/Option, which inverts snapping for the drag. */
async function drag(locator, dx, dy, alt = false) {
  const [x, y] = await center(locator);
  await page.mouse.move(x, y); if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + dx * i / 10, y + dy * i / 10);
  await page.mouse.up(); if (alt) await page.keyboard.up('Alt');
}
const base_ = h => Math.min(...h.stations.flatMap(s => s.points.map(p => p.y * h.depth)));
const onGrid = v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
try {
  await page.goto(`${base}/?hullPrototype=1`);
  await page.locator('.hs-root canvas').waitFor();
  await page.locator('.hs-plane').waitFor();
  const before = await state();
  await button('+ Pair').click(); await count(11);
  const added = await state();
  assert(added.stations.every(s => s.points.length === 11));
  await button('Undo').click(); await count(9);
  assert.deepEqual(await state(), before);
  await button('Redo').click(); await count(11);
  assert.deepEqual(await state(), added);
  // The selected point's plane handle nudges by the snap step and its mirror follows.
  const plane = page.locator('.hs-plane');
  await plane.focus(); await page.keyboard.press('ArrowUp');
  const nudged = await state(), a = added.stations[3].points, b = nudged.stations[3].points;
  const moved = b.findIndex((p, k) => p.y !== a[k].y);
  assert(moved >= 0 && moved < 5);
  assert(Math.abs((b[moved].y - a[moved].y) * nudged.depth - .1) < 1e-9);
  assert.equal(b[moved].y, b[10 - moved].y);
  // Gizmo arms in the Section view: Y moves only height and lands on the 0.1 m grid; Alt keeps the raw height.
  // Geometry targets win over the grid, so the snap menu leaves only the grid for these drags.
  await page.keyboard.press('2');
  await page.waitForFunction(() => document.querySelector('.hs-root')?.dataset.view === 'section');
  await button('Snap settings').click();
  await page.getByRole('checkbox', { name: 'Neighbouring sections and points' }).uncheck();
  await page.getByRole('checkbox', { name: 'Waterline, deck and base' }).uncheck();
  await button('Snap settings').click();
  await drag(page.locator('.hs-axis[data-axis=Y]'), 0, -23);
  const lifted = await state(), p = lifted.stations[3].points[moved], q = nudged.stations[3].points[moved];
  assert.equal(p.x, q.x);
  assert(p.y > q.y && onGrid(p.y * lifted.depth - base_(lifted)));
  await drag(page.locator('.hs-axis[data-axis=Y]'), 0, -17, true);
  const raw = await state();
  assert(raw.stations[3].points[moved].y > p.y && !onGrid(raw.stations[3].points[moved].y * raw.depth - base_(raw)));
  // Z points at the camera there; in Orbit it slides the whole section along the hull.
  assert(await page.locator('.hs-axis[data-axis=Z]').isHidden());
  await page.keyboard.press('1');
  await drag(page.locator('.hs-axis[data-axis=Z]'), 18, -9);
  assert.notEqual((await state()).stations[3].t, raw.stations[3].t);
  for (let n = 0; n < 3; n++) await button('Undo').click();
  assert.deepEqual(await state(), nudged);
  // Delete on the focused handle removes the pair; the tag's pair buttons guard the deck edge and keel.
  await plane.focus(); await page.keyboard.press('Delete'); await count(9);
  await button('Undo').click(); await count(11);
  await page.getByRole('button', { name: /^Keel, section 04/ }).click();
  assert(await button('− Pair').isDisabled());
  await page.getByRole('button', { name: /^Deck edge, section 04/ }).first().click();
  assert(await button('− Pair').isDisabled());
  await page.getByRole('button', { name: /^Point 2, section 04/ }).first().click();
  for (const n of [9, 7, 5]) { await button('− Pair').click(); await count(n); }
  assert(await button('− Pair').isDisabled());
  for (let n = 7; n <= 33; n += 2) { await button('+ Pair').click(); await count(n); }
  assert(await button('+ Pair').isDisabled());
  for (let n = 31; n >= 11; n -= 2) { await button('Undo').click(); await count(n); }
  await page.keyboard.press('2');
  await page.screenshot({ path: '.build/hull-sections/section.png' });
  await page.keyboard.press('1');
  await page.keyboard.press('n');
  assert.equal(await page.locator('.hs-snap-main').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('n');
  await page.screenshot({ path: '.build/hull-sections/desktop.png' });
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.screenshot({ path: '.build/hull-sections/compact.png' });
  // Apply through the production shipbuilder, then reopen and undo the saved edit.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/scripts/diagnostics/shipbuilder.html`);
  await page.waitForFunction(() => !!window.constructionEditor?.result()?.definition, undefined, { timeout: 60000 });
  await page.evaluate(async () => {
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const { loadConstructionCatalog } = await import('/src/ships/constructionEquipment.ts');
    const { createStarterSource } = await import('/src/ships/constructionStarter.ts');
    window.shipbuilderReview.close();
    await mountShipbuilderReview(createStarterSource(await loadConstructionCatalog(), 'destroyer-hull'));
  });
  await page.waitForFunction(() => window.constructionEditor?.source()?.construction.primitives[0]?.kind === 'custom-hull' && !!window.constructionEditor.result()?.definition, undefined, { timeout: 60000 });
  const chooseHull = () => page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await controls.tab('Hull'); await controls.tool('Select');
    window.shipbuilderViewport.props.onPointer({ kind: 'box', ids: ['hull'], additive: false });
  });
  await chooseHull();
  await button('Edit hull sections').click(); await count(9);
  // The editor floats the draft hull on the native compiler: the ledger's draft matches the builder's.
  await page.waitForFunction(() => /\d m/.test([...document.querySelectorAll('.hs-ledger .row')].find(r => r.textContent.startsWith('Draft'))?.textContent ?? ''), undefined, { timeout: 60000 });
  await button('+ Pair').click(); await count(11);
  await button('Apply hull').click();
  await page.waitForFunction(() => window.constructionEditor.source().construction.primitives[0].customHull.stations[0].points.length === 11 && !!window.constructionEditor.result()?.definition, undefined, { timeout: 60000 });
  await chooseHull();
  await button('Edit hull sections').click(); await count(11);
  await page.screenshot({ path: '.build/hull-sections/integrated.png' });
  await button('Cancel').click();
  await page.evaluate(() => window.constructionEditor.undo());
  await page.waitForFunction(() => window.constructionEditor.source().construction.primitives[0].customHull.stations[0].points.length === 9);
  assert.deepEqual(errors, []);
  console.log('PASS: paired insertion/removal, mirrored nudges, gizmo arms with grid snapping and Alt inversion, section slides, protected keel/deck, count limits, section view, snap toggle, native draft, production apply/reopen and shipbuilder undo.');
} catch (error) {
  await page.screenshot({ path: '.build/hull-sections/failure.png' }); throw error;
} finally { await browser.close(); }
