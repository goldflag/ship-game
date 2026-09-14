import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-condensed/500.css';
import '../../src/ui/styles.css';
import { Shipbuilder } from '../../src/ui/shipbuilding/Shipbuilder';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import type { ConstructionResult, ConstructionSource } from '../../src/ships/blueprint';

declare global { interface Window { shipbuilderReview?: { source?: ConstructionSource; launched?: ConstructionResult; close(): void }; } }

/** Independent mounted surface for editor/browser review; runtime trial integration is checked through App. */
export async function mountShipbuilderReview() {
  const catalog = await loadConstructionCatalog();
  const host = document.createElement('div'); document.body.replaceChildren(host); document.body.style.margin = '0';
  const root = createRoot(host);
  const review: NonNullable<Window['shipbuilderReview']> = { close: () => { root.unmount(); host.remove(); } };
  window.shipbuilderReview = review;
  root.render(<Shipbuilder catalog={catalog} starterSource={createStarterSource(catalog)} onClose={review.close}
    onSave={source => { review.source = source; }} onLaunch={(_source, result) => { review.launched = result; }}/>);
  return { equipmentCount: catalog.equipment.length, catalogRevision: catalog.revision };
}

export async function checkShipbuilderEditing() {
  const checks: string[] = [];
  const wait = async (condition: () => unknown, message: string) => {
    const start = performance.now();
    while (!condition()) {
      if (performance.now() - start > 15000) throw new Error(`Timed out: ${message}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    checks.push(message);
  };
  const button = (text: string) => {
    const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text);
    if (!element || element.disabled) throw new Error(`Button unavailable: ${text}`);
    element.click();
  };
  const source = () => window.shipbuilderReview!.source!;
  const key = (key: string, options: KeyboardEventInit = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  await wait(() => source(), 'initial source saved');
  const tools = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Tools');
  if (tools && tools.offsetParent && tools.getAttribute('aria-expanded') !== 'true') { tools.click(); await new Promise(resolve => setTimeout(resolve, 25)); }
  button('Blank'); await wait(() => source().construction.primitives.length === 0, 'blank design remains saveable');
  button('Place at coordinates'); await wait(() => source().construction.primitives.length === 1, 'coordinate placement saves a hull primitive');
  key('a', { ctrlKey: true }); await new Promise(resolve => setTimeout(resolve, 20));
  key('d', { ctrlKey: true }); await wait(() => source().construction.primitives.length === 2, 'copy creates new stable IDs');
  const copiedIds = source().construction.primitives.map(part => part.id);
  if (new Set(copiedIds).size !== 2) throw new Error('Copy reused a primitive ID');
  key('z', { ctrlKey: true }); await wait(() => source().construction.primitives.length === 1, 'undo restores source');
  key('z', { ctrlKey: true, shiftKey: true }); await wait(() => source().construction.primitives.length === 2, 'redo restores exact source references');
  if (source().construction.primitives.map(part => part.id).join() !== copiedIds.join()) throw new Error('Redo changed stable IDs');
  button('Surfaces');
  await wait(() => [...document.querySelectorAll<HTMLButtonElement>('button')].some(button => button.textContent?.trim() === 'All exposed faces' && !button.disabled), 'native compiled faces become selectable');
  button('All exposed faces'); await new Promise(resolve => setTimeout(resolve, 20));
  const thickness = [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('Thickness'))?.querySelector('input');
  if (!thickness) throw new Error('Armor thickness field missing');
  thickness.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(thickness, '37'); thickness.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20)); thickness.blur(); await new Promise(resolve => setTimeout(resolve, 20));
  button('Apply to selected faces'); await wait(() => source().construction.surfaces.some(surface => surface.thicknessMm === 37), 'millimeter armor assignments save through the actual controls');
  button('Open to sea'); await wait(() => source().construction.surfaces.some(surface => surface.open), 'explicit openings remain distinct from armor');
  key('z', { ctrlKey: true }); await wait(() => source().construction.surfaces.every(surface => !surface.open), 'undo restores closed skin and armor together');
  button('Rooms'); await new Promise(resolve => setTimeout(resolve, 25)); button('Split with bulkhead'); await wait(() => source().construction.boundaries.length === 1, 'internal boundary source survives autosave');
  button('Equipment');
  await new Promise(resolve => setTimeout(resolve, 25));
  const part = document.querySelector<HTMLButtonElement>('.shipbuilder-catalog button'); if (!part) throw new Error('Catalog unavailable'); part.click();
  await new Promise(resolve => setTimeout(resolve, 20)); button('Place at coordinates');
  await wait(() => source().construction.equipment.length === 1, 'fixed equipment placement remains saved even with a fit error');
  const saved = structuredClone(source());
  const { openConstructionStore } = await import('../../src/ships/constructionStore');
  const store = await openConstructionStore();
  try {
    const latest = await store.load(saved.id);
    if (JSON.stringify(JSON.parse(latest.revision.sourceJson)) !== JSON.stringify(saved)) throw new Error('Reopened source changed');
    checks.push('reopened IndexedDB source matches visible edited design');
  } finally { store.close(); }
  window.shipbuilderReview!.close();
  await wait(() => !document.querySelector('canvas'), 'closing disposes the editor canvas');
  return { passed: checks.length, checks, sourceId: saved.id };
}
