// Run against this checkout's Vite server, passing its URL as the first argument.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
page.setDefaultTimeout(10000);
try {
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2]).href);
  await page.evaluate(async () => {
    const { mountShipbuilderReview, controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await mountShipbuilderReview();
    const deadline = performance.now() + 45000;
    while (!window.shipbuilderReview?.source) {
      if (performance.now() > deadline) throw new Error('Editor source did not become ready');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await controls.tab('Internals'); await controls.tool('Select'); controls.key('q');
    await controls.settled(() => window.shipbuilderViewport.props.scene.view === 'top', 'top');
    const { source, catalog } = window.shipbuilderViewport.props.scene;
    const engine = source.construction.equipment.find(p => p.id === 'engine');
    const part = catalog.equipment.find(p => p.id === engine.partId);
    controls.click(...await controls.screen(engine.position.map((n, k) => n + part.boundsCenter[k])));
    await controls.settled(() => window.shipbuilderViewport.props.scene.selected.has('engine'), 'engine selected');
    for (let i = 0; i < 3; i++) { controls.key('q'); await controls.settled(() => true, 'cycle view'); }
  });
  const axis = name => page.getByRole('button', { name: `Move selection ${name}`, exact: true });
  for (const name of ['X', 'Y', 'Z']) await axis(name).waitFor({ state: 'visible' });
  checks.push('Internal engine shows XYZ movement handles');
  const source = () => page.evaluate(() => structuredClone(window.shipbuilderViewport.props.scene.source.construction));
  const before = await source();
  const engine = data => data.equipment.find(p => p.id === 'engine');
  const drag = async (name, delta, cancel = false) => {
    const box = await axis(name).boundingBox();
    const offset = await page.evaluate(async delta => {
      const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
      const anchor = window.shipbuilderViewport.moveHandles.options.anchor;
      const a = await controls.screen(anchor), b = await controls.screen(anchor.map((v, k) => v + delta[k]));
      return b.map((v, k) => v - a[k]);
    }, delta);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + offset[0], y + offset[1], { steps: 8 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await drag('X', [1, 0, 0]);
  await page.waitForFunction(x => window.shipbuilderViewport.props.scene.source.construction.equipment.find(p => p.id === 'engine').position[0] === x, engine(before).position[0] + 1);
  let after = await source();
  assert(JSON.stringify(after.primitives) === JSON.stringify(before.primitives), 'Internal gizmo preserves the hull');
  assert(JSON.stringify(after.equipment.filter(p => p.id !== 'engine')) === JSON.stringify(before.equipment.filter(p => p.id !== 'engine')), 'Internal gizmo moves only the selected engine');
  await page.keyboard.press('Meta+z');
  await page.waitForFunction(x => window.shipbuilderViewport.props.scene.source.construction.equipment.find(p => p.id === 'engine').position[0] === x, engine(before).position[0]);
  checks.push('One undo restores a gizmo drag');
  await drag('Y', [0, 1, 0], true);
  assert(JSON.stringify(engine(await source())) === JSON.stringify(engine(before)), 'Escape cancels an internal gizmo drag');
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await controls.tool('Module');
  });
  await axis('X').waitFor({ state: 'visible' });
  await axis('X').focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(x => window.shipbuilderViewport.props.scene.source.construction.equipment.find(p => p.id === 'engine').position[0] === x, engine(before).position[0] + .25);
  checks.push('Module tool retains the gizmo and uses the equipment snap step');
  await page.keyboard.press('Meta+z');
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await controls.tool('Select'); controls.key('Escape'); controls.key('q');
    await controls.settled(() => window.shipbuilderViewport.props.scene.view === 'top', 'top');
    controls.click(...await controls.screen([3, 0, -6]));
    await controls.settled(() => window.shipbuilderViewport.props.scene.selected.has('forward-bulkhead'), 'bulkhead selected');
  });
  await axis('Z').waitFor({ state: 'visible' });
  assert(!await axis('X').isVisible() && !await axis('Y').isVisible(), 'Bulkhead gizmo offers only its normal axis');
  assert(!await page.getByRole('button', { name: 'Move selection in view plane', exact: true }).isVisible(), 'Single-axis boundary has no misleading plane handle');
  await drag('Z', [0, 0, 1]);
  await page.waitForFunction(() => window.shipbuilderViewport.props.scene.source.construction.boundaries.find(p => p.id === 'forward-bulkhead').offset === -5);
  checks.push('Bulkhead gizmo moves its boundary offset');
  await mkdir('.build/internal-gizmo', { recursive: true });
  await page.screenshot({ path: '.build/internal-gizmo/bulkhead.png' });
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    controls.key('a', { ctrlKey: true });
  });
  await axis('X').waitFor({ state: 'visible' });
  assert((await page.evaluate(() => [...window.shipbuilderViewport.props.scene.selected])).every(id => ['engine', 'magazine', 'forward-bulkhead', 'aft-bulkhead'].includes(id)), 'Group gizmo remains restricted to internals');
  await page.screenshot({ path: '.build/internal-gizmo/group.png' });
  assert(!errors.length, `No browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  await mkdir('.build/internal-gizmo', { recursive: true });
  await page.screenshot({ path: '.build/internal-gizmo/failed.png' });
  throw error;
} finally { await browser.close(); }
