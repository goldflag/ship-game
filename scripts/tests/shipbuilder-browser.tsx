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
export async function mountShipbuilderReview(source?: ConstructionSource) {
  const catalog = await loadConstructionCatalog();
  const host = document.createElement('div'); document.body.replaceChildren(host); document.body.style.margin = '0';
  const root = createRoot(host);
  const review: NonNullable<Window['shipbuilderReview']> = { close: () => { root.unmount(); host.remove(); } };
  window.shipbuilderReview = review;
  root.render(<Shipbuilder catalog={catalog} starterSource={source ?? createStarterSource(catalog)} onClose={review.close}
    onSave={source => { review.source = source; }} onLaunch={(_source, result) => { review.launched = result; }}/>);
  return { equipmentCount: catalog.equipment.length, catalogRevision: catalog.revision };
}

/** The native solver adds missing internals; applying or undoing never changes the hull. */
export async function checkShipbuilderSuggestions() {
  const catalog = await loadConstructionCatalog(), template = createStarterSource(catalog);
  template.construction.equipment = [];
  window.shipbuilderReview?.close(); await mountShipbuilderReview(template);
  const checks: string[] = [];
  const source = () => window.shipbuilderReview?.source;
  const wait = async (condition: () => unknown, label: string) => {
    const start = performance.now();
    while (!condition()) {
      if (performance.now() - start > 45000) throw new Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    checks.push(label);
  };
  const find = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.shipbuilder button')].find(button => button.textContent?.trim() === text);
  const click = (text: string) => { const button = find(text); if (!button || button.disabled) throw new Error(`Button unavailable: ${text}`); button.click(); };
  await wait(() => source() && !document.querySelector('.shipbuilder-compile')?.textContent?.includes('Compiling'), 'hull-only source compiles and saves');
  const before = JSON.stringify(source()!.construction);
  if (find('Tools')?.offsetParent) { click('Tools'); await new Promise(resolve => setTimeout(resolve, 25)); }
  click('Equipment'); await new Promise(resolve => setTimeout(resolve, 25)); click('Suggest internals');
  await wait(() => find('Apply suggestion'), 'native missing-internals proposal is available');
  if (JSON.stringify(source()!.construction) !== before) throw new Error('Proposal changed source before apply');
  checks.push('proposal keeps saved source unchanged until apply');
  const name = document.querySelector<HTMLInputElement>('.shipbuilder-name')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Changed while reviewing layout');
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => find('Apply suggestion')?.disabled, 'editing fences an obsolete proposal');
  await wait(() => !find('Suggest internals')?.disabled, 'new source compilation leaves suggestions available');
  click('Suggest internals'); await wait(() => find('Apply suggestion') && !find('Apply suggestion')!.disabled, 'current revision receives a fresh proposal');
  click('Apply suggestion'); await wait(() => source()!.construction.equipment.length >= 2, 'one apply saves machinery and magazine');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await wait(() => JSON.stringify(source()!.construction) === before, 'one undo restores exact hull and module references');
  await wait(() => !find('Suggest internals')?.disabled, 'restored hull is compiled before another suggestion');
  const oversized = catalog.equipment.find(part => part.id === 'sk-c34-380-twin')!;
  const fitting = [...document.querySelectorAll<HTMLButtonElement>('.shipbuilder-catalog button')].find(button => button.textContent?.startsWith(oversized.name))!;
  fitting.click(); await new Promise(resolve => setTimeout(resolve, 25)); click('Suggest selected fitting');
  await wait(() => document.querySelector('.shipbuilder-suggestion .shipbuilder-error'), 'oversized fitting produces a native placement explanation');
  if (find('Apply suggestion') || JSON.stringify(source()!.construction) !== before) throw new Error('Failed layout modified source');
  checks.push('failed proposal preserves source and has no apply action');
  window.shipbuilderReview!.close();
  return { passed: checks.length, checks };
}

