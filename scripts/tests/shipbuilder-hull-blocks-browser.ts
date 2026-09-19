import { controls, mountShipbuilderReview } from './shipbuilder-browser';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { ConstructionClient } from '../../src/ships/constructionClient';
import { openConstructionStore } from '../../src/ships/constructionStore';
import { mirroredPrimitive } from '../../src/ships/constructionEditor';
import type { ConstructionSource } from '../../src/ships/blueprint';
import { HULL_SHAPES } from '../../src/ui/shipbuilding/builderLayers';

const source = () => window.shipbuilderReview!.source!;
const pause = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
const compiled = () => !!source() && !document.querySelector('.sb-ledger h4 span');
async function wait(check: () => unknown, label: string) {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > 45_000) throw new Error(`Timed out: ${label}`);
    await pause();
  }
}
async function textInput(input: HTMLInputElement, value: string) {
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await pause();
  // Hidden review tabs may not acquire native focus; React still receives the
  // same commit event as the user's blur/Enter path.
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); input.blur(); await pause();
}
async function choose(name: string, search: string) {
  document.querySelector<HTMLButtonElement>('.sb-slot.more')!.click();
  await wait(() => document.querySelector('.sb-drawer .sb-search input'), 'shape drawer opens');
  await textInput(document.querySelector<HTMLInputElement>('.sb-drawer .sb-search input')!, search);
  const button = [...document.querySelectorAll<HTMLButtonElement>('.sb-drawer .sb-slot')]
    .find(button => button.getAttribute('aria-label') === name);
  if (!button) throw new Error(`Missing shape: ${name}`);
  button.click(); await controls.settled(() => !document.querySelector('.sb-drawer') && document.querySelector('.sb-cursor b')?.textContent === name, name);
}

/** Exercises the actual palette, number fields, raycast placement, history and
 * IndexedDB paths. Run on /scripts/diagnostics/shipbuilder.html in Vite. */
