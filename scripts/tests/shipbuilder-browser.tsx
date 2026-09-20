import type { ConstructionStore } from '../../src/ships/constructionStore';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-condensed/500.css';
import '../../src/ui/styles.css';
import { Shipbuilder } from '../../src/ui/shipbuilding/Shipbuilder';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, Vec3 } from '../../src/ships/blueprint';

declare global {
  interface Window {
    shipbuilderReview?: { source?: ConstructionSource; launched?: ConstructionResult; close(): void };
    shipbuilderViewport?: { camera: { projectionMatrix: unknown }; project?(point: Vec3): unknown };
  }
}

/** Independent mounted surface for editor/browser review; runtime trial integration is checked through App. */
export async function mountShipbuilderReview(
  source?: ConstructionSource,
  retainedCatalog?: ConstructionCatalog,
  openStore?: () => Promise<ConstructionStore>,
) {
  const catalog = retainedCatalog ?? (await loadConstructionCatalog());
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  document.body.style.margin = '0';
  const root = createRoot(host);
  const review: NonNullable<Window['shipbuilderReview']> = {
    close: () => {
      root.unmount();
      host.remove();
    },
  };
  window.shipbuilderReview = review;
  root.render(
    <Shipbuilder
      openStore={openStore}
      onEditorReady={(editor) => {
        window.constructionEditor = editor;
      }}
      catalog={catalog}
      starterSource={source ?? createStarterSource(catalog)}
      onClose={review.close}
      onSave={(source) => {
        review.source = source;
      }}
      onLaunch={(_source, result) => {
        review.launched = result;
      }}
    />,
  );
  return { equipmentCount: catalog.equipment.length, catalogRevision: catalog.revision };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const source = () => window.shipbuilderReview?.source;
/** The ledger heading carries "compiling…" until the current revision has a native result. */
const compiled = () => !document.querySelector('.sb-ledger h4 span');
function waiter(checks: string[], timeout = 45000) {
  return async (condition: () => unknown, label: string) => {
    const start = performance.now();
    while (!condition()) {
      if (performance.now() - start > timeout) throw new Error(`Timed out: ${label}`);
      await sleep(25);
    }
    checks.push(label);
  };
}
/** Slipway rails controls: tabs by name, rail tools by their title, hotbar slots by number, keys on the body. */
export const controls = {
  /** React commits and the viewport's prop update both land before the next paint; wait two frames past the pressed state. */
  settled: async (condition: () => unknown, label: string) => {
    const start = performance.now();
    while (!condition()) {
      if (performance.now() - start > 5000) throw new Error(`Control did not settle: ${label}`);
      await sleep(20);
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
  },
  tab: async (name: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.sb-tabs button')].find((item) => item.textContent?.trim() === name);
    if (!button) throw new Error(`Tab unavailable: ${name}`);
    button.click();
    await controls.settled(() => button.getAttribute('aria-selected') === 'true', name);
  },
  tool: async (name: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.sb-rail button')].find((item) =>
      item.getAttribute('aria-label')?.startsWith(`${name} (`),
    );
    if (!button || button.disabled) throw new Error(`Tool unavailable: ${name}`);
    button.click();
    await controls.settled(() => button.getAttribute('aria-pressed') !== 'false', name);
  },
  /** The hotbar card whose name matches, e.g. the Armor layer's Opening. */
  card: async (name: string) => {
    const cards = [...document.querySelectorAll<HTMLButtonElement>('.sb-hotbar .sb-slot')],
      index = cards.findIndex((item) => item.getAttribute('aria-label')?.startsWith(name) || item.textContent?.includes(name));
    if (index < 0) throw new Error(`Card unavailable: ${name}`);
    await controls.slot(index + 1);
  },
  slot: async (index: number) => {
    const button = document.querySelectorAll<HTMLButtonElement>('.sb-hotbar .sb-slot')[index - 1];
    if (!button || button.disabled) throw new Error(`Slot unavailable: ${index}`);
    button.click();
    await controls.settled(() => true, `slot ${index}`);
  },
  key: (key: string, options: KeyboardEventInit = {}) =>
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options })),
  /** The Armor layer's millimetre field above the bar; the number field commits on blur. */
  thickness: async (mm: number) => {
    const input = document.querySelector<HTMLInputElement>('.sb-cursor .sb-num input');
    if (!input) throw new Error('Armor thickness field unavailable');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(mm));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await controls.settled(() => true, `thickness ${mm}`);
  },
  /** The checks chip, its open rows and every native diagnostic; the list itself stays collapsed until W, so the messages come from the editor. */
  warnings: () =>
    [
      document.querySelector('.sb-warn')?.textContent ?? '',
      ...(window.constructionEditor?.result()?.diagnostics ?? []).map((item) => item.message),
    ].join(' · '),
  rowButton: (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.sb-warn .row button')].find((button) => button.textContent?.trim().startsWith(text)),
  menu: async (text: string) => {
    document.querySelector<HTMLButtonElement>('.sb-meta')!.click();
    await sleep(30);
    const item = [...document.querySelectorAll<HTMLButtonElement>('.sb-menu button')].find((button) => button.textContent?.trim() === text);
    if (!item || item.disabled) throw new Error(`Menu item unavailable: ${text}`);
    item.click();
    await sleep(30);
  },
  /** Synthetic pointers have no browser capture lifetime; the actual raycast against native faces still runs. */
  click: (x: number, y: number, options: PointerEventInit = {}) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.sb-canvas canvas')!;
    canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
    const point = { bubbles: true, pointerId: 41, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...options };
    canvas.dispatchEvent(new PointerEvent('pointermove', point));
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...point, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', point));
  },
  /** Screen position of a ship-space point through the live camera. */
  screen: async (point: Vec3): Promise<[number, number]> => {
    const THREE = await import('three');
    const viewport = window.shipbuilderViewport as unknown as { camera: InstanceType<typeof THREE.Camera> } | undefined;
    if (!viewport) throw new Error('The viewport dev hook is unavailable; run against the Vite dev server.');
    const projected = new THREE.Vector3(...point).project(viewport.camera);
    const bounds = document.querySelector('.sb-canvas canvas')!.getBoundingClientRect();
    return [bounds.x + ((projected.x + 1) * bounds.width) / 2, bounds.y + ((1 - projected.y) * bounds.height) / 2];
  },
};

