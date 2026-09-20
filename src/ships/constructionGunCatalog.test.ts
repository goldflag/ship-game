import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import retainedCatalogJson from '../../public/models/components/catalogs/f8d5f622818e0ef20c6c3918ac36dc29d1904e18b13a83aa923e1e93d05ff697/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from './blueprint';
import { createStarterSource } from './constructionStarter';
const catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
const compile = (source: ConstructionSource, partsCatalog = catalog): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(partsCatalog)));

test('every catalog gun fits on a deck by its attachment socket and compiles into a mount of its own weapon', () => {
  for (const part of catalog.equipment.filter(entry => entry.kind === 'gun')) {
    const source = createStarterSource(catalog, 'patrol'), gun = source.construction.equipment.find(entry => entry.id === 'gun-forward')!;
    // One block broad and deep enough for the largest turret's barbette and integral magazine; the gun stands alone on it.
    const hull = source.construction.primitives.find(piece => piece.id === 'hull')!; hull.size = [24, 16, 60];
    source.construction.primitives = [hull]; source.construction.surfaces = source.construction.surfaces.filter(surface => surface.primitiveId === hull.id);
    // No bulkheads either: a battleship barbette is wider than the starter's compartments.
    source.construction.equipment = [gun]; source.construction.boundaries = [];
    const socket = part.sockets!.find(entry => entry.id === 'attachment')!;
    gun.partId = part.id; gun.position = [0, hull.size[1] / 2 - socket.position[1], 0];
    const result = compile(source);
    expect(result.definition, `${part.id}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
    expect(result.definition!.mounts.map(mount => mount.weapon.id), part.id).toEqual([part.gunPartId!]);
    expect(result.diagnostics.filter(entry => entry.sourceId === gun.id && entry.severity === 'error'), part.id).toEqual([]);
  }
});

test('every catalog torpedo launcher compiles into a launcher with one tube per authored offset', () => {
  for (const part of catalog.equipment.filter(entry => entry.kind === 'torpedo-launcher')) {
    const source = createStarterSource(catalog, 'patrol'), bank = source.construction.equipment.find(entry => entry.id === 'gun-forward')!;
    const hull = source.construction.primitives.find(piece => piece.id === 'hull')!; hull.size = [24, 16, 60];
    source.construction.primitives = [hull]; source.construction.surfaces = source.construction.surfaces.filter(surface => surface.primitiveId === hull.id);
    source.construction.equipment = [bank];
    bank.partId = part.id; bank.position = [0, hull.size[1] / 2 - part.sockets!.find(entry => entry.id === 'attachment')!.position[1], 0];
    const result = compile(source);
    expect(result.definition, `${part.id}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
    expect(result.definition!.torpedoTubes!.map(tube => tube.partId), part.id).toEqual(part.tubeOffsets!.map(() => part.torpedoPartId!));
    expect(result.diagnostics.filter(entry => entry.sourceId === bank.id && entry.severity === 'error'), part.id).toEqual([]);
  }
});

test('every catalog funnel, mast and director stands on a deck without an error of its own', () => {
  for (const part of catalog.equipment.filter(entry => ['funnel', 'mast', 'director'].includes(entry.kind))) {
    const source = createStarterSource(catalog, 'patrol'), fitting = source.construction.equipment.find(entry => entry.id === 'mast')!;
    const hull = source.construction.primitives.find(piece => piece.id === 'hull')!; hull.size = [24, 16, 60];
    source.construction.primitives = [hull]; source.construction.surfaces = source.construction.surfaces.filter(surface => surface.primitiveId === hull.id);
    // The starter's bulkheads go too: where a long uptake meets a wall is the design's business, not the part's.
    source.construction.equipment = [fitting]; source.construction.boundaries = [];
    fitting.partId = part.id; fitting.position = [0, hull.size[1] / 2 - part.sockets!.find(entry => entry.id === 'attachment')!.position[1], 0];
    const result = compile(source);
    expect(result.definition, `${part.id}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
    expect(result.diagnostics.filter(entry => entry.sourceId === fitting.id && entry.severity === 'error'), part.id).toEqual([]);
  }
});

const bareDeck = (partsCatalog = catalog) => {
  const source = createStarterSource(partsCatalog, 'patrol'), hull = source.construction.primitives.find(piece => piece.id === 'hull')!; hull.size = [24, 16, 60];
  source.construction.primitives = [hull]; source.construction.surfaces = source.construction.surfaces.filter(surface => surface.primitiveId === hull.id);
  source.construction.boundaries = []; source.construction.equipment = [];
  return { source, deck: hull.size[1] / 2 };
};
const standing = (partId: string, id: string, deck: number, at: [number, number] = [0, 0], partsCatalog = catalog) => {
  const part = partsCatalog.equipment.find(entry => entry.id === partId)!, datum = part.sockets!.find(entry => entry.id === 'attachment')!.position;
  return { id, partId, position: [at[0] - datum[0], deck - datum[1], at[1] - datum[2]] as [number, number, number], bearingDeg: 0 };
};

test('every fixed deck fitting stands on a deck without an error of its own', () => {
  for (const part of catalog.equipment.filter(entry => entry.kind === 'deck-fitting' && !entry.path && entry.sockets!.find(s => s.id === 'attachment')!.direction[1] === -1)) {
    const { source, deck } = bareDeck();
    source.construction.equipment = [standing(part.id, 'fitting', deck)];
    const result = compile(source);
    expect(result.definition, `${part.id}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
    expect(result.diagnostics.filter(entry => entry.sourceId === 'fitting' && entry.severity === 'error'), part.id).toEqual([]);
  }
});

test('retained catalogs still compile removed gun tubs and lockers with decorative overlap allowed', () => {
  const catalog = retainedCatalogJson as ConstructionCatalog;
  for (const [tub, gun] of [['generic-gun-tub-large', 'type96-25-triple'], ['generic-gun-tub', 'type93-13-twin']] as const) {
    const { source, deck } = bareDeck(catalog), wall = catalog.equipment.find(entry => entry.id === tub)!.sockets!.find(s => s.id === 'attachment')!.position[2];
    // The tub attaches at its forward wall foot; light guns keep the deck beneath the tub intact.
    source.construction.equipment = [standing(tub, 'tub', deck, [0, -10 + wall], catalog), standing(gun, 'gun', deck, [0, -10], catalog),
      standing('generic-boat-crane', 'crane', deck, [0, 20], catalog), standing('generic-ready-ammo-locker', 'locker', deck, [0, 11.5], catalog)];
    const result = compile(source, catalog);
    expect(result.diagnostics.filter(entry => entry.severity === 'error'), `${tub}: ${JSON.stringify(result.diagnostics)}`).toEqual([]);
    expect(result.definition!.mounts.map(mount => mount.weapon.id)).toEqual([gun]);
    // Deck fittings remain decorative even in retained catalogs without sparse wall boxes.
    const solidCatalog = structuredClone(catalog); delete solidCatalog.equipment.find(entry => entry.id === tub)!.fitting;
    const solid = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(solidCatalog))) as ConstructionResult;
    expect(solid.diagnostics.filter(entry => entry.severity === 'error'), tub).toEqual([]);
    expect(solid.definition!.mounts.map(mount => mount.weapon.id)).toEqual([gun]);
  }
});