export async function checkShipbuilderHullBlocks() {
  const catalog = await loadConstructionCatalog(), fixture = createStarterSource(catalog, 'blank');
  fixture.name = 'Hull blocks review'; fixture.construction.primitives[0].size = [24, 4, 48];
  window.shipbuilderReview?.close(); await mountShipbuilderReview(fixture);
  const checks: string[] = [];
  await wait(compiled, 'review hull compiles');
  document.querySelector<HTMLButtonElement>('.sb-slot.more')!.click();
  await wait(() => document.querySelectorAll('.sb-drawer .sb-slot').length === HULL_SHAPES.length, 'every shape preset appears');
  const names = [...document.querySelectorAll('.sb-drawer .sb-slot')].map(button => button.getAttribute('aria-label')!);
  if (names.some(name => /adjustable|vertex|reference drawing|smooth\)/i.test(name))) throw new Error('Excluded or redundant variants appeared');
  checks.push(`${names.length} distinct presets; excluded editor/reference variants absent`);
  await textInput(document.querySelector<HTMLInputElement>('.sb-drawer .sb-search input')!, 'bridge');
  await wait(() => document.querySelectorAll('.sb-drawer .sb-slot').length === 6, 'bridge search finds six approved variants');
  checks.push('search finds straight, diagonal and rounded bridge blocks and panels');
  await textInput(document.querySelector<HTMLInputElement>('.sb-drawer .sb-search input')!, 'no-matching-shape');
  await wait(() => document.querySelector('.sb-drawer-grid')?.textContent === 'No shape matches', 'empty search is explained');
  document.querySelector<HTMLButtonElement>('.sb-drawer-close')!.click(); await pause();

  await choose('Bridge', 'bridge');
  await textInput(document.querySelector<HTMLInputElement>('.sb-cursor input')!, '6');
  controls.key('r'); await controls.settled(() => document.querySelector('.sb-cursor')?.textContent?.includes('90°'), 'rotate bridge preview');
  controls.click(...await controls.screen([0, 2, -12]));
  await wait(() => source().construction.primitives.length === 2, 'bridge placement saves');
  const bridge = source().construction.primitives.find(piece => piece.kind === 'bridge')!;
  if (bridge.size.join() !== '6,3,4' || bridge.rotationDeg !== 90 || Math.abs(bridge.position[1] - 3.5) > 1e-5) throw new Error(`Bridge size, turn or attachment failed: ${JSON.stringify(bridge)}`);
  checks.push('resized and rotated bridge attaches to the selected hull face');
  await wait(compiled, 'bridge compiles');

  await choose('Quarter hemisphere shell', 'quarter hemisphere');
  await textInput(document.querySelector<HTMLInputElement>('.sb-cursor input')!, '6');
  controls.click(...await controls.screen([6, 2, 0]));
  await wait(() => source().construction.primitives.length === 4, 'mirrored curved pair saves');
  const pair = source().construction.primitives.filter(piece => piece.kind === 'quarter-hemisphere-shell');
  const mirror = mirroredPrimitive(pair[0]);
  if (pair.length !== 2 || pair[1].size.join() !== mirror.size.join() || pair[1].rotationDeg !== mirror.rotationDeg || pair[1].position.join() !== mirror.position.join()) throw new Error('The asymmetric curve did not mirror its size, turn and position');
  checks.push('asymmetric curved shells mirror width, length, position and quarter-turn');
  const placed = JSON.stringify(source().construction.primitives);
  controls.key('z', { ctrlKey: true }); await wait(() => source().construction.primitives.length === 2, 'undo curved pair');
  controls.key('z', { ctrlKey: true, shiftKey: true }); await wait(() => JSON.stringify(source().construction.primitives) === placed, 'redo preserves exact curved IDs');
  checks.push('one undo removes both mirrored shells; redo restores their stable IDs');
  await wait(compiled, 'restored pair compiles');

  controls.key('m'); await controls.settled(() => document.querySelector('.sb-rail button[aria-label^="Mirror"]')?.getAttribute('aria-pressed') === 'false', 'disable mirror');
  await choose('100 t ballast', 'ballast');
  await textInput(document.querySelector<HTMLInputElement>('.sb-cursor input')!, '5');
  controls.click(...await controls.screen([-6, 2, 12]));
  await wait(() => source().construction.primitives.length === 5, 'ballast saves');
  await wait(compiled, 'ballast compiles');
  const saved = structuredClone(source()), ballast = saved.construction.primitives.find(piece => piece.kind === 'ballast')!;
  if (ballast.size[0] !== 5) throw new Error('Ballast resizing did not save');
  const client = new ConstructionClient();
  let native;
  try { native = await client.compile(saved); } finally { client.dispose(); }
  const payload = native.loading?.contributions.find(part => part.id === ballast.id && part.kind === 'load');
  if (!native.definition || !payload || payload.massKg !== 100_000) throw new Error(`Ballast is not a fixed 100 t load: ${JSON.stringify(native.diagnostics)}`);
  checks.push('resized ballast compiles as exactly 100,000 kg of payload, plus its separate casing');
  const store = await openConstructionStore();
  let reopened: ConstructionSource;
  try { reopened = JSON.parse((await store.load(saved.id)).revision.sourceJson); } finally { store.close(); }
  if (JSON.stringify(reopened) !== JSON.stringify(saved)) throw new Error('Reloaded source differs from the visible draft');
  window.shipbuilderReview!.close(); await mountShipbuilderReview(reopened);
  await wait(() => compiled() && JSON.stringify(source().construction) === JSON.stringify(saved.construction), 'reopened design compiles');
  checks.push('IndexedDB reopen preserves every new kind, dimension, rotation and stable ID');
  return { passed: checks.length, checks, sourceId: saved.id, massKg: native.loading!.massKg, ballastPayloadKg: payload.massKg };
}
