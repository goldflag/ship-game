import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5264';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await mkdir('.build/hull-bands', { recursive: true });
const hull = () => page.evaluate(() => window.hullSectionsEditor.hull());
const waitBands = count => page.waitForFunction(count => window.hullSectionsEditor.hull().paintBands?.bands.length === count, count);
const button = name => page.getByRole('button', { name, exact: true });
async function setHeight(index, value) {
  const input = page.getByRole('spinbutton', { name: `Band ${index} height above the base` });
  await input.fill(String(value)); await input.press('Enter');
}
async function dragBand(index, dy) {
  const handle = button(`Band ${index} height: drag up or down`), box = await handle.boundingBox();
  assert(box);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 }); await page.mouse.up();
}
try {
  await page.goto(`${base}/scripts/diagnostics/construction-check.html`);
  await page.evaluate(async () => (await import('/scripts/tests/hull-paint-bands-browser.tsx')).mountHullPaintBandsReview());
  await page.locator('.hs-plane').waitFor();
  const original = await hull();
  assert.equal(original.paintBands, undefined);
  assert.equal(await page.getByRole('combobox', { name: 'Band 1 color' }).textContent().then(v => v.includes('Red oxide')), true);
  await button('Add band').click(); await waitBands(2);
  assert.equal((await hull()).paintBands.bands[1].paint, 'boot-top-black');
  await button('Undo').click(); assert.deepEqual(await hull(), original);
  await button('Redo').click(); await waitBands(2);
  await page.getByRole('combobox', { name: 'Band 1 color' }).click();
  await page.getByRole('option', { name: 'Sea blue', exact: true }).click();
  assert.equal((await hull()).paintBands.bands[0].paint, 'sea-blue');
  await page.getByRole('combobox', { name: 'Band 1 color' }).click();
  await page.getByRole('option', { name: 'Red oxide', exact: true }).click();
  await setHeight(2, 5.2);
  await setHeight(1, 4.3);
  const beforeDrag = await hull();
  await button('Profile 4').click();
  await dragBand(1, 8);
  const dragged = await hull();
  assert.notEqual(dragged.paintBands.bands[0].upperY, beforeDrag.paintBands.bands[0].upperY);
  assert.equal(dragged.paintBands.bands[1].upperY, beforeDrag.paintBands.bands[1].upperY);
  await button('Undo').click(); assert.deepEqual(await hull(), beforeDrag);
  // A drag cannot cross the next band; releasing is one undo step.
  await dragBand(1, -150);
  assert((await hull()).paintBands.bands[0].upperY < (await hull()).paintBands.bands[1].upperY);
  await button('Undo').click(); assert.deepEqual(await hull(), beforeDrag);
  // Waterline is measured by the native compiler and can be used by a band in range.
  const waterlineButton = button('Set band 1 to the waterline');
  await waterlineButton.waitFor();
  if (await waterlineButton.isEnabled()) { await waterlineButton.click(); await button('Undo').click(); }
  await button('Add band').click(); await waitBands(3);
  await page.getByRole('combobox', { name: 'Band 3 color' }).click();
  await page.getByRole('option', { name: 'Light gray', exact: true }).click();
  await setHeight(3, 6.1);
  const accepted = await hull();
  await button('Apply hull').click(); await page.locator('.hs-root').waitFor({ state: 'detached' });
  const exported = await page.evaluate(() => window.hullPaintReview.exported());
  assert.equal(exported.bands, 3);
  await page.evaluate(() => window.hullPaintReview.open()); await page.locator('.hs-plane').waitFor();
  assert.deepEqual((await hull()).paintBands, accepted.paintBands);
  await button('Profile 4').click();
  await page.screenshot({ path: '.build/hull-bands/desktop.png' });
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.locator('.hs-paint-controls').scrollIntoViewIfNeeded();
  await page.getByRole('combobox', { name: 'Band 2 color' }).click();
  await page.screenshot({ path: '.build/hull-bands/compact.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ui-select-menu:popover-open').count(), 0);
  // Remove every band, then restore with undo. Cancel must leave the saved design intact.
  for (let count = 3; count > 0; count--) { await button('Remove band 1').click(); await waitBands(count - 1); }
  assert(await page.getByText('No height bands. The hull uses its face paint.').isVisible());
  await button('Undo').click(); await waitBands(1);
  await button('Cancel').click(); await page.locator('.hs-root').waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.hullPaintReview.source().construction.primitives[0].customHull.paintBands), accepted.paintBands);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, exported, screenshots: ['desktop.png', 'compact.png'] }));
} catch (error) {
  console.error(errors);
  await page.screenshot({ path: '.build/hull-bands/failure.png' }); throw error;
} finally { await browser.close(); }
