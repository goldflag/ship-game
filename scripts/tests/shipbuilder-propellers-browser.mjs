// bun scripts/tests/shipbuilder-propellers-browser.mjs <vite-url>
// Exercise automatic mounts through the production editor and saved-source path.
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = JSON.parse(await readFile(new URL('../../assets/ships/valiant/blueprint.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2] ?? 'http://127.0.0.1:5200').href);
  await page.evaluate(async source => {
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    const { loadConstructionCatalog } = await import('/src/ships/constructionEquipment.ts');
    const { openConstructionStore } = await import('/src/ships/constructionStore.ts');
    window.propellerReviewDatabase = `propeller-review-${crypto.randomUUID()}`;
    await mountShipbuilderReview(source, await loadConstructionCatalog(source.construction.catalogRevision),
      () => openConstructionStore({ name: window.propellerReviewDatabase }));
  }, source);
  const ready = () => page.waitForFunction(() => {
    const editor = window.constructionEditor, viewport = window.shipbuilderViewport;
    const result = editor?.result();
    return result?.revision === editor?.source().revision && result?.propellerSupports?.length > 0
      && viewport?.props.scene.current?.revision === result.revision
      && result.propellerSupports.every(support => support.members.every((_, i) => viewport.equipment.group.getObjectByName(`${support.equipmentId}.support-${i}`)));
  });
  const snapshot = () => page.evaluate(() => {
    const result = window.constructionEditor.result(), group = window.shipbuilderViewport.equipment.group;
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (errors.length) throw new Error(JSON.stringify(errors));
    const members = result.propellerSupports.flatMap(support => support.members.map((member, i) => {
      const mesh = group.getObjectByName(`${support.equipmentId}.support-${i}`);
      if (mesh.userData.supportKind !== member.kind || !member.rings?.length) throw new Error('Editor did not use native mount geometry');
      return { name: mesh.name, kind: member.kind, positions: Array.from(mesh.geometry.attributes.position.array) };
    }));
    return { members, supports: result.propellerSupports };
  });
  await ready();
  const original = await snapshot();
  assert.equal(original.supports.length, 4);
  assert.ok(original.members.some(member => member.kind === 'bearing'));
  assert.ok(original.members.some(member => member.kind === 'strut'));
  await page.evaluate(async () => {
    const editor = window.constructionEditor, propeller = editor.source().construction.equipment.find(item => item.id === 'screw-port-1');
    await editor.apply({ version: 1, expectedRevision: editor.source().revision, label: 'Move propeller',
      commands: [{ op: 'equipment-patch', id: propeller.id, changes: { position: [propeller.position[0] - .25, propeller.position[1], propeller.position[2]] } }] });
  });
  await ready();
  const moved = await snapshot();
  assert.notDeepEqual(moved, original, 'Moving a propeller must refit its mounts');
  await page.evaluate(() => window.constructionEditor.undo()); await ready();
  assert.deepEqual(await snapshot(), original, 'Undo must restore the exact mount geometry');
  await page.evaluate(() => window.constructionEditor.redo()); await ready();
  assert.deepEqual(await snapshot(), moved, 'Redo must restore the refitted mounts');

  await page.evaluate(async () => {
    const { openConstructionStore, readConstructionSource } = await import('/src/ships/constructionStore.ts');
    const { decodeConstructionSource } = await import('/src/ships/constructionEditor.ts');
    const { loadConstructionCatalog } = await import('/src/ships/constructionEquipment.ts');
    const { mountShipbuilderReview } = await import('/scripts/tests/shipbuilder-browser.tsx');
    await window.constructionEditor.flush();
    const store = await openConstructionStore({ name: window.propellerReviewDatabase });
    const { revision } = await store.load(window.constructionEditor.source().id);
    const { source } = readConstructionSource(revision, { schemaVersion: 1, catalogRevision: revision.catalogRevision, decode: decodeConstructionSource });
    store.close(); window.shipbuilderReview.close();
    await mountShipbuilderReview(source, await loadConstructionCatalog(source.construction.catalogRevision),
      () => openConstructionStore({ name: window.propellerReviewDatabase }));
  });
  await ready();
  assert.deepEqual(await snapshot(), moved, 'Reopening a saved ship must regenerate the same mounts');
  await page.getByRole('tab', { name: 'Fittings', exact: true }).click();
  await page.evaluate(() => {
    const viewport = window.shipbuilderViewport;
    viewport.controls.target.set(0, -9, 98);
    viewport.camera.position.set(32, -18, 130);
    viewport.camera.zoom = 1.5;
    viewport.camera.updateProjectionMatrix(); viewport.controls.update();
  });
  await mkdir('.build/propeller-playground', { recursive: true });
  await page.screenshot({ path: '.build/propeller-playground/editor.png' });
  await page.getByRole('button', { name: 'SEA TRIALS', exact: true }).click();
  await page.waitForFunction(() => !!window.shipbuilderReview.launched);
  const trial = await page.evaluate(async () => {
    const { createConstructionModel, disposeConstructionModel } = await import('/src/game/constructionModel.ts');
    const editor = window.constructionEditor, result = window.shipbuilderReview.launched;
    const model = await createConstructionModel(editor.source(), result);
    try {
      const members = [];
      model.traverse(node => {
        if (!node.userData.supportKind) return;
        for (let parent = node.parent; parent; parent = parent.parent) if (parent.name.endsWith('.spin')) throw new Error('Mount is attached to rotating blades');
        members.push(node.name);
      });
      return { supports: result.propellerSupports, members: members.sort() };
    } finally { disposeConstructionModel(model); }
  });
  assert.deepEqual(trial.supports, moved.supports);
  assert.deepEqual(trial.members, moved.members.map(member => member.name).sort());
  assert.deepEqual(errors, []);
  console.log('PASS: native mounts in editor, placement refit, undo/redo, save/reopen, sea-trial handoff and game model with stationary supports.');
} finally { await browser.close(); }
