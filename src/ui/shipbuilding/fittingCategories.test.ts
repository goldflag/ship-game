import { expect, test } from 'bun:test';
import catalogJson from '../../../public/models/components/catalog.json';
import retainedCatalogJson from '../../../public/models/components/catalogs/f8d5f622818e0ef20c6c3918ac36dc29d1904e18b13a83aa923e1e93d05ff697/catalog.json';
import type { ConstructionCatalog } from '../../ships/blueprint';
import { effectiveConstructionCatalog } from '../../ships/constructionCustomFittings';
import { isRetiredDeckFitting } from '../../ships/constructionEquipment';
import { paletteFor } from './builderLayers';
import { FITTING_CATEGORIES, FITTING_GROUPS, fittingCategory, fittingNation } from './fittingCategories';

const catalog = catalogJson as ConstructionCatalog;
const part = (id: string) => catalog.equipment.find(entry => entry.id === id)!;
const shelf = (category: Parameters<typeof paletteFor>[3] & {}) => paletteFor('fittings', catalog, [], category).drawer.map(item => item.id);

test('every fitting sits on exactly one shelf and every shelf holds something', () => {
  const all = paletteFor('fittings', catalog).drawer;
  const shelved = FITTING_CATEGORIES.flatMap(entry => shelf({ category: entry.id, nation: 'all' }));
  expect(shelved.slice().sort()).toEqual(all.map(item => item.id).sort());
  // Custom holds the open design's own fittings, so the published catalog leaves it empty.
  for (const entry of FITTING_CATEGORIES) expect(shelf({ category: entry.id, nation: 'all' }).length > 0).toBe(entry.id !== 'custom');
});

test('a design’s own fittings sit on the Custom shelf of the Outfit tab', () => {
  const definition = { id: 'fit-locker', name: 'Deck locker', version: 1 as const, attach: 'deck' as const, tubes: [],
    solids: [{ id: 'body', kind: 'box' as const, size: [1, 0.8, 0.5] as [number, number, number], position: [0, 0.4, 0] as [number, number, number], rotationDeg: 0 }] };
  const own = effectiveConstructionCatalog({ fittings: [definition] }, catalog);
  expect(paletteFor('fittings', own, [], { category: 'custom', nation: 'all' }).drawer.map(item => [item.id, item.note])).toEqual([['design:fit-locker', 'custom fitting · 3.1 t']]);
  expect(FITTING_CATEGORIES.find(entry => entry.id === 'custom')!.group).toBe('outfit');
  expect(fittingNation(own.equipment.at(-1)!)).toBeUndefined();
});

test('every tab has shelves, in tab order', () => {
  expect(FITTING_GROUPS.map(group => group.id)).toEqual(['machinery', 'armament', 'outfit']);
  const order = FITTING_CATEGORIES.map(entry => FITTING_GROUPS.findIndex(group => group.id === entry.group));
  expect(order).toEqual(order.slice().sort());
  expect(new Set(order).size).toBe(FITTING_GROUPS.length);
});

test('guns split at 100 mm; deck fittings are shelved by what they are', () => {
  expect(fittingCategory(part('skc33-105-c31-twin'), catalog)).toBe('main-battery');
  expect(fittingCategory(part('us-5in38-mk30-mod0-single'), catalog)).toBe('main-battery');
  expect(fittingCategory(part('flak28-40-single'), catalog)).toBe('light-aa');
  expect(fittingCategory(part('german-sl8-director'), catalog)).toBe('fire-control');
  expect(fittingCategory(part('generic-static-searchlight'), catalog)).toBe('fire-control');
  expect(fittingCategory(part('generic-lifeboat-davits'), catalog)).toBe('boats-aviation');
  expect(fittingCategory(part('german-cruiser-catapult'), catalog)).toBe('boats-aviation');
  expect(fittingCategory(part('generic-anchor-windlass'), catalog)).toBe('mooring');
  for (const id of ['generic-carley-float', 'rn-motor-pinnace', 'us-aircraft-crane', 'ijn-aircraft-catapult']) expect(fittingCategory(part(id), catalog)).toBe('boats-aviation');
  for (const id of ['generic-capstan', 'generic-twin-bitts', 'generic-rope', 'generic-chain', 'generic-hawse-pipe']) expect(fittingCategory(part(id), catalog)).toBe('mooring');
  for (const id of ['generic-railing', 'generic-surface-ladder', 'generic-inclined-stairs', 'generic-deck-hatch', 'generic-accommodation-ladder']) expect(fittingCategory(part(id), catalog)).toBe('access');
  for (const id of ['generic-cowl-vent', 'generic-round-wall-vent', 'generic-deck-storage-box', 'generic-wall-cabinet', 'generic-life-ring', 'generic-life-raft-oval', 'generic-ensign-staff']) expect(fittingCategory(part(id), catalog)).toBe('fixtures');
  expect(fittingCategory(part('clemson-forward-funnel'), catalog)).toBe('funnels');
  expect(fittingCategory(part('rn-tripod-foremast'), catalog)).toBe('masts');
});

