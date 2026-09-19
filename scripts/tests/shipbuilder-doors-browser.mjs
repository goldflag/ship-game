import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? process.env.SHIPBUILDER_URL ?? 'http://127.0.0.1:5200';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await mkdir('.build/door-review', { recursive: true });
const ready = () => page.waitForFunction(() => {
  const e = window.constructionEditor;
  return !!e?.result()?.definition && e.result().revision === e.source().revision;
}, undefined, { timeout: 60000 });
const screen = p => page.evaluate(async p => (await import('/scripts/tests/shipbuilder-browser.tsx')).controls.screen(p), p);
try {
  await page.goto(`${base}/scripts/diagnostics/shipbuilder.html`); await ready();
  await page.evaluate(async () => {
    window.shipbuilderReview.close();
    const { createStarterSource } = await import('/src/ships/constructionStarter.ts');
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const catalog = await (await fetch('/models/components/catalog.json')).json();
    const source = createStarterSource(catalog, 'blank');
    source.construction.primitives[0].size = [8, 6, 12];
    await mountShipbuilderReview(source);
  }); await ready();
  await page.getByRole('tab', { name: 'Fittings', exact: true }).click();
  await page.getByRole('tab', { name: 'Doors & windows', exact: true }).click();
  await page.evaluate(() => {
    const v = window.shipbuilderViewport; v.setView('side');
    const update = v.updateGhost.bind(v);
    window.doorPreviewTimings = [];
    v.updateGhost = () => { const start = performance.now(); update(); window.doorPreviewTimings.push(performance.now()-start); };
  });
  for (const [i, name] of ['Utility door', 'Watertight door', 'Windowed door'].entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    const xy = await screen([4, -1, -3 + i*3]);
    await page.mouse.move(...xy);
    await page.waitForFunction(() => {
      let meshes = 0; window.shipbuilderViewport.ghost.traverse(n => { if (n.isMesh && n.userData.wallSurfaceDetail) meshes++; });
      return meshes > 0;
    });
    for (let sample = 0; sample < 12; sample++) await page.mouse.move(xy[0]+sample*.7, xy[1]);
    await page.mouse.click(...xy);
    await page.waitForFunction(count => window.constructionEditor.source().construction.equipment.length === count, (i+1)*2);
    await ready();
  }
  const placed = await page.evaluate(() => window.constructionEditor.source().construction.equipment);
  if (placed.some(e => !e.wall?.mirrorId)) throw new Error('Doors lost their linked mirrors');
  await page.keyboard.press('v');
  await page.mouse.click(...await screen(placed[4].position.map((v,k) => v + (k === 1 ? 1 : 0))));
  await page.keyboard.press('ArrowRight'); await ready();
  const resized = await page.evaluate(() => window.constructionEditor.source().construction.equipment.filter(e => e.partId === 'generic-windowed-door'));
  if (resized.some(e => Math.abs(e.wall.widthM - 1) > 1e-6)) throw new Error('Linked door width did not resize');
  await page.keyboard.press('Control+z'); await ready();
  const restored = await page.evaluate(() => window.constructionEditor.source().construction.equipment);
  if (JSON.stringify(restored) !== JSON.stringify(placed)) throw new Error('Resize undo did not restore exact doors');
  await page.mouse.move(30, 70);
  await page.evaluate(() => { const v=window.shipbuilderViewport; v.camera.zoom=2; v.camera.updateProjectionMatrix(); });
  await page.screenshot({ path: '.build/door-review/editor-doors.png' });
  const timings = await page.evaluate(() => window.doorPreviewTimings.filter(t => t > .05).sort((a,b) => a-b));
  console.log('Door preview CPU milliseconds:', JSON.stringify({ samples:timings.length, median:timings[Math.floor(timings.length*.5)], p95:timings[Math.floor(timings.length*.95)] }));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: actual pointer preview/placement of all three doors, mirrored support, resize and exact undo.');
} catch (error) {
  await page.screenshot({ path: '.build/door-review/editor-failure.png' }); throw error;
} finally { await browser.close(); }
