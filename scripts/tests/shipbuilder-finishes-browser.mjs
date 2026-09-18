// Production controls, native compilation, saved source and portable model materials.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/scripts/diagnostics/shipbuilder.html', process.argv[2] ?? 'http://127.0.0.1:5297').href);
  await page.waitForFunction(() => !!window.constructionEditor?.result());
  await page.evaluate(async () => {
    window.shipbuilderReview.close();
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const { createStarterSource } = await import('/src/ships/constructionStarter.ts');
    const { loadConstructionCatalog } = await import('/src/ships/constructionEquipment.ts');
    const { openConstructionStore } = await import('/src/ships/constructionStore.ts');
    const catalog = await loadConstructionCatalog(), source = createStarterSource(catalog);
    source.construction.surfaces.find(s => s.primitiveId === 'hull' && s.face === 'top').paint = 'teak-natural';
    window.finishReview = { database: `finish-review-${crypto.randomUUID()}`, original: structuredClone(source) };
    await mountShipbuilderReview(source, catalog, () => openConstructionStore({ name: window.finishReview.database }));
  });
  const ready = () => page.waitForFunction(() => {
    const editor = window.constructionEditor, viewport = window.shipbuilderViewport;
    return editor?.result()?.revision === editor?.source().revision && viewport?.props.scene.current?.revision === editor?.source().revision && viewport.composed.children.length > 0;
  });
  await ready();
  await page.getByRole('tab', { name: 'Paint', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Ship surface finish' });
  assert.deepEqual(await selector.locator('option').allTextContents(), ['Original', 'Matte', 'Satin', 'Semi-gloss', 'Gloss']);
  await mkdir('.build/surface-finishes', { recursive: true });
  for (const [finish, roughness] of [['matte', .85], ['satin', .58], ['semi-gloss', .34], ['gloss', .16]]) {
    await selector.selectOption(finish); await ready();
    const result = await page.evaluate(async () => {
      const editor = window.constructionEditor, source = editor.source(), result = editor.result();
      const viewport = window.shipbuilderViewport;
      const { followsComponentPaint } = await import('/src/ships/componentMaterials.ts');
      const hull = [], timber = [], fittings = [];
      viewport.composed.traverse(node => {
        if (!node.isMesh) return;
        for (const material of [node.material].flat()) (material.userData.deckSubstrate === 'timber' ? timber : hull).push(material.roughness);
      });
      viewport.equipment.group.traverse(node => {
        if (!node.isMesh) return;
        for (const material of [node.material].flat()) if (followsComponentPaint(material.name, material.userData)) fittings.push(material.roughness);
      });
      return { finish: source.construction.finish, hull, timber, fittings, surfaces: source.construction.surfaces, equipment: source.construction.equipment, loading: result.loading };
    });
    assert.equal(result.finish, finish);
    assert.ok(result.hull.length && result.hull.every(value => value === roughness));
    assert.ok(result.fittings.length && result.fittings.every(value => value === roughness));
    assert.ok(result.timber.length && result.timber.every(value => value > .7));
    const original = await page.evaluate(() => window.finishReview.original.construction);
    assert.deepEqual(result.surfaces, original.surfaces); assert.deepEqual(result.equipment, original.equipment);
    if (finish === 'semi-gloss') {
      await page.screenshot({ path: '.build/surface-finishes/desktop.png' });
      await page.setViewportSize({ width: 960, height: 720 });
      await page.screenshot({ path: '.build/surface-finishes/compact.png' });
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  }
  await page.evaluate(() => window.constructionEditor.undo()); await ready();
  assert.equal(await selector.inputValue(), 'semi-gloss');
  await page.evaluate(() => window.constructionEditor.redo()); await ready();
  assert.equal(await selector.inputValue(), 'gloss');
  await selector.selectOption('semi-gloss'); await ready();
  const exported = await page.evaluate(async () => {
    const { createConstructionModel, disposeConstructionModel } = await import('/src/game/constructionModel.ts');
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
    const editor = window.constructionEditor, model = await createConstructionModel(editor.source(), editor.result());
    try {
      model.traverse(node => { delete node.userData.constructionSurfaces; });
      const gltf = await new GLTFExporter().parseAsync(model, { binary: false });
      return gltf.materials.filter(m => m.name?.startsWith('construction.') && !m.extras?.deckSubstrate).map(m => m.pbrMetallicRoughness.roughnessFactor);
    } finally { disposeConstructionModel(model); }
  });
  assert.ok(exported.length && exported.every(value => value === .34));
  await page.evaluate(async () => {
    const { openConstructionStore, readConstructionSource } = await import('/src/ships/constructionStore.ts');
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await window.constructionEditor.flush();
    const store = await openConstructionStore({ name: window.finishReview.database });
    const { revision } = await store.load(window.constructionEditor.source().id);
    const { decodeConstructionSource } = await import('/src/ships/constructionEditor.ts');
    const { source } = readConstructionSource(revision, { schemaVersion: 1, catalogRevision: revision.catalogRevision, decode: decodeConstructionSource }); store.close();
    window.shipbuilderReview.close();
    await mountShipbuilderReview(source, undefined, () => openConstructionStore({ name: window.finishReview.database }));
  });
  await ready(); await page.getByRole('tab', { name: 'Paint', exact: true }).click();
  assert.equal(await selector.inputValue(), 'semi-gloss');
  await selector.selectOption(''); await ready();
  assert.equal(await page.evaluate(() => window.constructionEditor.source().construction.finish), undefined);
  await page.getByRole('button', { name: 'SEA TRIALS' }).click();
  await page.waitForFunction(() => !!window.shipbuilderReview.launched);
  assert.deepEqual(errors, []);
  console.log('PASS: four whole-ship finishes, hull/fittings, unchanged paint/timber, undo/redo, save/reopen, glTF materials and trial launch.');
} finally { await browser.close(); }
