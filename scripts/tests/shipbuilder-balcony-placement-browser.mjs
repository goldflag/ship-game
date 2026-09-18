import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const base = process.env.SHIPBUILDER_URL ?? 'http://localhost:5200';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => console.error(error.message));
await mkdir('.build/balcony-placement-review', { recursive: true });
try {
  await page.goto(`${base}/scripts/diagnostics/shipbuilder.html`);
  await page.waitForFunction(() => !!window.constructionEditor?.result()?.definition);
  await page.evaluate(async () => {
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const source = window.constructionEditor.source();
    window.shipbuilderReview.close();
    source.id = `balcony-placement-${crypto.randomUUID()}`; source.revision = crypto.randomUUID();
    source.construction.primitives = [{ id: 'support', kind: 'vertex', size: [8, 8, 8], position: [0, 0, 0], rotationDeg: 0,
      vertices: [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]].map(([x,y,z]) => [x === .5 ? x - .12*y - .12*z : x,y,z]) }];
    source.construction.equipment = []; source.construction.boundaries = []; source.construction.loads = []; source.construction.surfaces = [];
    await mountShipbuilderReview(source);
  });
  await page.waitForFunction(() => window.constructionEditor?.source().construction.primitives[0].id === 'support' && !!window.constructionEditor?.result()?.definition);
  console.log('Support ready');
  await page.getByRole('button', { name: 'Balcony', exact: true }).click();
  const screen = await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const viewport = window.shipbuilderViewport;
    if (viewport.props.scene.placementMirror) { controls.key('m'); await controls.settled(() => !viewport.props.scene.placementMirror, 'mirror disabled'); }
    viewport.camera.position.set(13, 7, 13); viewport.controls.target.set(2, 0, 0); viewport.controls.update(); viewport.camera.updateMatrixWorld();
    return controls.screen([4, 0, 0]);
  });
  await page.mouse.move(...screen);
  const ghost = await page.evaluate(() => window.shipbuilderViewport.ghost.position.toArray());
  await page.mouse.click(...screen);
  console.log('Clicked balcony placement', screen, ghost);
  await page.waitForFunction(() => window.constructionEditor?.source().construction.primitives.length === 2);
  await page.waitForFunction(() => { const e = window.constructionEditor; return e?.result()?.revision === e?.source().revision && !!e.result()?.definition; });
  console.log('Placed balcony compiled');
  const added = await page.evaluate(() => window.constructionEditor.source().construction.primitives[1]);
  if (JSON.stringify(added.size) !== JSON.stringify([1,.08,2])) throw new Error('Wrong default dimensions');
  if (added.position.some((v,k) => Math.abs(v - ghost[k]) > 1e-6)) throw new Error('Placement disagrees with ghost');
  if (added.balcony.points[3].edge !== 'open') throw new Error('Mounting edge is not open');
  if (added.position[0] - .5 + .12 * (added.position[1] + 1.14) + .12 * (added.position[2] + 1.03) >= 4) throw new Error('Side wall ends still stop short of the support');
  if (added.position[0] - .53 + .12 * (added.position[1] + .04) + .12 * (added.position[2] + 1.03) >= 4) throw new Error('Inner edge still has a gap');
  await page.evaluate(id => window.shipbuilderViewport.props.onPointer({ kind: 'box', ids: [id], additive: false }), added.id);
  await page.getByRole('button', { name: 'Edit balcony outline', exact: true }).click();
  await page.getByRole('button', { name: 'Edge 4 to 1: open', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Solid wall', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(() => { const e = window.constructionEditor; return e?.result()?.revision === e?.source().revision && !!e.result()?.definition; });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(async () => { const v = window.shipbuilderViewport; v.camera.position.set(10, 4, 7); v.controls.target.set(4, .5, 0); v.controls.update(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({ path: '.build/balcony-placement-review/attached.png' });
  await page.evaluate(() => window.constructionEditor.flush());
  console.log('PASS: sloped/tapered side placement, 1 × 2 m wide mounting edge, exact ghost/commit agreement, full edge contact, wall/open edits, native attachment and save.');
} catch (error) { await page.screenshot({ path: '.build/balcony-placement-review/failure.png' }); throw error; }
finally { await browser.close(); }
