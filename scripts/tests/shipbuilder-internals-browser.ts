import type { ViewportProps } from '../../src/ui/shipbuilding/BuilderViewport';
import { controls, mountShipbuilderReview } from './shipbuilder-browser';

type ReviewViewport = { props: ViewportProps };
const viewport = () => window.shipbuilderViewport as unknown as ReviewViewport;
/** The viewport reads its scene description from the builder tool; the check reads the same. */
const selected = () => [...viewport().props.scene.selected];
const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); };

/** Real editor selections must not activate or mutate the hull/fittings in Internals. */
export async function checkInternalsSelection() {
  window.shipbuilderReview?.close();
  await mountShipbuilderReview();
  await controls.settled(() => !!document.querySelector('.sb-tabs'), 'editor mounted');
  await controls.settled(() => !!window.shipbuilderReview?.source, 'source ready');
  await controls.tool('Select');
  controls.key('a', { ctrlKey: true });
  await controls.settled(() => selected().includes('hull'), 'whole ship selected in Hull');
  await controls.tab('Internals');
  await controls.tool('Select');
  const ids = new Set(['engine', 'gun-forward', 'forward-bulkhead', 'aft-bulkhead']);
  assert(selected().every(id => ids.has(id)), 'Layer switch retained external selections');
  const original = structuredClone(viewport().props.scene.source.construction);
  const checks = ['entering Internals discards hull and external fitting selections and keeps the whole ship visible'];
  controls.key('a', { ctrlKey: true });
  await controls.settled(() => selected().length === ids.size, 'internal select-all');
  assert(selected().every(id => ids.has(id)), 'Select-all activated external components');
  checks.push('select-all includes internal packages, weapon-owned ammunition and room boundaries');
  controls.key('ArrowRight');
  await controls.settled(() => viewport().props.scene.source.construction.equipment.find(p => p.id === 'engine')!.position[0] !== original.equipment.find(p => p.id === 'engine')!.position[0], 'internal nudge');
  const current = viewport().props.scene.source.construction;
  assert(JSON.stringify(current.primitives) === JSON.stringify(original.primitives), 'Nudge moved the hull');
  assert(JSON.stringify(current.equipment.filter(p => !ids.has(p.id))) === JSON.stringify(original.equipment.filter(p => !ids.has(p.id))), 'Nudge moved fittings');
  checks.push('moving the internal selection preserves every hull block and external fitting');
  controls.key('z', { ctrlKey: true });
  await controls.settled(() => JSON.stringify(viewport().props.scene.source.construction) === JSON.stringify(original), 'undo internal move');
  controls.key('Escape');
  await controls.settled(() => !selected().length, 'clear selection');
  for (const point of [[3.5, 2.5, -22], [0, 5, 5]] as [number, number, number][]) {
    controls.click(...await controls.screen(point));
    await controls.settled(() => true, 'pick visible exterior');
    assert(selected().every(id => ids.has(id)), 'Exterior click activated a hull block or fitting');
    controls.click(...await controls.screen(point), { button: 2 });
    await controls.settled(() => true, 'right-click visible exterior');
    assert(JSON.stringify(viewport().props.scene.source.construction.primitives) === JSON.stringify(original.primitives), 'Right-click erased hull');
    assert(JSON.stringify(viewport().props.scene.source.construction.equipment.filter(p => !ids.has(p.id))) === JSON.stringify(original.equipment.filter(p => !ids.has(p.id))), 'Right-click erased external fittings');
  }
  checks.push('visible hull and fittings cannot be activated or erased');
  controls.key('Escape'); controls.key('q');
  await controls.settled(() => viewport().props.scene.view === 'top', 'top view');
  // In top view the ray goes through the external funnel and hull to the engine.
  const engine = viewport().props.scene.source.construction.equipment.find(item => item.id === 'engine')!;
  const part = viewport().props.scene.catalog.equipment.find(part => part.id === engine.partId)!;
  const center = engine.position.map((n, k) => n + part.boundsCenter[k]) as [number, number, number];
  const from = await controls.screen(center), to = await controls.screen([center[0] + 1, center[1], center[2]]);
  controls.click(...from);
  await controls.settled(() => selected().includes('engine'), 'select engine through hull and funnel');
  const canvas = document.querySelector<HTMLCanvasElement>('.sb-canvas canvas')!;
  const pointer = { bubbles: true, pointerId: 42, pointerType: 'mouse', button: 0, buttons: 1 };
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: from[0], clientY: from[1] }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: to[0], clientY: to[1] }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0, clientX: to[0], clientY: to[1] }));
  await controls.settled(() => viewport().props.scene.source.construction.equipment.find(item => item.id === 'engine')!.position[0] !== engine.position[0], 'drag engine through hull');
  assert(JSON.stringify(viewport().props.scene.source.construction.primitives) === JSON.stringify(original.primitives), 'Internal drag moved hull');
  assert(JSON.stringify(viewport().props.scene.source.construction.equipment.filter(p => !ids.has(p.id))) === JSON.stringify(original.equipment.filter(p => !ids.has(p.id))), 'Internal drag moved fittings');
  checks.push('click and drag reach the engine through the hull and external funnel');

  return { passed: checks.length, checks };
}

