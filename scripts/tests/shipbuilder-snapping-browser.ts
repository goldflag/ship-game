/** Run in the shipbuilder diagnostic page. Uses production controls, raycasts,
 * source history and native compilation; synthetic drag capture is scoped below. */
import { controls, mountShipbuilderReview } from './shipbuilder-browser';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { cornerVertices, worldVertex } from '../../src/ships/constructionVertex';
import type { Vec3 } from '../../src/ships/blueprint';

const wait = async (ms = 40) => {
  await new Promise(resolve => setTimeout(resolve, ms));
  await new Promise(requestAnimationFrame);
};
const viewport = () => window.shipbuilderViewport as any;
const source = () => window.constructionEditor!.source();
async function ready() {
  const start = performance.now();
  while (!window.constructionEditor || document.querySelector('.sb-ledger h4 span')) {
    if (performance.now() - start > 30000) throw new Error('Editor did not finish compiling');
    await wait();
  }
  await wait();
}
const snapButton = () => document.querySelector<HTMLButtonElement>('.sb-snap-main')!;
const centerlineVisible = () => !!document.querySelector('.sb-snap-overlay > path')?.getAttribute('d');
async function key(key: string, type = 'keydown') { document.body.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true })); await wait(); }
async function hover(point: Vec3) {
  const [clientX, clientY] = await controls.screen(point);
  document.querySelector('canvas')!.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true, pointerId: 41 }));
  await wait();
}
export async function mountSnappingReview() {
  const catalog = await loadConstructionCatalog(), draft = createStarterSource(catalog, 'blank');
  draft.name = 'Snapping review';
  draft.construction.primitives = [
    { id: 'hull', kind: 'box', position: [0, 0, 0], size: [12, 2, 20], rotationDeg: 0 },
    { id: 'target', kind: 'box', position: [-3, 2, -4], size: [2, 2, 2], rotationDeg: 0 },
    { id: 'moving', kind: 'box', position: [2, 2, 4], size: [2, 2, 2], rotationDeg: 0 },
  ];
  draft.construction.equipment = []; draft.construction.boundaries = []; draft.construction.surfaces = [];
  window.shipbuilderReview?.close(); await mountShipbuilderReview(draft, catalog); await ready();
  const view = () => document.querySelector<HTMLButtonElement>('[aria-label^="View ·"]')!;
  while (view().getAttribute('aria-label') !== 'View · Plan') { view().click(); await wait(); }
  document.querySelector<HTMLButtonElement>('[aria-label="Camera · Perspective"]')?.click(); await wait();
  document.querySelector<HTMLButtonElement>('[title^="Mirror (M)"]')?.click(); await wait();
}
export async function checkSnapping() {
  const checks: string[] = [], assert = (ok: unknown, label: string) => { if (!ok) throw new Error(label); checks.push(label); };
  await mountSnappingReview();
  assert(!centerlineVisible(), 'centerline is hidden while idle');
  assert(!viewport().floorGrid.getObjectByName('Ship centerline'), 'floor has no permanent brass centerline');
  await key('s');
  assert(document.querySelector('.sb-snap-step-cycle')?.textContent === '2 mS', 'S cycles the grid and updates the top-level size');
  document.querySelector<HTMLButtonElement>('.sb-snap-options')!.click(); await wait();
  const steps = document.querySelector('[role="group"][aria-label="Grid spacing"]')!;
  assert(steps.querySelectorAll('button').length === 5 && !steps.querySelector('select'), 'grid choices are a button row');
  steps.querySelector<HTMLButtonElement>('[aria-label="1 m"]')!.click(); await wait();
  assert(document.querySelector('.sb-snap-step-cycle')?.textContent === '1 mS' && steps.querySelector('[aria-label="1 m"]')?.getAttribute('aria-pressed') === 'true', 'grid button selection updates both selected state and rail');
  await key('Escape');
  await controls.tool('Place'); await hover([.03, 1, 6.137]);
  assert(Math.abs(viewport().ghostPosition[0]) < 1e-6, 'automatic placement snaps to centerline');
  assert(!centerlineVisible(), 'placement hover snaps without displaying the centerline');
  assert(!document.querySelector('.sb-snap-overlay text'), 'snap feedback contains no floating labels');
  await key('Alt');
  assert(snapButton().getAttribute('aria-pressed') === 'false', 'Alt shows temporary release on the control');
  assert(Math.abs(viewport().ghostPosition[0] - .03) < 1e-4 && Math.abs(viewport().ghostPosition[2] - 6.137) < 1e-4, 'temporary release immediately restores raw coordinates without moving the mouse');
  await key('Alt', 'keyup');
  assert(Math.abs(viewport().ghostPosition[0]) < 1e-6, 'release immediately reacquires snapping');
  await key('n'); await hover([.031, 1, 6.127]);
  assert(Math.abs(viewport().ghostPosition[2] - 6.127) < 1e-4, 'N disables all pointer rounding');
  await key('Alt'); assert(snapButton().getAttribute('aria-pressed') === 'true', 'Alt also enables snapping temporarily when normally off');
  await key('Alt', 'keyup'); await key('n');
  await hover([-1.48, 1, -4]);
  assert(Math.abs(viewport().ghostPosition[0] + 1.5) < 1e-5, 'nearby physical edge overrides grid placement');
  assert(viewport().snapGuides.some((g: any) => !g.centerline && g.active), 'nearby geometry draws active alignment feedback');
  await controls.tool('Select'); controls.click(...await controls.screen([2, 3, 4])); await wait();
  const input = document.querySelector<HTMLInputElement>('.sb-tag input[aria-label="x"]') ?? [...document.querySelectorAll<HTMLInputElement>('.sb-num input')].find(i => i.getAttribute('aria-label') === 'x');
  if (!input) throw new Error('Selected position field missing');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2.1234');
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await ready();
  assert(source().construction.primitives.find(p => p.id === 'moving')!.position[0] === 2.1234, 'typed position remains exact with snapping on');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2.123456789');
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await ready();
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await ready();
  assert(source().construction.primitives.find(p => p.id === 'moving')!.position[0] === 2.123456789, 'leaving an unchanged rounded field preserves source precision');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2.1234');
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await ready();
  document.querySelector<HTMLButtonElement>('[title^="Center selection on ship"]')!.click(); await ready();
  assert(source().construction.primitives.find(p => p.id === 'moving')!.position[0] === 0, 'Center action centers selected part');
  controls.key('z', { ctrlKey: true }); await ready();
  assert(source().construction.primitives.find(p => p.id === 'moving')!.position[0] === 2.1234, 'Center action undoes as one edit');
  const handle = document.querySelector<HTMLButtonElement>('.sb-move-handles [aria-label="Move selection X"]')!;
  const rect = handle.getBoundingClientRect(), start = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
  const a = await controls.screen([2.1234, 2, 4]), b = await controls.screen([.03, 2, 4]);
  const capture = handle.setPointerCapture, release = handle.releasePointerCapture;
  handle.setPointerCapture = () => {}; handle.releasePointerCapture = () => {};
  try {
    handle.dispatchEvent(new PointerEvent('pointerdown', { ...start, bubbles: true, pointerId: 77, button: 0 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: start.clientX + b[0] - a[0], clientY: start.clientY + b[1] - a[1], bubbles: true, pointerId: 77, button: 0 })); await wait();
    assert(Math.abs(viewport().moveOffset[0] + 2.1234) < 1e-5, 'axis drag uses centerline snapping');
    assert(centerlineVisible(), 'centerline appears while dragging nearby');
    await key('Alt'); assert(Math.abs(viewport().moveOffset[0] + 2.0934) < .002, 'Alt releases a live gizmo drag immediately');
    assert(centerlineVisible(), 'nearby centerline remains available with snapping temporarily released');
    handle.dispatchEvent(new PointerEvent('pointermove', { ...start, bubbles: true, pointerId: 77, button: 0 })); await wait();
    assert(!centerlineVisible(), 'centerline disappears when dragging away');
    await key('Alt', 'keyup'); await key('Escape');
    assert(source().construction.primitives.find(p => p.id === 'moving')!.position[0] === 2.1234, 'cancelled gizmo drag adds no source movement');
    assert(!centerlineVisible(), 'centerline is hidden after drag cancellation');
  } finally { handle.setPointerCapture = capture; handle.releasePointerCapture = release; }
  document.querySelector<HTMLButtonElement>('.sb-edit-freeform')!.click(); await wait();
  const oldStep = document.querySelector('.sb-snap-step-cycle')!.textContent;
  await key('s'); assert(document.querySelector('.sb-snap-step-cycle')!.textContent !== oldStep, 'S also cycles the freeform local move step');
  document.querySelector<HTMLButtonElement>('[aria-label="Mirror X"]')!.click(); await wait();
  document.querySelector<HTMLButtonElement>('.sb-freeform-handle[data-index="0"]')!.click(); await wait();
  const vertexHandle = document.querySelector<HTMLButtonElement>('[aria-label="Move local X"]')!, vr = vertexHandle.getBoundingClientRect();
  const before = source().construction.primitives.find(p => p.id === 'moving')!, corner = worldVertex(before, cornerVertices(before)[0]);
  const va = await controls.screen(corner), vb = await controls.screen([.03, corner[1], corner[2]]);
  const vertexCapture = vertexHandle.setPointerCapture, vertexRelease = vertexHandle.releasePointerCapture;
  vertexHandle.setPointerCapture = () => {}; vertexHandle.releasePointerCapture = () => {};
  try {
    vertexHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: vr.x + vr.width / 2, clientY: vr.y + vr.height / 2, bubbles: true, pointerId: 78, button: 0 }));
    vertexHandle.dispatchEvent(new PointerEvent('pointermove', { clientX: vr.x + vr.width / 2 + vb[0] - va[0], clientY: vr.y + vr.height / 2 + vb[1] - va[1], bubbles: true, pointerId: 78, button: 0 })); await wait();
    const previewCorner = () => { const p = viewport().freeformHandles.drag.replacements.find((p: any) => p.id === 'moving'); return worldVertex(p, cornerVertices(p)[0]); };
    assert(Math.abs(previewCorner()[0]) < 1e-5, 'freeform corner snaps to actual world centerline');
    assert(centerlineVisible(), 'centerline appears during nearby freeform drag');
    await key('Alt'); assert(Math.abs(previewCorner()[0] - .03) < .002, 'Alt releases freeform snapping without changing local-axis constraints');
    await key('Alt', 'keyup'); await key('Escape');
    assert(source().construction.primitives.find(p => p.id === 'moving')!.kind === 'box', 'cancelling freeform drag preserves original source shape');
  } finally { vertexHandle.setPointerCapture = vertexCapture; vertexHandle.releasePointerCapture = vertexRelease; }
  await key('Escape');
  await controls.tool('Place'); await hover([.03, 1, 6.137]);
  return checks;
}
