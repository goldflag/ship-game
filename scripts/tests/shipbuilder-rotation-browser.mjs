// bun scripts/tests/shipbuilder-rotation-browser.mjs <vite-url>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('.build/block-editing', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
const block = () => page.evaluate(() => window.shipbuilderViewport.props.scene.source.construction.primitives[0]);
const revision = () => page.evaluate(() => window.shipbuilderViewport.props.scene.source.revision);
const waitChanged = before => page.waitForFunction(r => window.shipbuilderViewport.props.scene.source.revision !== r, before);
const blur = () => page.evaluate(() => document.activeElement?.blur());
try {
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2] ?? 'http://127.0.0.1:5200').href);
  await page.evaluate(async () => {
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const { loadConstructionCatalog } = await import('/src/ships/constructionEquipment.ts');
    const { createStarterSource } = await import('/src/ships/constructionStarter.ts');
    const { openConstructionStore } = await import('/src/ships/constructionStore.ts');
    const catalog = await loadConstructionCatalog(), source = createStarterSource(catalog, 'blank');
    source.name = 'Block rotation review';
    source.construction.primitives = [{ id: 'a', kind: 'wedge', size: [4, 2, 6], position: [0, 0, 0], rotationDeg: 0 }];
    source.construction.surfaces = [{ primitiveId: 'a', face: 'bottom', thicknessMm: 12, material: 'steel', paint: 'red-oxide' }];
    await mountShipbuilderReview(source, catalog, () => openConstructionStore({ name: 'block-rotation-review' }));
  });
  await page.waitForFunction(() => !!window.shipbuilderReview?.source && !!window.shipbuilderViewport, undefined, { timeout: 45000 });
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await controls.tool('Select'); controls.click(...await controls.screen([0, 0, 0]));
  });
  await page.keyboard.press('o');
  await page.getByRole('region', { name: 'Block rotation editor' }).waitFor();
  const toolbar = page.getByRole('region', { name: 'Block rotation editor' });
  assert(await page.locator('.sb-rotation-hit').count() === 3, 'Three axis rings are available in Rotate mode');
  for (const [axis, field] of [['x', 'pitchDeg'], ['z', 'rollDeg'], ['y', 'rotationDeg']]) {
    await blur(); await page.keyboard.press(axis); const before = await revision();
    await page.keyboard.press('r'); await waitChanged(before);
    const p = await block(); assert((field === 'rotationDeg' ? p.rotationDeg : p.tilt?.[field]) === 90, `${axis.toUpperCase()} then R rotates +90°`);
    await page.keyboard.press('Shift+r');
    await page.waitForFunction(() => { const p = window.shipbuilderViewport.props.scene.source.construction.primitives[0]; return p.rotationDeg === 0 && !p.tilt; });
    checks.push(`${axis.toUpperCase()} then Shift-R reverses the turn`);
  }
  for (const [name, value] of [['Pitch', '24.5'], ['Yaw', '37'], ['Roll', '-15']]) {
    const field = toolbar.getByRole('spinbutton', { name, exact: true }); await field.fill(value); await field.press('Enter');
    await page.waitForFunction(([name, value]) => document.querySelector(`.sb-rotation-tools input[aria-label="${name}"]`).value === value, [name, value]);
  }
  const precise = await block(); assert(precise.tilt.pitchDeg === 24.5 && precise.tilt.rollDeg === -15 && precise.rotationDeg === 37, 'Precise pitch, yaw and roll fields save independently');
  await page.waitForFunction(() => !!window.shipbuilderViewport.props.scene.current, undefined, { timeout: 30000 });
  assert(await page.evaluate(() => !!window.shipbuilderViewport.props.scene.current?.definition), 'Arbitrary three-axis rotation compiles to a playable definition');
  await toolbar.getByRole('button', { name: 'Reset', exact: true }).click();
  await blur(); await page.keyboard.press('Meta+z');
  await page.waitForFunction(() => window.shipbuilderViewport.props.scene.source.construction.primitives[0].tilt?.pitchDeg === 24.5);
  assert(JSON.stringify(await block()) === JSON.stringify(precise), 'Reset is one undoable edit');
  await toolbar.getByRole('button', { name: 'Reset', exact: true }).click(); await blur();
  // Pick a ring point that is visible and hit-testable, then trace the projected circle.
  const ringPath = async (axis, degrees = 45) => page.evaluate(async ({ axis, degrees }) => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const v = window.shipbuilderViewport, radius = v.rotateHandles.radius;
    for (let n = 0; n < 48; n++) {
      const a = n / 48 * Math.PI * 2;
      const world = t => { const p = [0, 0, 0]; p[(axis + 1) % 3] = radius * Math.cos(t); p[(axis + 2) % 3] = radius * Math.sin(t); return p; };
      const start = await controls.screen(world(a));
      const hit = document.elementFromPoint(...start);
      if (hit?.matches(`.sb-rotation-hit[data-axis="${'XYZ'[axis]}"]`)) return Promise.all(Array.from({ length: 13 }, (_, i) => controls.screen(world(a + i / 12 * degrees * Math.PI / 180))));
    }
    throw new Error(`No visible ring point on ${axis}`);
  }, { axis, degrees });
  for (const axis of [0, 1, 2]) {
    await page.waitForTimeout(300);
    const path = await ringPath(axis), before = await revision(), original = await block();
    await page.mouse.move(...path[0]); await page.mouse.down();
    for (const point of path.slice(1)) await page.mouse.move(...point);
    assert(await revision() === before, 'Ring preview leaves the source unchanged until release');
    const angle = await page.getByLabel('Rotation drag angle').textContent();
    assert(angle.includes('45°'), `${'XYZ'[axis]} ring shows a live snapped 45° angle: ${angle}`);
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert(JSON.stringify(await block()) === JSON.stringify(original), `${'XYZ'[axis]} drag cancels without an edit`);
    await page.mouse.move(...path[0]); await page.mouse.down(); for (const point of path.slice(1)) await page.mouse.move(...point);
    await page.mouse.up(); await waitChanged(before);
    await blur(); await page.keyboard.press('Meta+z');
    await page.waitForFunction(p => JSON.stringify(window.shipbuilderViewport.props.scene.source.construction.primitives[0]) === JSON.stringify(p), original);
    checks.push(`${'XYZ'[axis]} drag commits exactly one undoable edit`);
  }
  await toolbar.getByRole('button', { name: 'Snap 15°', exact: true }).click();
  assert(await toolbar.getByRole('button', { name: 'Snap 15°', exact: true }).getAttribute('aria-pressed') === 'false', 'Angle snapping can be disabled');
  const finePath = await ringPath(1, 17.3), fineBefore = await revision();
  await page.mouse.move(...finePath[0]); await page.mouse.down();
  for (const point of finePath.slice(1)) await page.mouse.move(...point);
  assert((await page.getByLabel('Rotation drag angle').textContent()).includes('17.3°'), 'Unsnapped dragging shows fractional angles');
  await page.mouse.up(); await waitChanged(fineBefore); await blur(); await page.keyboard.press('Meta+z');
  await page.waitForFunction(() => window.shipbuilderViewport.props.scene.source.construction.primitives[0].rotationDeg === 0);
  // Orthographic Plan makes the X and Z rings edge-on; their screen tangent still works.
  await blur(); await page.keyboard.press('p'); await page.keyboard.press('q');
  await page.waitForTimeout(400);
  const edgePath = await ringPath(0), edgeBefore = await revision();
  await page.mouse.move(...edgePath[0]); await page.mouse.down();
  await page.mouse.move(edgePath[0][0] + 35, edgePath[0][1] + 45, { steps: 6 });
  const edgeAngle = await page.getByLabel('Rotation drag angle').textContent();
  assert(!edgeAngle.includes('NaN') && !edgeAngle.endsWith(' 0°'), `Edge-on ring remains draggable: ${edgeAngle}`);
  await page.keyboard.press('Escape'); await page.mouse.up(); assert(await revision() === edgeBefore, 'Edge-on drag cancellation preserves the revision');
  await blur(); await page.keyboard.press('q'); await page.keyboard.press('q'); await page.keyboard.press('q'); await page.keyboard.press('p');
  await page.waitForTimeout(400);
  const yaw = page.getByRole('button', { name: 'Rotate Yaw ring', exact: true }); await yaw.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.shipbuilderViewport.props.scene.source.construction.primitives[0].rotationDeg === 15);
  checks.push('Focused rings support keyboard rotation');
  await page.screenshot({ path: '.build/block-editing/rotation-desktop.png' });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: '.build/block-editing/rotation-compact.png' });
  await blur(); await page.keyboard.press('Escape');
  assert(await page.locator('.sb-rotate-handles').isHidden(), 'Leaving Rotate mode hides the rings');
  await page.keyboard.press('d');
  await page.getByLabel('Current block dimensions').waitFor();
  assert(await page.getByLabel('Current block dimensions').textContent() === '4 × 2 × 6 m', 'Rotated shapes remain editable with local dimensions');
  assert(!errors.length, `No browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: '.build/block-editing/rotation-failure.png' });
  console.error(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0, 3000) }));
  throw error;
} finally { await browser.close(); }