/** The native solver adds missing internals; applying or undoing never changes the hull. */
export async function checkShipbuilderSuggestions() {
  const catalog = await loadConstructionCatalog(),
    template = createStarterSource(catalog);
  template.construction.equipment = [];
  window.shipbuilderReview?.close();
  await mountShipbuilderReview(template);
  const checks: string[] = [],
    wait = waiter(checks);
  await wait(() => source() && compiled(), 'hull-only source compiles and saves');
  const before = JSON.stringify(source()!.construction);
  await controls.tab('Internals');
  await controls.tool('Suggest');
  await wait(() => controls.rowButton('Apply'), 'native missing-internals proposal is available');
  if (JSON.stringify(source()!.construction) !== before) throw new Error('Proposal changed source before apply');
  checks.push('proposal keeps saved source unchanged until apply');
  const name = document.querySelector<HTMLInputElement>('.sb-name')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Changed while reviewing layout');
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => controls.rowButton('Apply')?.disabled, 'editing fences an obsolete proposal');
  await wait(() => compiled(), 'new source compilation leaves suggestions available');
  await controls.tool('Suggest');
  await wait(() => controls.rowButton('Apply') && !controls.rowButton('Apply')!.disabled, 'current revision receives a fresh proposal');
  controls.rowButton('Apply')!.click();
  await wait(() => source()!.construction.equipment.length === 1, 'one apply saves machinery without a separate magazine');
  controls.key('z', { ctrlKey: true });
  await wait(() => JSON.stringify(source()!.construction) === before, 'one undo restores exact hull and module references');
  await wait(() => compiled(), 'restored hull is compiled before another suggestion');
  await controls.tab('Armament');
  document.querySelector<HTMLButtonElement>('.sb-slot.more')!.click();
  await sleep(30);
  const oversized = catalog.equipment.find((part) => part.id === 'sk-c34-380-twin')!;
  const fitting = [...document.querySelectorAll<HTMLButtonElement>('.sb-drawer .sb-slot')].find(
    (button) => button.getAttribute('aria-label') === oversized.name,
  );
  if (!fitting) throw new Error('Drawer does not list the oversized fitting');
  fitting.click();
  await sleep(30);
  await controls.tool('Suggest');
  await wait(
    () => document.querySelector('.sb-warn .row .sb-dot.block') && controls.rowButton('Dismiss'),
    'oversized fitting produces a native placement explanation',
  );
  if (controls.rowButton('Apply') || JSON.stringify(source()!.construction) !== before) throw new Error('Failed layout modified source');
  checks.push('failed proposal preserves source and has no apply action');
  window.shipbuilderReview!.close();
  return { passed: checks.length, checks };
}