/** Armor presets and both painting paths preserve the authored protection and openings. */
export async function checkShipbuilderArmor() {
  const catalog = await loadConstructionCatalog(), template = createStarterSource(catalog);
  template.construction.equipment = []; template.construction.boundaries = []; template.construction.surfaces = [];
  window.shipbuilderReview?.close(); await mountShipbuilderReview(template);
  const checks: string[] = [], source = () => window.shipbuilderReview?.source;
  const wait = async (condition: () => unknown, label: string) => {
    const start = performance.now();
    while (!condition()) {
      if (performance.now() - start > 45000) throw new Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    checks.push(label);
  };
  const find = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.shipbuilder button')].find(button => button.textContent?.trim() === text);
  const click = (text: string) => { const button = find(text); if (!button || button.disabled) throw new Error(`Button unavailable: ${text}`); button.click(); };
  await wait(() => source() && !document.querySelector('.shipbuilder-compile')?.textContent?.includes('Compiling'), 'armor fixture compiles and saves');
  if (find('Tools')?.offsetParent) { click('Tools'); await new Promise(resolve => setTimeout(resolve, 25)); }
  click('Surfaces'); await new Promise(resolve => setTimeout(resolve, 25)); click('All exposed faces');
  const original = JSON.stringify(source()!.construction);
  document.querySelector<HTMLButtonElement>('[aria-label="Armor preset"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 25));
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.trim() === '100 mm armor steel')!.click();
  await new Promise(resolve => setTimeout(resolve, 25));
  if (JSON.stringify(source()!.construction) !== original) throw new Error('Choosing a preset applied an unconfirmed source edit');
  checks.push('choosing an armor preset leaves the source unchanged until apply');
  click('Apply to selected faces');
  await wait(() => source()!.construction.surfaces.every(surface => surface.thicknessMm === 100 && surface.material === 'armor-steel'), 'armor preset applies exact millimeter thickness and material');
  await wait(() => document.querySelector('[aria-label="Selected face armor"]')?.textContent?.includes('100 mm · Armor steel'), 'selected inspection reports current native thickness and coverage');
  // A different pending protection setting must not leak into either paint-only action.
  document.querySelector<HTMLButtonElement>('[aria-label="Armor preset"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 25));
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.trim() === 'Structural skin')!.click();
  await new Promise(resolve => setTimeout(resolve, 25));
  document.querySelector<HTMLButtonElement>('[aria-label="Sea blue"]')!.click(); await new Promise(resolve => setTimeout(resolve, 25)); click('Paint selected faces');
  await wait(() => source()!.construction.surfaces.every(surface => surface.paint === 'sea-blue'), 'bulk painting changes the selected paint');
  if (!source()!.construction.surfaces.every(surface => surface.thicknessMm === 100 && surface.material === 'armor-steel')) throw new Error('Bulk painting changed protection');
  checks.push('bulk painting preserves thickness and material');
  click('Open to sea');
  await wait(() => source()!.construction.surfaces.every(surface => surface.open), 'explicit openings are saved before repainting');
  await wait(() => document.querySelector('[aria-label="Selected face armor"]')?.textContent?.includes('Open to sea'), 'inspection distinguishes openings from protected skin');
  document.querySelector<HTMLButtonElement>('[aria-label="Red oxide"]')!.click();
  [...document.querySelectorAll('label')].find(label => label.textContent?.trim() === 'Paint clicked faces')!.querySelector<HTMLInputElement>('input')!.click();
  click('Top');
  if (find('Tools')?.getAttribute('aria-expanded') === 'true') click('Tools');
  await new Promise(resolve => setTimeout(resolve, 100));
  const canvas = document.querySelector('canvas')!, host = canvas.parentElement!, bounds = canvas.getBoundingClientRect();
  // Synthetic pointers have no browser capture lifetime; the actual native-face raycast still runs.
  const capture = host.setPointerCapture; host.setPointerCapture = () => {};
  try {
    const point = { bubbles: true, pointerId: 41, pointerType: 'mouse', button: 0, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', point)); canvas.dispatchEvent(new PointerEvent('pointerup', point));
  } finally { host.setPointerCapture = capture; }
  await wait(() => source()!.construction.surfaces.some(surface => surface.paint === 'red-oxide'), 'clicked-face painting reaches the native selected surface');
  if (!source()!.construction.surfaces.every(surface => surface.thicknessMm === 100 && surface.material === 'armor-steel' && surface.open)) throw new Error('Clicked-face painting changed protection or closed an opening');
  checks.push('clicked-face painting preserves armor, material and openings');
  const beforeUndo = structuredClone(source()!.construction);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await wait(() => source()!.construction.surfaces.every(surface => surface.paint === 'sea-blue'), 'one undo restores the paint stroke');
  if (JSON.stringify(source()!.construction.surfaces.map(({ paint: _paint, ...surface }) => surface)) !== JSON.stringify(beforeUndo.surfaces.map(({ paint: _paint, ...surface }) => surface))) throw new Error('Paint undo changed surface references');
  checks.push('paint undo retains exact protection and stable source face references');
  window.shipbuilderReview!.close();
  return { passed: checks.length, checks };
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
  await new Promise(resolve => setTimeout(resolve, 20)); thickness.blur();
  // A background embedded page may not receive a native focus transition.
  thickness.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
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
