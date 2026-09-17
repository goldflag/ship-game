import type { ViewportProps } from '../../src/ui/shipbuilding/BuilderViewport';
import { controls, mountShipbuilderReview } from './shipbuilder-browser';

type ReviewViewport = { props: ViewportProps };
const viewport = () => window.shipbuilderViewport as unknown as ReviewViewport;
const selected = () => [...viewport().props.selected];
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
  const original = structuredClone(viewport().props.source.construction);
  const checks = ['entering Internals discards hull and external fitting selections'];
  controls.key('a', { ctrlKey: true });
  await controls.settled(() => selected().length === ids.size, 'internal select-all');
  assert(selected().every(id => ids.has(id)), 'Select-all activated external components');
  checks.push('select-all includes internal packages, weapon-owned ammunition and room boundaries');
  controls.key('ArrowRight');
  await controls.settled(() => viewport().props.source.construction.equipment.find(p => p.id === 'engine')!.position[0] !== original.equipment.find(p => p.id === 'engine')!.position[0], 'internal nudge');
  const current = viewport().props.source.construction;
  assert(JSON.stringify(current.primitives) === JSON.stringify(original.primitives), 'Nudge moved the hull');
  assert(JSON.stringify(current.equipment.filter(p => !ids.has(p.id))) === JSON.stringify(original.equipment.filter(p => !ids.has(p.id))), 'Nudge moved fittings');
  checks.push('moving the internal selection preserves every hull block and external fitting');
  controls.key('z', { ctrlKey: true });
  await controls.settled(() => JSON.stringify(viewport().props.source.construction) === JSON.stringify(original), 'undo internal move');
  controls.key('Escape');
  await controls.settled(() => !selected().length, 'clear selection');
  // Disable the cut so even fully visible external components must remain unselectable.
  controls.key('s');
  await controls.settled(() => viewport().props.slice === undefined, 'slice off');
  for (const point of [[3.5, 2.5, -22], [0, 5, 5]] as [number, number, number][]) {
    controls.click(...await controls.screen(point));
    await controls.settled(() => true, 'pick visible exterior');
    assert(selected().every(id => ids.has(id)), 'Exterior click activated a hull block or fitting');
    controls.click(...await controls.screen(point), { button: 2 });
    await controls.settled(() => true, 'right-click visible exterior');
    assert(JSON.stringify(viewport().props.source.construction.primitives) === JSON.stringify(original.primitives), 'Right-click erased hull');
    assert(JSON.stringify(viewport().props.source.construction.equipment.filter(p => !ids.has(p.id))) === JSON.stringify(original.equipment.filter(p => !ids.has(p.id))), 'Right-click erased external fittings');
  }
  checks.push('visible hull and fittings cannot be activated or erased with slice off');
  controls.key('Escape'); controls.key('q');
  await controls.settled(() => viewport().props.view === 'top', 'top view');
  // In top view the ray goes through the external funnel and hull to the engine.
  const engine = viewport().props.source.construction.equipment.find(item => item.id === 'engine')!;
  const part = viewport().props.catalog.equipment.find(part => part.id === engine.partId)!;
  const center = engine.position.map((n, k) => n + part.boundsCenter[k]) as [number, number, number];
  const from = await controls.screen(center), to = await controls.screen([center[0] + 1, center[1], center[2]]);
  controls.click(...from);
  await controls.settled(() => selected().includes('engine'), 'select engine through hull and funnel');
  const canvas = document.querySelector<HTMLCanvasElement>('.sb-canvas canvas')!;
  const pointer = { bubbles: true, pointerId: 42, pointerType: 'mouse', button: 0, buttons: 1 };
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: from[0], clientY: from[1] }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: to[0], clientY: to[1] }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0, clientX: to[0], clientY: to[1] }));
  await controls.settled(() => viewport().props.source.construction.equipment.find(item => item.id === 'engine')!.position[0] !== engine.position[0], 'drag engine through hull');
  assert(JSON.stringify(viewport().props.source.construction.primitives) === JSON.stringify(original.primitives), 'Internal drag moved hull');
  assert(JSON.stringify(viewport().props.source.construction.equipment.filter(p => !ids.has(p.id))) === JSON.stringify(original.equipment.filter(p => !ids.has(p.id))), 'Internal drag moved fittings');
  checks.push('click and drag reach the engine through the hull and external funnel');

  return { passed: checks.length, checks };
}

/** Model cards must contain decoded, non-empty renders after each layer opens. */
export async function checkEquipmentPaletteImages() {
  window.shipbuilderReview?.close();
  await mountShipbuilderReview();
  await controls.settled(() => !!document.querySelector('.sb-tabs'), 'editor mounted');
  const checks: string[] = [];
  for (const layer of ['Internals', 'Fittings']) {
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