/** Armor is a bucket: typed thicknesses only load the card and Fill lays it; both painting paths preserve protection and openings. */
export async function checkShipbuilderArmor() {
  const catalog = await loadConstructionCatalog(),
    template = createStarterSource(catalog);
  template.construction.equipment = [];
  template.construction.boundaries = [];
  template.construction.surfaces = [];
  window.shipbuilderReview?.close();
  await mountShipbuilderReview(template);
  const checks: string[] = [],
    wait = waiter(checks);
  await wait(() => source() && compiled(), 'armor fixture compiles and saves');
  const top = await controls.screen([0, 2.5, 0]),
    side = await controls.screen([4, 0, 0]);
  await controls.tab('Armor');
  const original = JSON.stringify(source()!.construction);
  await controls.thickness(100);
  if (JSON.stringify(source()!.construction) !== original) throw new Error('Typing a thickness changed the ship');
  checks.push('a typed thickness only loads the Armor card');
  await controls.tool('Fill');
  controls.click(...top);
  if (document.querySelector('[data-tag="faces"]')) throw new Error('Armor Fill built a face selection');
  await wait(
    () =>
      source()!.construction.surfaces.some((surface) => surface.face === 'top') &&
      source()!
        .construction.surfaces.filter((surface) => surface.face === 'top')
        .every((surface) => surface.thicknessMm === 100 && surface.material === 'armor-steel'),
    'Fill lays exact millimeters and armor steel on every top face',
  );
  if (source()!.construction.surfaces.some((surface) => surface.face !== 'top')) throw new Error('Armor leaked onto unfilled faces');
  checks.push('unfilled faces keep their structural skin');
  await wait(() => compiled(), 'armor fill compiles');
  await controls.thickness(37);
  controls.click(...top);
  await wait(
    () =>
      source()!
        .construction.surfaces.filter((surface) => surface.face === 'top')
        .every((surface) => surface.thicknessMm === 37),
    'a second Fill replaces the first thickness',
  );
  if (!document.querySelector('.sb-hotbar .sb-slot')?.textContent?.includes('37 mm'))
    throw new Error('The Armor card does not show the typed thickness');
  checks.push('the Armor card carries the typed thickness');
  await wait(
    () => document.querySelector('.sb-armor-groups')?.textContent?.includes('37 mm · Armor steel'),
    'the ledger reports native thickness and coverage',
  );
  await controls.tab('Paint');
  await wait(() => compiled(), 'native faces are current before painting');
  await controls.tool('Area');
  controls.click(...top);
  await wait(() => document.querySelector('[data-tag="faces"]'), 'paint layer selects the same area');
  await controls.slot(5);
  await wait(
    () =>
      source()!
        .construction.surfaces.filter((surface) => surface.face === 'top')
        .every((surface) => surface.paint === 'sea-blue'),
    'a paint slot changes the selected paint',
  );
  if (
    !source()!
      .construction.surfaces.filter((surface) => surface.face === 'top')
      .every((surface) => surface.thicknessMm === 37 && surface.material === 'armor-steel')
  )
    throw new Error('Painting changed protection');
  checks.push('painting preserves thickness and material');
  await controls.tab('Armor');
  await wait(() => compiled(), 'native faces are current before opening');
  await controls.card('Opening');
  await controls.tool('Paint');
  controls.click(...top);
  await wait(
    () =>
      source()!
        .construction.surfaces.filter((surface) => surface.face === 'top')
        .every((surface) => surface.open),
    'the Opening card opens the clicked face and its mirror',
  );
  await wait(
    () => document.querySelector('.sb-armor-groups')?.textContent?.includes('Open to sea'),
    'the ledger distinguishes openings from protected skin',
  );
  await controls.tab('Paint');
  await controls.tool('Paint');
  await controls.slot(6);
  await wait(() => compiled(), 'native faces are current before a clicked-face paint');
  controls.click(...side);
  await wait(
    () => source()!.construction.surfaces.some((surface) => surface.paint === 'red-oxide'),
    'clicked-face painting reaches the native selected surface',
  );
  if (
    !source()!
      .construction.surfaces.filter((surface) => surface.face === 'top')
      .every((surface) => surface.thicknessMm === 37 && surface.material === 'armor-steel' && surface.open)
  )
    throw new Error('Clicked-face painting changed protection or closed an opening');
  checks.push('clicked-face painting preserves armor, material and openings');
  const beforeUndo = structuredClone(source()!.construction);
  controls.key('z', { ctrlKey: true });
  await wait(() => !source()!.construction.surfaces.some((surface) => surface.paint === 'red-oxide'), 'one undo restores the paint stroke');
  if (
    JSON.stringify(source()!.construction.surfaces.filter((surface) => surface.face === 'top')) !==
    JSON.stringify(beforeUndo.surfaces.filter((surface) => surface.face === 'top'))
  )
    throw new Error('Paint undo changed unrelated surface references');
  checks.push('paint undo retains exact protection and stable source face references');
  if (JSON.stringify(source()!.construction) === original) throw new Error('No edit reached the source');
  window.shipbuilderReview!.close();
  return { passed: checks.length, checks };
}

