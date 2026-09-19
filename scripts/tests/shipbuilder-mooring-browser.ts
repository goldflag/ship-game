import type { Vec3 } from '../../src/ships/blueprint';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { controls, mountShipbuilderReview } from './shipbuilder-browser';

/** Actual model raycasts, native compilation, history and saved-source recovery. */
export async function checkMastRopeAttachment() {
  const catalog = await loadConstructionCatalog(), source = createStarterSource(catalog, 'blank');
  source.id = `mooring-${crypto.randomUUID()}`; source.name = 'Mooring surface attachment';
  source.construction.primitives = [{ id: 'hull', kind: 'box', position: [0, 0, 0], size: [14, 1, 12], rotationDeg: 0 }];
  source.construction.equipment = [-3, 3].map((x, i) => ({ id: `mast-${i}`, partId: 'fletcher-aft-mast', position: [x, .5, 0], bearingDeg: 0 }));
  window.shipbuilderReview?.close(); await mountShipbuilderReview(source);
  const checks: string[] = [];
  const wait = async (condition: () => unknown, label: string) => {
    const start = performance.now();
    while (!condition()) { if (performance.now() - start > 45000) throw new Error(`Timed out: ${label}`); await new Promise(r => setTimeout(r, 25)); }
    checks.push(label);
  };
  const viewport = () => window.shipbuilderViewport as any;
  const saved = () => window.shipbuilderReview?.source;
  const ready = () => viewport()?.props.scene.current?.revision === saved()?.revision;
  await wait(() => saved()?.name === source.name && ready() && viewport().equipment.has('mast-0') && viewport().equipment.has('mast-1'), 'masts load and compile');
  await controls.tab('Outfit');
  viewport().camera.position.set(0, 6, -25); viewport().controls.target.set(0, 6, 0);
  viewport().camera.lookAt(0, 6, 0); viewport().controls.update();
  document.querySelector<HTMLButtonElement>('.sb-slot.more')!.click();
  await controls.settled(() => document.querySelector('.sb-drawer'), 'fittings drawer');
  const rope = [...document.querySelectorAll<HTMLButtonElement>('.sb-drawer .sb-slot')].find(b => b.getAttribute('aria-label')?.includes('Mooring rope'));
  if (!rope) throw new Error('Mooring rope missing from palette');
  rope.click(); await controls.settled(() => !document.querySelector('.sb-drawer'), 'rope selected');
  const mirror = document.querySelector<HTMLButtonElement>('.sb-rail button[aria-label^="Mirror"]')!;
  if (mirror.getAttribute('aria-pressed') === 'true') mirror.click();
  await controls.settled(() => mirror.getAttribute('aria-pressed') === 'false', 'mirror disabled');
  for (const [i, x] of [-3, 3].entries()) {
    // Choose the visible side facing the span, so the route leaves the post
    // outward. Clicking its far side should correctly fail native clearance.
    let screen: [number, number] | undefined;
    for (let offset = 0; offset <= .12; offset += .005) {
      const toward = i === 0 ? 1 : -1;
      const candidate = await controls.screen([x + toward * offset, 6.34, .3]);
      const hit = viewport().pick({ clientX: candidate[0], clientY: candidate[1] }, 'all');
      if (hit?.id === `mast-${i}` && hit.normal[0] * toward > .2) { screen = candidate; break; }
    }
    if (!screen) throw new Error(`Visible inward-facing mast surface missing: mast-${i}`);
    const [clientX, clientY] = screen;
    controls.click(clientX, clientY);
    await controls.settled(() => viewport().props.scene.pathDraft?.points.length === i + 1, 'surface click adds endpoint');
  }
  if (saved()!.construction.equipment.length !== 2) throw new Error('Pending rope entered saved source');
  const points: Vec3[] = viewport().props.scene.pathDraft.points;
  if (points.some(p => Math.abs(p[1] - 6.34) > .01)) throw new Error('Mast click snapped away from the chosen height');
  controls.key('Enter');
  await wait(() => saved()?.construction.equipment.length === 3 && ready(), 'surface rope finishes and saves');
  if (viewport().props.scene.current.diagnostics.some((d: any) => d.severity === 'error')) throw new Error(JSON.stringify(viewport().props.scene.current.diagnostics));
  const route = saved()!.construction.equipment.at(-1)!;
  controls.key('z', { ctrlKey: true });
  await wait(() => saved()?.construction.equipment.length === 2 && ready(), 'one undo removes the rope');
  controls.key('z', { ctrlKey: true, shiftKey: true });
  await wait(() => saved()?.construction.equipment.some(e => e.id === route.id) && ready(), 'redo restores the same rope');
  const { openConstructionStore } = await import('../../src/ships/constructionStore');
  const store = await openConstructionStore();
  try {
    const recovered = JSON.parse((await store.load(saved()!.id)).revision.sourceJson);
    if (JSON.stringify(recovered.construction.equipment.at(-1)) !== JSON.stringify(route)) throw new Error('Saved rope differs from its preview');
    checks.push('reloaded source preserves surface endpoints');
  } finally { store.close(); }
  return { checks, route, points };
}
