import { expect, test } from 'bun:test';
import catalogJson from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog } from '../../ships/blueprint';
import { paletteFor } from './builderLayers';
import { FITTING_CATEGORIES, fittingCategory, fittingNation } from './fittingCategories';

const catalog = catalogJson as ConstructionCatalog;
const part = (id: string) => catalog.equipment.find(entry => entry.id === id)!;
const shelf = (category: Parameters<typeof paletteFor>[3] & {}) => paletteFor('fittings', catalog, [], category).drawer.map(item => item.id);

test('every fitting sits on exactly one shelf and every shelf holds something', () => {
  const all = paletteFor('fittings', catalog).drawer;
  const shelved = FITTING_CATEGORIES.flatMap(entry => shelf({ category: entry.id, nation: 'all' }));
  expect(shelved.slice().sort()).toEqual(all.map(item => item.id).sort());
  for (const entry of FITTING_CATEGORIES) expect(shelf({ category: entry.id, nation: 'all' }).length).toBeGreaterThan(0);
});

test('guns split at 100 mm; deck fittings that aim or float leave the deck-gear shelf', () => {
  expect(fittingCategory(part('skc33-105-c31-twin'), catalog)).toBe('main-battery');
  expect(fittingCategory(part('us-5in38-mk30-mod0-single'), catalog)).toBe('main-battery');
  expect(fittingCategory(part('flak28-40-single'), catalog)).toBe('light-aa');
  expect(fittingCategory(part('german-sl8-director'), catalog)).toBe('fire-control');
  expect(fittingCategory(part('generic-static-searchlight'), catalog)).toBe('fire-control');
  expect(fittingCategory(part('generic-lifeboat-davits'), catalog)).toBe('boats-aviation');
  expect(fittingCategory(part('german-cruiser-catapult'), catalog)).toBe('boats-aviation');
  expect(fittingCategory(part('generic-anchor-windlass'), catalog)).toBe('deck-gear');
  for (const id of ['generic-carley-float', 'rn-motor-pinnace', 'us-aircraft-crane', 'ijn-aircraft-catapult']) expect(fittingCategory(part(id), catalog)).toBe('boats-aviation');
  for (const id of ['generic-capstan', 'generic-cowl-vent', 'generic-deck-storage-box']) expect(fittingCategory(part(id), catalog)).toBe('deck-gear');
});

test('a nation keeps its own parts and the generic ones; a nation absent from the shelf filters nothing', () => {
  // Every authored id names its navy or says generic, so a new part cannot silently fall out of the filter.
  for (const entry of catalog.equipment.filter(entry => entry.placement !== 'internal')) expect(!!fittingNation(entry) || entry.id.startsWith('generic-')).toBe(true);
  const german = shelf({ category: 'superstructure', nation: 'Germany' });
  expect(german).toContain('german-cruiser-funnel-cap'); expect(german).toContain('generic-capital-funnel'); expect(german).not.toContain('fletcher-funnel');
  const american = shelf({ category: 'light-aa', nation: 'United States' });
  expect(american).toContain('us-20mm-oerlikon-mk4-hsienyang'); expect(american.every(id => fittingNation(part(id)) === 'United States')).toBe(true);
  expect(shelf({ category: 'deck-gear', nation: 'Japan' })).toEqual(shelf({ category: 'deck-gear', nation: 'all' }));
});

test('gun shelves list the heaviest calibre first', () => {
  const calibers = shelf({ category: 'main-battery', nation: 'all' }).map(id => catalog.weapons.parts.find(gun => gun.id === part(id).gunPartId)!.caliberM);
  expect(calibers).toEqual(calibers.slice().sort((a, b) => b - a));
  expect(calibers[0]).toBeGreaterThan(.4);
});

test('deck gear puts every drawable path ahead of fixed hardware', () => {
  const deck = shelf({ category: 'deck-gear', nation: 'all' });
  const paths = deck.filter(id => part(id).path);
  expect(paths).toContain('generic-rope');
  expect(paths).toContain('generic-chain');
  expect(paths).toContain('generic-surface-ladder');
  expect(paths).toContain('generic-railing');
  expect(paths).toContain('generic-railing-two-rail');
  expect(deck.slice(0, paths.length)).toEqual(paths);
});

test('current deck gear contains only general ship hardware', () => {
  const deck = shelf({ category: 'deck-gear', nation: 'all' });
  expect(deck.every(id => fittingNation(part(id)) === undefined)).toBe(true);
  for (const id of ['generic-paravane', 'generic-signal-lamp', 'generic-gun-tub', 'generic-gun-tub-large',
    'generic-ready-ammo-locker', 'generic-splinter-shield', 'generic-breakwater',
    'german-cruiser-capstan', 'german-cruiser-deck-hatch']) {
    expect(catalog.equipment.some(entry => entry.id === id)).toBe(false);
  }
});