export async function checkShipbuilderEditing() {
  window.shipbuilderReview?.close();
  await mountShipbuilderReview();
  const checks: string[] = [],
    wait = waiter(checks, 20000);
  await wait(() => source(), 'initial source saved');
  const previousId = source()!.id;
  await controls.menu('New design');
  await wait(() => source()!.id !== previousId && source()!.construction.primitives.length === 1, 'new design starts with one hull block');
  await wait(compiled, 'starter block compiles');
  const center = await controls.screen([0, 0.5, 0]);
  const first = structuredClone(source()!.construction.primitives[0]);
  controls.click(...center, { button: 2 });
  await sleep(50);
  if (source()!.construction.primitives.length !== 1) throw new Error('Right-click deleted the last block');
  await controls.tool('Erase');
  controls.click(...center);
  await sleep(50);
  if (source()!.construction.primitives.length !== 1) throw new Error('Erase deleted the last block');
  controls.key('a', { ctrlKey: true });
  await sleep(30);
  controls.key('Delete');
  await sleep(50);
  if (JSON.stringify(source()!.construction.primitives) !== JSON.stringify([first])) throw new Error('Delete changed the last block');
  checks.push('right-click, Erase and Delete all protect the final hull block');
  controls.key('m');
  await controls.tool('Place');
  controls.click(...center);
  await wait(() => source()!.construction.primitives.length === 2, 'a click adds a block on the existing hull');
  const second = source()!.construction.primitives[1];
  const offsets = second.position.map((value, axis) => Math.abs(value - first.position[axis]));
  if (offsets.filter((value) => Math.abs(value - 1) < 1e-6).length !== 1 || offsets.filter((value) => value < 1e-6).length !== 2)
    throw new Error(`Block is not face to face with the starter: ${JSON.stringify([first.position, second.position])}`);
  checks.push('a new block aligns face to face with the centered starter');
  controls.key('z', { ctrlKey: true });
  await wait(() => source()!.construction.primitives.length === 1, 'undo returns to the starter block');
  controls.key('z', { ctrlKey: true, shiftKey: true });
  await wait(() => source()!.construction.primitives.length === 2, 'redo restores the placed block');
  controls.key('a', { ctrlKey: true });
  await sleep(20);
  controls.key('c', { ctrlKey: true });
  await wait(() => source()!.construction.primitives.length === 4, 'copy creates new stable IDs');
  const copiedIds = source()!.construction.primitives.map((part) => part.id);
  if (new Set(copiedIds).size !== 4) throw new Error('Copy reused a primitive ID');
  controls.key('z', { ctrlKey: true });
  await wait(() => source()!.construction.primitives.length === 2, 'undo restores source');
  controls.key('z', { ctrlKey: true, shiftKey: true });
  await wait(() => source()!.construction.primitives.length === 4, 'redo restores exact source references');
  if (
    source()!
      .construction.primitives.map((part) => part.id)
      .join() !== copiedIds.join()
  )
    throw new Error('Redo changed stable IDs');
  await wait(() => compiled() && document.querySelector('[data-tag="group"]'), 'the selection tag follows the copied group');
  await controls.tab('Armor');
  await wait(() => compiled(), 'native compiled faces become selectable');
  await controls.slot(1);
  await controls.tool('Fill');
  controls.click(...center);
  await wait(
    () => source()!.construction.surfaces.some((surface) => surface.thicknessMm === 10),
    'the Armor card fills its current millimeters through the actual controls',
  );
  await wait(() => compiled(), 'armor assignment compiles');
  await controls.card('Opening');
  await controls.tool('Paint');
  controls.click(...center);
  await wait(() => source()!.construction.surfaces.some((surface) => surface.open), 'explicit openings remain distinct from armor');
  controls.key('z', { ctrlKey: true });
  await wait(() => source()!.construction.surfaces.every((surface) => !surface.open), 'undo restores closed skin and armor together');
  await controls.tab('Internals');
  await wait(() => compiled(), 'internals layer has a compiled hull');
  await controls.tool('Bulkhead');
  controls.click(...center);
  await wait(() => source()!.construction.boundaries.length === 1, 'internal boundary source survives autosave');
  await controls.tab('Armament');
  await wait(() => compiled(), 'fittings layer has a compiled hull');
  await controls.slot(1);
  controls.click(...center);
  await wait(() => source()!.construction.equipment.length >= 1, 'fixed equipment placement remains saved even with a fit error');
  const saved = structuredClone(source()!);
  const { openConstructionStore } = await import('../../src/ships/constructionStore');
  const store = await openConstructionStore();
  try {
    const latest = await store.load(saved.id);
    if (JSON.stringify(JSON.parse(latest.revision.sourceJson)) !== JSON.stringify(saved)) throw new Error('Reopened source changed');
    checks.push('reopened IndexedDB source matches visible edited design');
  } finally {
    store.close();
  }
  window.shipbuilderReview!.close();
  await wait(() => !document.querySelector('canvas'), 'closing disposes the editor canvas');
  return { passed: checks.length, checks, sourceId: saved.id };
}
