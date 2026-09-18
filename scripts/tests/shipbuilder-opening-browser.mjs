// Run against this checkout's Vite server. Exercise cold opening and reuse of
// the same finished revision the port keeps, with a real compiler and renderer.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

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
    const { registerLocalShip } = await import('/src/ships/localShips.ts');
    await import('/src/ui/styles.css');
    const catalog = await loadConstructionCatalog(), source = createStarterSource(catalog);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const state = window.openingCheck = { calls: 0 }, database = `opening-check-${crypto.randomUUID()}`;
    let root;
    state.mount = () => {
      const client = new ConstructionClient();
      root = createRoot(host);
      root.render(React.createElement(Shipbuilder, { catalog, initialSource: source,
        compileClient: { async compile(input, signal) {
          state.calls++;
          const result = await client.compile(input, signal);
          await new Promise(resolve => { state.release = resolve; });
          state.release = undefined;
          return result;
        }, dispose() { client.dispose(); } },
        openStore: () => openConstructionStore({ name: database }),
        onEditorReady: editor => { state.editor = editor; }, onClose() {}, onLaunch() {} }));
    };
    state.reopen = async () => {
      await state.editor.flush();
      registerLocalShip(state.editor.source(), state.editor.result());
      root.unmount(); state.calls = 0; state.mount();
    };
    state.close = () => { root.unmount(); indexedDB.deleteDatabase(database); };
    state.mount();
  });
  await page.waitForFunction(() => !!window.openingCheck.release);
  assert.equal(await page.locator('.sb-canvas canvas').count(), 0, 'cold opening must wait for the finished hull');
  await page.evaluate(() => window.openingCheck.release());
  await page.waitForFunction(() => !!window.openingCheck.editor?.result() && !!document.querySelector('.sb-canvas canvas'));
  await mkdir('.build/editor-opening', { recursive: true });
  await page.screenshot({ path: '.build/editor-opening/finished.png' });
  await page.evaluate(() => window.openingCheck.reopen());
  await page.waitForFunction(() => !!window.openingCheck.editor?.result() && !!document.querySelector('.sb-canvas canvas'));
  assert.equal(await page.evaluate(() => window.openingCheck.calls), 0, 'opening a finished revision must not compile again');
  await page.evaluate(() => {
    const view = window.shipbuilderViewport, state = window.openingCheck;
    view.controls.enableDamping = false;
    view.controls.target.set(3, 2, 7); view.camera.position.set(43, 24, 51); view.controls.update();
    state.camera = [...view.camera.position.toArray(), ...view.controls.target.toArray(), view.camera.zoom];
    state.editor.apply({ version: 1, expectedRevision: state.editor.source().revision, label: 'Place block', commands: [
      { op: 'primitive', value: { id: 'opening-block', kind: 'box', size: [2, 2, 2], position: [0, 3.5, 8], rotationDeg: 0 } },
    ] });
  });
  await page.waitForFunction(() => !!window.openingCheck.release);
  assert.equal(await page.locator('.sb-canvas canvas').count(), 1, 'editing keeps the existing viewport');
  await page.evaluate(() => window.openingCheck.release());
  await page.waitForFunction(() => !!window.openingCheck.editor.result());
  const camera = await page.evaluate(() => {
    const view = window.shipbuilderViewport;
    return { before: window.openingCheck.camera, after: [...view.camera.position.toArray(), ...view.controls.target.toArray(), view.camera.zoom] };
  });
  camera.before.forEach((value, i) => assert.ok(Math.abs(value - camera.after[i]) < 1e-8, 'compilation must preserve camera framing'));
  await page.evaluate(() => window.openingCheck.close());
  assert.deepEqual(errors, []);
  console.log('Cold opening, finished revision reuse, editing and camera preservation passed.');
} finally { await browser.close(); }
