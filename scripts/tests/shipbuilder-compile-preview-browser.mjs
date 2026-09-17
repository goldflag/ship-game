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
    const client = new ConstructionClient(), state = window.compilePreviewCheck = { held: false, samples: [] };
    const compiler = {
      async compile(source, signal) {
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
      openStore: () => openConstructionStore({ name: database }), onEditorReady: editor => { state.editor = editor; }, onClose() {}, onLaunch() {} }));
  });
  await page.waitForFunction(() => window.shipbuilderViewport?.props.scene.current && window.shipbuilderViewport.composed.children.length);
  await mkdir('.build/compile-preview', { recursive: true });
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
  console.log({ pending, compileMs: await page.evaluate(() => window.compilePreviewCheck.samples) });
  await page.evaluate(() => window.compilePreviewCheck.close());
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
