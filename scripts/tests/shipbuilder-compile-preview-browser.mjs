// Run against this checkout's Vite server. Hold the real compiler's response so
// the pending revision is deterministic even on a very fast machine.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/scripts/diagnostics/construction-check.html', process.argv[2]).href);
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Shipbuilder } = await import('/src/ui/shipbuilding/Shipbuilder.tsx');
    const { ConstructionClient } = await import('/src/ships/constructionClient.ts');
    const { loadConstructionCatalog } = await import('/src/ships/constructionEquipment.ts');
    const { createStarterSource } = await import('/src/ships/constructionStarter.ts');
    const { openConstructionStore } = await import('/src/ships/constructionStore.ts');
    await import('/src/ui/styles.css');
    const catalog = await loadConstructionCatalog(), source = createStarterSource(catalog);
    source.construction.surfaces.find(s => s.primitiveId === 'hull' && s.face === 'top').paint = 'teak-natural';
    const client = new ConstructionClient(), state = window.compilePreviewCheck = { held: false, samples: [], requests: [], launches: 0 };
    const compiler = {
      async compile(source, signal) {
        state.requests.push(source.revision);
        const start = performance.now(), result = await client.compile(source, signal);
        state.samples.push(performance.now() - start);
        if (state.held) await new Promise(resolve => { state.release = resolve; signal.addEventListener('abort', resolve, { once: true }); });
        return result;
      },
      dispose() { client.dispose(); },
    };
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const root = createRoot(host), database = `preview-check-${crypto.randomUUID()}`;
    state.close = () => { root.unmount(); indexedDB.deleteDatabase(database); };
    root.render(React.createElement(Shipbuilder, { catalog, starterSource: source, compileClient: compiler,
      openStore: () => openConstructionStore({ name: database }), onEditorReady: editor => { state.editor = editor; }, onClose() {}, onLaunch() { state.launches++; } }));
  });
  await page.waitForFunction(() => window.shipbuilderViewport?.props.scene.current && window.shipbuilderViewport.composed.children.length);
  await mkdir('.build/compile-preview', { recursive: true });
  const burst = await page.evaluate(async () => {
    const state = window.compilePreviewCheck, count = state.requests.length;
    const readings = () => [...document.querySelectorAll('.sb-ledger > .row')].map(row => row.textContent);
    const before = readings(), visible = [];
    for (let i = 0; i < 6; i++) {
      const id = `burst-${i}`;
      state.editor.apply({ version: 1, expectedRevision: state.editor.source().revision, label: 'Place successive block', commands: [
        { op: 'primitive', value: { id, kind: 'box', size: [.5, .5, .5], position: [0, 2.75, 7 + i * .75], rotationDeg: 0 } },
      ] });
      await new Promise(resolve => setTimeout(resolve, 100));
      visible.push(window.shipbuilderViewport.surfaceTriangles.some(surface => surface.primitiveId === id));
    }
    await state.editor.launch();
    const pending = { calls: state.requests.length - count, visible, before, after: readings(),
      status: document.querySelector('.sb-warn .lead')?.textContent, ledger: document.querySelector('.sb-ledger h4')?.textContent,
      current: !!state.editor.result(), launches: state.launches };
    state.burstRequestCount = count;
    state.editor.apply({ version: 1, expectedRevision: state.editor.source().revision, label: 'Remove successive blocks', commands: [
      { op: 'remove', ids: Array.from({ length: 6 }, (_, i) => `burst-${i}`) },
    ] });
    return pending;
  });
  assert.equal(burst.calls, 0, 'consecutive edits must wait for a pause instead of sending each revision');
  assert.ok(burst.visible.every(Boolean), 'each placed block must appear while compilation is deferred');
  assert.deepEqual(burst.after, burst.before, 'last checked readings must stay stable during editing');
  assert.match(burst.status, /Checks pending/); assert.match(burst.ledger, /last check/);
  assert.equal(burst.current, false); assert.equal(burst.launches, 0, 'pending edits cannot launch an old revision');
  await page.waitForFunction(() => !!window.compilePreviewCheck.editor.result());
  assert.equal(await page.evaluate(() => window.compilePreviewCheck.requests.length - window.compilePreviewCheck.burstRequestCount), 1,
    'a completed editing burst must send only its final revision');
  await page.screenshot({ path: '.build/compile-preview/finished-before.png' });
  await page.evaluate(() => {
    const state = window.compilePreviewCheck, view = window.shipbuilderViewport;
    state.before = view.props.scene.current.surfaces;
    state.held = true; state.editedAt = performance.now();
    state.editor.apply({ version: 1, expectedRevision: state.editor.source().revision, label: 'Place block', commands: [
      { op: 'primitive', value: { id: 'instant-block', kind: 'box', size: [2, 2, 2], position: [0, 3.5, 8], rotationDeg: 0 } },
    ] });
  });
  await page.waitForFunction(() => window.shipbuilderViewport.props.scene.source.construction.primitives.some(p => p.id === 'instant-block') && !window.shipbuilderViewport.props.scene.current);
  const pending = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const view = window.shipbuilderViewport, state = window.compilePreviewCheck;
    const surfaces = view.surfaceTriangles;
    const paints = [];
    view.composed.traverse(node => { if (node.material) paints.push(node.material.name); });
    return { triangles: surfaces.length, hasNew: surfaces.some(s => s.primitiveId === 'instant-block'),
      retained: state.before.filter(s => s.primitiveId === 'hull' && !s.open).every(s => surfaces.some(p => p.id === s.id)),
      paints, current: !!state.editor.result(), trialDisabled: document.querySelector('.sb-top .sb-cmd')?.disabled,
      previewMs: performance.now() - state.editedAt };
  });
  assert.ok(pending.triangles > 0, 'pending placement discarded the finished hull');
  assert.ok(pending.hasNew, 'new block must be visible before compilation finishes');
  assert.ok(pending.retained, 'unchanged native hull surfaces must survive placement');
  assert.ok(pending.paints.some(paint => paint.includes('teak-natural')), 'pending placement lost the painted deck/material');
  assert.equal(pending.current, false, 'display geometry must not count as compiled validation');
  assert.equal(pending.trialDisabled, true, 'sea trials must wait for validation');
  await page.screenshot({ path: '.build/compile-preview/finished-pending.png' });
  await page.waitForFunction(() => !!window.compilePreviewCheck.release);
  await page.evaluate(() => window.compilePreviewCheck.release());
  await page.waitForFunction(() => !!window.compilePreviewCheck.editor.result());
  await page.screenshot({ path: '.build/compile-preview/finished-after.png' });
  await page.evaluate(() => {
    const state = window.compilePreviewCheck;
    state.release = undefined; state.editedAt = performance.now();
    state.editor.apply({ version: 1, expectedRevision: state.editor.source().revision, label: 'Delete block', commands: [{ op: 'remove', ids: ['instant-block'] }] });
  });
  await page.waitForFunction(() => !window.shipbuilderViewport.props.scene.source.construction.primitives.some(p => p.id === 'instant-block') && !window.shipbuilderViewport.props.scene.current);
  const deleted = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const view = window.shipbuilderViewport;
    for (const mesh of view.hullMeshes) mesh.updateWorldMatrix(true, false);
    const hit = new THREE.Raycaster(new THREE.Vector3(0, 8, 8), new THREE.Vector3(0, -1, 0)).intersectObjects(view.hullMeshes, true)[0];
    const surfaces = view.surfaceTriangles;
    return { deckY: hit?.point.y, hasDeleted: surfaces.some(s => s.primitiveId === 'instant-block'),
      painted: surfaces.some(s => s.primitiveId === 'hull' && s.face === 'top' && s.paint === 'teak-natural'),
      current: !!window.compilePreviewCheck.editor.result(), trialDisabled: document.querySelector('.sb-top .sb-cmd')?.disabled };
  });
  assert.equal(deleted.deckY, 2.5, 'newly exposed deck must close immediately, before the compiler returns');
  assert.equal(deleted.hasDeleted, false); assert.equal(deleted.painted, true);
  assert.equal(deleted.current, false); assert.equal(deleted.trialDisabled, true);
  await page.screenshot({ path: '.build/compile-preview/deleted-pending.png' });
  await page.setViewportSize({ width: 900, height: 760 });
  await page.screenshot({ path: '.build/compile-preview/deleted-pending-narrow.png' });
  await page.waitForFunction(() => !!window.compilePreviewCheck.release);
  await page.evaluate(() => window.compilePreviewCheck.release());
  await page.waitForFunction(() => !!window.compilePreviewCheck.editor.result());
  console.log({ burst, pending, deleted, compileMs: await page.evaluate(() => window.compilePreviewCheck.samples) });
  await page.evaluate(() => window.compilePreviewCheck.close());
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
