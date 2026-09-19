import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.SHIPBUILDER_URL ?? 'http://localhost:5200';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => console.error('Browser error:', error.message));
await mkdir('.build/fitting-gizmo-review', { recursive: true });
try {
  await page.goto(`${base}/scripts/diagnostics/shipbuilder.html`);
  await page.waitForFunction(() => !!window.constructionEditor?.result()?.definition, undefined, { timeout: 60000 });
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await controls.tab('Machinery'); await controls.tool('Select');
    const viewport = window.shipbuilderViewport;
    viewport.props.onPointer({ kind: 'box', ids: ['funnel'], additive: false });
  });
  const handles = page.getByRole('group', { name: 'Move selection', exact: true });
  await handles.waitFor({ state: 'visible' });
  const before = await page.evaluate(() => window.constructionEditor.source().construction.equipment.find(p => p.id === 'funnel').position);
  const x = page.getByRole('button', { name: 'Move selection X', exact: true });
  await x.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(before => window.constructionEditor?.source().construction.equipment.find(p => p.id === 'funnel').position[0] > before[0], before);
  await page.evaluate(() => window.constructionEditor.undo());
  await page.waitForFunction(before => !!window.constructionEditor && JSON.stringify(window.constructionEditor.source().construction.equipment.find(p => p.id === 'funnel').position) === JSON.stringify(before), before);
  // Real pointer drag commits once; undo restores the exact mounting point.
  const box = await x.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(before => !!window.constructionEditor && JSON.stringify(window.constructionEditor.source().construction.equipment.find(p => p.id === 'funnel').position) !== JSON.stringify(before), before);
  await page.evaluate(() => window.constructionEditor.undo());
  await page.waitForFunction(before => !!window.constructionEditor && JSON.stringify(window.constructionEditor.source().construction.equipment.find(p => p.id === 'funnel').position) === JSON.stringify(before), before);
  await page.evaluate(async () => { const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx'); await controls.tool('Place'); });
  await handles.waitFor({ state: 'visible' });
  await page.screenshot({ path: '.build/fitting-gizmo-review/desktop.png' });
  await page.evaluate(async () => { const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx'); await controls.tab('Paint'); });
  if (await handles.isVisible()) throw new Error('Paint must hide movement handles');
  console.log('PASS: fitting-only gizmo selection, axis nudge, pointer drag, undo, placement visibility and paint exclusion.');
} catch (error) {
  await page.screenshot({ path: '.build/fitting-gizmo-review/failure.png' }); throw error;
} finally { await browser.close(); }