/** The Module cursor passes the deck and lands internal packages on the floor inside the hull. */
export async function checkInternalModulePlacement() {
  window.shipbuilderReview?.close();
  await mountShipbuilderReview();
  await controls.settled(() => !!document.querySelector('.sb-tabs'), 'editor mounted');
  await controls.settled(() => !!window.shipbuilderReview?.source, 'source ready');
  await controls.tab('Internals');
  await controls.settled(() => !!viewport()?.props.scene.current?.surfaces.length, 'compiled hull');
  const slot = document.querySelector<HTMLButtonElement>('.sb-hotbar .sb-slot[aria-label^="Small diesel"]');
  assert(slot, 'Small diesel slot unavailable'); slot!.click();
  await controls.settled(() => viewport().props.scene.placementPiece?.kind === 'equipment', 'module cursor');
  const scene = () => viewport().props.scene, equipment = () => scene().source.construction.equipment;
  const hull = scene().source.construction.primitives.find(p => p.id === 'hull')!;
  const bottom = hull.position[1] - hull.size[1] / 2, deck = hull.position[1] + hull.size[1] / 2;
  const checks: string[] = [];
  // Aim at the weather deck over the forward room: top view, the default perspective, then the hull side.
  const aims: { label: string; view?: 'top'; point: [number, number, number] }[] = [
    { label: 'a top-view click on the deck', view: 'top', point: [1, deck, -18] },
    { label: 'a perspective click on the deck', point: [-1, deck, -10] },
    { label: 'a click on the hull side', point: [hull.size[0] / 2, 0, 18] },
  ];
  for (const aim of aims) {
    while (aim.view ? scene().view !== aim.view : scene().view === 'top') { controls.key('q'); await controls.settled(() => true, 'cycle view'); }
    const before = new Set(equipment().map(item => item.id));
    controls.click(...await controls.screen(aim.point));
    await controls.settled(() => equipment().some(item => !before.has(item.id)), aim.label);
    const placed = equipment().find(item => !before.has(item.id))!, part = scene().catalog.equipment.find(entry => entry.id === placed.partId)!;
    const base = placed.position[1] + part.boundsCenter[1] - part.size[1] / 2;
    assert(base > bottom && base < bottom + .1, `${aim.label} left the package base at ${base}, not on the inner bottom ${bottom}`);
    assert(base + part.size[1] < deck, `${aim.label} left the package through the deck`);
    assert(Math.abs(placed.position[0]) + part.size[0] / 2 < hull.size[0] / 2, `${aim.label} left the package through the side`);
    await controls.settled(() => scene().current?.revision === scene().source.revision, 'compiled placement');
    const errors = (scene().current?.diagnostics ?? []).filter(d => d.severity === 'error' && d.sourceId === placed.id);
    assert(!errors.length, `${aim.label}: ${errors.map(d => d.message).join('; ')}`);
    checks.push(`${aim.label} lands the diesel on the inner bottom, inside the hull`);
  }
  return { passed: checks.length, checks };
}

