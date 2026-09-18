import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.SHIPBUILDER_URL ?? 'http://localhost:5264';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await mkdir('.build/cross-section', { recursive: true });
try {
  await page.goto(`${base}/?hullPrototype=1`);
  const select = page.getByRole('combobox', { name: 'Outline point', exact: true });
  await select.waitFor();
  const count = n => page.waitForFunction(n => document.querySelectorAll('.hp-cross .hp-handle').length === n, n);
  const state = () => page.locator('.hp-state pre').textContent().then(JSON.parse);
  const before = await state();
  await page.getByRole('button', { name: 'Add pair', exact: true }).click(); await count(11);
  const added = await state();
  assert(added.stations.every(s => s.points.length === 11));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await count(9);
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await count(11);
  assert.deepEqual(await state(), added);
  // Newly inserted points can be nudged and dragged, including their mirror.
  const index = Number(await select.inputValue());
  const handle = page.getByRole('button', { name: `Outline point ${index + 1}`, exact: true });
  await handle.focus(); await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'button');
  const nudged = await state(), a = added.stations[3].points, b = nudged.stations[3].points;
  assert(Math.abs((b[index].y - a[index].y) * nudged.depth - .1) < 1e-9);
  assert.equal(b[index].y, b[10 - index].y);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2 - 5, { steps: 4 }); await page.mouse.up();
  assert.notDeepEqual(await state(), nudged);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), nudged);
  await handle.focus(); await page.keyboard.press('Delete'); await count(9);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await count(11);
  await select.selectOption({ value: '5' });
  assert(await page.getByRole('button', { name: 'Remove pair', exact: true }).isDisabled());
  await select.selectOption({ value: '0' });
  assert(await page.getByRole('button', { name: 'Remove pair', exact: true }).isDisabled());
  await select.selectOption({ value: '1' });
  for (const n of [9, 7, 5]) { await page.getByRole('button', { name: 'Remove pair', exact: true }).click(); await count(n); }
  assert(await page.getByRole('button', { name: 'Remove pair', exact: true }).isDisabled());
  for (let n = 7; n <= 33; n += 2) { await page.getByRole('button', { name: 'Add pair', exact: true }).click(); await count(n); }
  assert(await page.getByRole('button', { name: 'Add pair', exact: true }).isDisabled());
  // Undo can reduce the count below the selected index without breaking controls.
  await select.selectOption({ value: '32' });
  for (let n = 31; n >= 11; n -= 2) { await page.getByRole('button', { name: 'Undo', exact: true }).click(); await count(n); }
  assert(Number(await select.inputValue()) <= 10);
  await select.selectOption({ value: '2' });
  await page.screenshot({ path: '.build/cross-section/desktop.png' });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.locator('.hp-point-actions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.build/cross-section/compact.png' });
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
  await page.getByRole('button', { name: 'Edit hull sections', exact: true }).click();
  await count(9);
  await page.getByRole('button', { name: 'Add pair', exact: true }).click(); await count(11);
  await page.getByRole('button', { name: 'Apply hull', exact: true }).click();
  await page.waitForFunction(() => window.constructionEditor.source().construction.primitives[0].customHull.stations[0].points.length === 11 && !!window.constructionEditor.result()?.definition, undefined, { timeout: 60000 });
  await chooseHull();
  await page.getByRole('button', { name: 'Edit hull sections', exact: true }).click(); await count(11);
  await page.screenshot({ path: '.build/cross-section/integrated.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.constructionEditor.undo());
  await page.waitForFunction(() => window.constructionEditor.source().construction.primitives[0].customHull.stations[0].points.length === 9);
  assert.deepEqual(errors, []);
  console.log('PASS: paired insertion/removal, mirrored nudges and drags, undo/redo, protected keel/deck, count limits, compact layout, production apply/reopen and shipbuilder undo.');
} catch (error) {
  await page.screenshot({ path: '.build/cross-section/failure.png' }); throw error;
} finally { await browser.close(); }