test('a nation keeps its own parts and the generic ones; a nation absent from the shelf filters nothing', () => {
  // Every authored id names its navy or says generic, so a new part cannot silently fall out of the filter.
  for (const entry of catalog.equipment.filter(entry => entry.placement !== 'internal')) expect(!!fittingNation(entry) || entry.id.startsWith('generic-')).toBe(true);
  const german = shelf({ category: 'funnels', nation: 'Germany' });
  expect(german).toContain('scharnhorst-funnel'); expect(german).toContain('emden-aft-funnel'); expect(german).not.toContain('clemson-forward-funnel');
  const american = shelf({ category: 'light-aa', nation: 'United States' });
  expect(american).toContain('us-20mm-oerlikon-mk4-hsienyang'); expect(american.every(id => fittingNation(part(id)) === 'United States')).toBe(true);
  expect(shelf({ category: 'mooring', nation: 'Japan' })).toEqual(shelf({ category: 'mooring', nation: 'all' }));
});

test('gun shelves list the heaviest calibre first', () => {
  const calibers = shelf({ category: 'main-battery', nation: 'all' }).map(id => catalog.weapons.parts.find(gun => gun.id === part(id).gunPartId)!.caliberM);
  expect(calibers).toEqual(calibers.slice().sort((a, b) => b - a));
  expect(calibers[0]).toBeGreaterThan(.4);
});

test('mooring and access put every drawable path ahead of fixed hardware', () => {
  const mooring = shelf({ category: 'mooring', nation: 'all' }), access = shelf({ category: 'access', nation: 'all' });
  for (const [deck, expected] of [[mooring, ['generic-rope', 'generic-chain']], [access, ['generic-surface-ladder', 'generic-railing', 'generic-railing-two-rail']]] as const) {
    const paths = deck.filter(id => part(id).path);
    for (const id of expected) expect(paths).toContain(id);
    expect(deck.slice(0, paths.length)).toEqual(paths);
  }
});

test('current mooring, access and fixtures contain only general ship hardware', () => {
  const deck = (['mooring', 'access', 'fixtures'] as const).flatMap(category => shelf({ category, nation: 'all' }));
  expect(deck.every(id => fittingNation(part(id)) === undefined)).toBe(true);
  for (const id of ['generic-paravane', 'generic-signal-lamp', 'generic-gun-tub', 'generic-gun-tub-large',
    'generic-ready-ammo-locker', 'generic-splinter-shield', 'generic-breakwater',
    'german-cruiser-capstan', 'german-cruiser-deck-hatch']) {
    expect(catalog.equipment.some(entry => entry.id === id)).toBe(false);
  }
});

test('the current catalog publishes no retired part', () => {
  expect(catalog.equipment.filter(entry => isRetiredDeckFitting(entry.id)).map(entry => entry.id)).toEqual([]);
});

test('older designs cannot offer retired deck fittings in their shelf, hotbar or search', () => {
  const retained = retainedCatalogJson as ConstructionCatalog;
  const retired = ['generic-paravane', 'generic-signal-lamp', 'generic-gun-tub', 'generic-gun-tub-large',
    'generic-ready-ammo-locker', 'generic-splinter-shield', 'generic-breakwater',
    'german-cruiser-capstan', 'german-cruiser-deck-hatch',
    'fletcher-funnel', 'german-cruiser-funnel-cap', 'generic-capital-funnel', 'us-battleship-funnel', 'us-cruiser-funnel',
    'german-battleship-funnel', 'ijn-battleship-funnel', 'ijn-cruiser-trunked-funnel', 'ijn-destroyer-funnel', 'rn-battleship-funnel', 'rn-corvette-funnel'];
  const original = structuredClone(retained);
  // Use the real immutable publication an old design requests, not the already-curated current one.
  for (const id of retired) expect(retained.equipment.some(entry => entry.id === id)).toBe(true);
  for (const filter of [undefined, { category: 'mooring', nation: 'all' }, { category: 'mooring', nation: 'Germany' }] as const) {
    const palette = paletteFor('fittings', retained, [], filter);
    for (const items of [palette.bar, palette.drawer, palette.all!]) {
      for (const id of retired) expect(items.map(item => item.id)).not.toContain(id);
    }
    expect(palette.drawer.map(item => item.id)).toContain('generic-capstan');
  }
  expect(retained).toEqual(original);
});