/** Model cards must contain decoded, non-empty renders after each layer opens. */
export async function checkEquipmentPaletteImages() {
  window.shipbuilderReview?.close();
  await mountShipbuilderReview();
  await controls.settled(() => !!document.querySelector('.sb-tabs'), 'editor mounted');
  const checks: string[] = [];
  for (const layer of ['Internals', 'Machinery', 'Armament', 'Outfit']) {
    await controls.tab(layer);
    document.querySelector<HTMLButtonElement>('.sb-slot.more')!.click();
    await controls.settled(() => !!document.querySelector('.sb-drawer'), 'palette drawer');
    const cards = () => [...document.querySelectorAll<HTMLButtonElement>('.sb-drawer .sb-slot')].filter(card => !['Deck', 'Bulkhead', 'Split', 'Merge'].some(tool => card.getAttribute('aria-label') === tool));
    const deadline = performance.now() + 60000;
    while (cards().some(card => !card.querySelector<HTMLImageElement>('img')?.naturalWidth)) {
      if (performance.now() > deadline) throw new Error(`${layer} missing images: ${cards().filter(card => !card.querySelector<HTMLImageElement>('img')?.naturalWidth).map(card => card.getAttribute('aria-label')).join(', ')}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (const card of cards()) {
      const image = card.querySelector<HTMLImageElement>('img')!;
      assert(image.src.includes('/models/components/thumbnails/'), `Component image was not pre-baked: ${card.getAttribute('aria-label')}`);
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      assert(context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value > 0), `Empty image: ${card.getAttribute('aria-label')}`);
    }
    checks.push(`${layer}: ${cards().length} decoded model images with visible pixels`);
  }
  return { passed: checks.length, checks };
}

/** Invalid installed parts are marked in the scene; their explanation follows hover only. */
export async function checkInvalidPartFeedback() {
  const { loadConstructionCatalog } = await import('../../src/ships/constructionEquipment');
  const { createStarterSource } = await import('../../src/ships/constructionStarter');
  const catalog = await loadConstructionCatalog(), source = createStarterSource(catalog);
  const engine = source.construction.equipment.find(item => item.id === 'engine')!;
  source.construction.equipment.push({ ...structuredClone(engine), id: 'valid-engine' });
  engine.position[0] = 15;
  window.shipbuilderReview?.close();
  await mountShipbuilderReview(source, catalog);
  await controls.settled(() => viewport().props.scene.current?.diagnostics.some(d => d.sourceId === 'engine' && d.severity === 'error'), 'invalid engine compiled');
  const tag = () => document.querySelector('[data-tag="block-engine"]');
  assert(!tag(), 'An error tooltip appeared without hovering the part');
  await controls.tab('Internals');
  const live = window.shipbuilderViewport as unknown as { equipment: { group: import('three').Group }; props: ViewportProps };
  const meshes = (id: string) => {
    const result: import('three').Mesh[] = [];
    live.equipment.group.traverse(node => { if (node.type === 'Mesh' && node.userData.sourceId === id) result.push(node as import('three').Mesh); });
    return result;
  };
  await controls.settled(() => meshes('engine').length && meshes('valid-engine').length, 'both machinery models loaded');
  const colors = (id: string) => meshes(id).flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => (material as import('three').MeshStandardMaterial).color?.getHexString()));
  assert(colors('engine').every(color => color === 'ffb5a6'), 'Invalid machinery did not turn red');
  assert(colors('valid-engine').some(color => color !== 'ffb5a6'), 'Invalid tint leaked into another instance of the same part');
  const part = catalog.equipment.find(part => part.id === engine.partId)!;
  const point = engine.position.map((n, k) => n + part.boundsCenter[k]) as [number, number, number];
  const [clientX, clientY] = await controls.screen(point);
  const canvas = document.querySelector<HTMLCanvasElement>('.sb-canvas canvas')!;
  canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }));
  await controls.settled(() => !!tag(), 'hovered error tooltip');
  assert(tag()!.textContent?.includes('Blocks launch'), 'Hovered error has no explanation');
  assert(getComputedStyle(tag()!).pointerEvents === 'none', 'Error card obstructs the viewport pointer');
  canvas.dispatchEvent(new PointerEvent('pointerleave'));
  await controls.settled(() => !tag(), 'error tooltip disappears on pointer leave');
  return { checks: ['invalid part is red', 'same-part valid instance keeps its materials', 'error card appears only on hover and clears on leave', 'error card does not intercept clicks'] };
}
