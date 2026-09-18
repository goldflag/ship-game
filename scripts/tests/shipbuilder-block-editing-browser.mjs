// bun scripts/tests/shipbuilder-block-editing-browser.mjs <vite-url>
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

await mkdir('.build/block-editing', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = [];
const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
const values = () => page.locator('[data-tag="piece-a"] input').evaluateAll(inputs => inputs.map(input => Number(input.value)));
try {
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2] ?? 'http://127.0.0.1:5200').href);
  await page.evaluate(async () => {
    const { mountShipbuilderReview, controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const { loadConstructionCatalog } = await import('/src/ships/constructionEquipment.ts');
    const { createStarterSource } = await import('/src/ships/constructionStarter.ts');
    const { openConstructionStore } = await import('/src/ships/constructionStore.ts');
    const catalog = await loadConstructionCatalog(), source = createStarterSource(catalog, 'blank');
    source.name = 'Block editing review';
    source.construction.primitives = [{ id: 'a', kind: 'box', size: [4, 4, 4], position: [0, 0, 0], rotationDeg: 0 }];
    await mountShipbuilderReview(source, catalog, () => openConstructionStore({ name: 'block-editing-review' }));
  });
  await page.waitForFunction(() => !!window.shipbuilderReview?.source && !!window.shipbuilderViewport, undefined, { timeout: 45000 });
  await page.evaluate(async () => {
    const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await controls.tool('Select');
    controls.click(...await controls.screen([0, 2, 0]));
  });
  await page.locator('.sb-edit-freeform').click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  const yHandle = page.locator('.sb-freeform-axis[data-axis="Y"]').first();
  await yHandle.focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => window.shipbuilderViewport.props.scene.source.construction.primitives[0].vertices?.[3][1] > .5);
  await page.getByRole('button', { name: /^Done/ }).click();
  await page.waitForSelector('[data-tag="piece-a"] input');
  const actual = await values();
  assert(actual.join() === '4,4.2,4', `Selected dimensions track the edited solid: expected 4,4.2,4; got ${actual}`);
  const height = page.locator('[data-tag="piece-a"] input').nth(1);
  await height.fill('6'); await height.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('[data-tag="piece-a"] input')[1].value === '6');
  assert((await values()).join() === '4,6,4', 'Numeric resize sets the actual edited height');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Meta+z');
  await page.waitForFunction(() => document.querySelectorAll('[data-tag="piece-a"] input')[1].value === '4.2');
  await page.locator('.sb-edit-freeform').click();
  const reading = page.getByLabel('Current block dimensions');
  assert(await reading.textContent() === '4 × 4.2 × 4 m', 'Freeform shows current local dimensions');
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  const drag = async finish => {
    const box = await yHandle.boundingBox();
    const [from, to] = await page.evaluate(async () => {
      const { controls } = await import('/scripts/tests/shipbuilder-browser.tsx');
      return [await controls.screen([0, 2.2, 0]), await controls.screen([0, 3.2, 0])];
    });
    const start = await page.evaluate(() => window.shipbuilderViewport.props.scene.source.revision);
    const before = await reading.textContent();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + to[0] - from[0], box.y + box.height / 2 + to[1] - from[1], { steps: 8 });
    await page.waitForFunction(before => document.querySelector('[aria-label="Current block dimensions"]').textContent !== before, before);
    assert(await page.evaluate(() => window.shipbuilderViewport.props.scene.source.revision) === start, 'Live dimensions update before committing source');
    if (finish === 'cancel') {
      await page.keyboard.press('Escape'); await page.mouse.up();
      assert(await reading.textContent() === before, 'Cancel restores the committed dimensions');
    } else {
      const preview = await reading.textContent();
      await page.mouse.up();
      await page.waitForFunction(revision => window.shipbuilderViewport.props.scene.source.revision !== revision, start);
      assert(await reading.textContent() === preview, 'Committed dimensions match the drag preview');
      await page.keyboard.press('Meta+z');
      await page.waitForFunction(before => document.querySelector('[aria-label="Current block dimensions"]').textContent === before, before);
      checks.push('Undo restores the original freeform readout');
    }
  };
  await drag('cancel'); await drag('commit');
  assert(await yHandle.evaluate(el => getComputedStyle(el).width) === '20px', 'Axis handles are smaller');
  await page.screenshot({ path: '.build/block-editing/freeform-desktop.png' });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: '.build/block-editing/freeform-compact.png' });
  await page.getByRole('button', { name: /^Done/ }).click();
  await page.setViewportSize({ width: 1440, height: 960 });

  const dock = page.locator('.sb-dock');
  await dock.getByRole('radio', { name: 'All', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert(await dock.getByRole('radio', { name: 'Boxes', exact: true }).getAttribute('aria-checked') === 'true', 'Arrow keys navigate the block type group');
  await dock.getByRole('radio', { name: 'Bridges', exact: true }).click();
  assert(await dock.locator('.sb-hotbar-cards .sb-slot').count() === 6, 'Type filter narrows the palette');
  await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('2');
  await page.waitForFunction(() => document.querySelector('.sb-cursor b')?.textContent === 'Diagonal bridge');
  checks.push('Number keys follow the filtered palette');
  await page.getByRole('button', { name: 'All shapes', exact: true }).click();
  const drawer = page.locator('.sb-drawer');
  assert(await drawer.locator('.sb-slot').count() === 6, 'Type filter also narrows the expanded picker');
  await page.getByRole('searchbox', { name: 'Find a shape' }).fill('rounded');
  assert(await drawer.locator('.sb-slot').count() === 2, 'Search combines with the selected block type');
  await page.getByRole('searchbox', { name: 'Find a shape' }).fill('missing-shape');
  assert((await drawer.textContent()).includes('No shape matches'), 'Combined filters explain empty results');
  await page.getByRole('searchbox', { name: 'Find a shape' }).fill('');
  await drawer.getByRole('radio', { name: 'All', exact: true }).click();
  assert(await drawer.getByRole('button', { name: 'Block', exact: true }).count() === 1, 'One standard 4 m Block replaces the duplicate freeform preset');
  assert(await drawer.getByRole('button', { name: 'Freeform hull', exact: true }).count() === 0, 'No distinct freeform block remains');
  await page.waitForFunction(() => document.querySelector('.sb-drawer').getBoundingClientRect().height > 250);
  await page.screenshot({ path: '.build/block-editing/palette-desktop.png' });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: '.build/block-editing/palette-compact.png' });
  await drawer.getByRole('button', { name: 'Block', exact: true }).click();
  const width = page.locator('.sb-cursor input').first();
  await width.fill('7'); await width.press('Enter');
  await dock.getByRole('button', { name: 'Block', exact: true }).hover();
  assert((await page.locator('.sb-tip').textContent()).includes('7 × 4 × 4 m'), 'Palette tooltip follows the placement size override');
  assert(await dock.getByRole('button', { name: 'Block', exact: true }).locator('.sb-dims').textContent() === '7×4×4', 'Palette corner dimensions follow the placement size');
  assert(!errors.length, `No browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await page.screenshot({ path: '.build/block-editing/latest.png' });
  await browser.close();
}
