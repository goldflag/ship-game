import type { ConstructionSource, Vec3 } from '../../src/ships/blueprint';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { controls, mountShipbuilderReview } from './shipbuilder-browser';

/** A deck with a windlass carrying a searchlight on its top, a loose pair of bitts and a light gun. */
export function parentsFixture(source: ConstructionSource): ConstructionSource {
  source.name = 'Equipment parents review';
  source.construction.primitives = [{ id: 'review-deck', kind: 'box', size: [24, 2, 36], position: [0, 0, 0], rotationDeg: 0 }];
  source.construction.surfaces = [];
  source.construction.boundaries = [];
  source.construction.loads = [];
  source.construction.equipment = [
    { id: 'review-windlass', partId: 'generic-anchor-windlass', position: [0, 1, -4], bearingDeg: 0 },
    { id: 'review-light', partId: 'generic-static-searchlight', position: [0, 2.12, -4], bearingDeg: 0, parent: 'review-windlass' },
    { id: 'review-bitts', partId: 'generic-twin-bitts', position: [-6, 1, 8], bearingDeg: 0 },
    { id: 'review-gun', partId: 'flak38-20-single', position: [6, 1, -8], bearingDeg: 0 },
  ];
  return source;
}

/** The mounted editor honours `parent`: the tag shows what a parent carries and what a rider is attached to, a nudge
 * carries the rider, the Attached to control clears and restores the link and offers a gun, which trains it, and
 * removing the parent takes the rider. */
export async function checkEquipmentParents() {
  const catalog = await loadConstructionCatalog();
  window.shipbuilderReview?.close();
  await mountShipbuilderReview(parentsFixture(createStarterSource(catalog, 'blank')));
  const checks: string[] = [];
  const source = () => window.shipbuilderReview?.source;
  const compiled = () => !document.querySelector('.sb-ledger h4 span');
  const wait = async (predicate: () => unknown, label: string) => {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > 45_000) throw new Error(`Timed out: ${label} · ${controls.warnings()}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    checks.push(label);
  };
  const item = (id: string) => source()?.construction.equipment.find((e) => e.id === id);
  const tag = (id: string) => document.querySelector<HTMLElement>(`[data-tag="part-${id}"]`);
  const select = async (id: string, point: Vec3) => {
    controls.key('Escape');
    await controls.settled(() => true, 'clear selection');
    controls.click(...(await controls.screen(point)));
    await controls.settled(() => tag(id), `select ${id}`);
  };
  await wait(() => source() && compiled(), 'a searchlight riding a windlass compiles and saves');
  if (document.querySelector<HTMLButtonElement>('.sb-cmd')?.disabled) throw new Error(`Parented fitting blocked: ${controls.warnings()}`);
  await controls.tab('Outfit');
  await controls.tool('Select');

  await select('review-windlass', [0, 1.6, -4]);
  await wait(() => tag('review-windlass')?.textContent?.includes('carries 1'), 'the parent tag reads carries 1');
  controls.key('ArrowRight');
  await wait(() => item('review-windlass')!.position[0] > 0, 'a nudge moves the parent');
  const step = item('review-windlass')!.position[0];
  await wait(() => item('review-light')!.position[0] === step && item('review-light')!.position[1] === 2.12, 'the rider travels the same nudge');
  controls.key('z', { ctrlKey: true });
  await wait(() => item('review-light')!.position[0] === 0 && item('review-windlass')!.position[0] === 0, 'one undo returns both');
  await wait(() => compiled(), 'restored layout compiles');

  await select('review-light', [0, 3, -4]);
  const attached = () => tag('review-light')?.querySelector<HTMLSelectElement>('select[aria-label="Attached to"]');
  await wait(() => attached()?.value === 'review-windlass', 'the rider tag shows Attached to the windlass');
  if (![...attached()!.options].some((option) => option.value === 'review-deck')) throw new Error('The hull piece is not offered as a parent');
  if ([...attached()!.options].some((option) => option.value === 'review-light')) throw new Error('A fitting is offered as its own parent');
  const choose = (value: string) => {
    const input = attached()!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  choose('');
  await wait(() => item('review-light') && item('review-light')!.parent === undefined, 'Attached to Nothing clears the link');
  choose('review-deck');
  await wait(() => item('review-light')?.parent === 'review-deck', 'Attached to a hull piece sets it');
  controls.key('z', { ctrlKey: true });
  await wait(() => item('review-light')?.parent === undefined, 'undo restores the cleared link');
  controls.key('z', { ctrlKey: true });
  await wait(() => item('review-light')?.parent === 'review-windlass', 'a second undo restores the windlass');
  await wait(() => compiled(), 'relinked layout compiles');
  const gun = [...attached()!.options].find((option) => option.value === 'review-gun');
  if (!gun?.textContent?.includes(' · trains · ')) throw new Error(`A gun is not offered as a trainable parent: ${gun?.textContent}`);
  choose('review-gun');
  await wait(() => item('review-light')?.parent === 'review-gun', 'Attached to a gun sets it');
  await wait(() => compiled(), 'a searchlight riding a gun compiles');
  controls.key('z', { ctrlKey: true });
  await wait(() => item('review-light')?.parent === 'review-windlass', 'undo returns it to the windlass');

  await select('review-windlass', [0, 1.6, -4]);
  controls.key('Delete');
  await wait(() => !item('review-windlass') && !item('review-light') && item('review-bitts'), 'removing the parent removes its rider only');
  await wait(() => document.querySelector('.sb-warn')?.textContent?.includes('Removed 1 attached fitting'), 'the notice says what went with it');
  controls.key('z', { ctrlKey: true });
  await wait(() => item('review-windlass') && item('review-light')?.parent === 'review-windlass', 'one undo restores parent and rider');
  window.shipbuilderReview!.close();
  return { passed: checks.length, checks };
}
