import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from './blueprint';
import { createStarterSource } from './constructionStarter';
const catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
const compile = (source: ConstructionSource): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));

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

const bareDeck = () => {
  const source = createStarterSource(catalog, 'patrol'), hull = source.construction.primitives.find(piece => piece.id === 'hull')!; hull.size = [24, 16, 60];
  source.construction.primitives = [hull]; source.construction.surfaces = source.construction.surfaces.filter(surface => surface.primitiveId === hull.id);
  source.construction.boundaries = []; source.construction.equipment = [];
  return { source, deck: hull.size[1] / 2 };
};
const standing = (partId: string, id: string, deck: number, at: [number, number] = [0, 0]) => {
  const part = catalog.equipment.find(entry => entry.id === partId)!, datum = part.sockets!.find(entry => entry.id === 'attachment')!.position;
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

test('a gun tub collides by its wall and stands on its wall foot, so a light gun fits inside it and small gear fits under a crane jib', () => {
  for (const [tub, gun] of [['generic-gun-tub-large', 'type96-25-triple'], ['generic-gun-tub', 'type93-13-twin']] as const) {
    const { source, deck } = bareDeck(), wall = catalog.equipment.find(entry => entry.id === tub)!.sockets!.find(s => s.id === 'attachment')!.position[2];
    // The tub attaches at its forward wall foot; light guns keep the deck beneath the tub intact.
    source.construction.equipment = [standing(tub, 'tub', deck, [0, -10 + wall]), standing(gun, 'gun', deck, [0, -10]),
      standing('generic-boat-crane', 'crane', deck, [0, 20]), standing('generic-ready-ammo-locker', 'locker', deck, [0, 11.5])];
    const result = compile(source);
    expect(result.diagnostics.filter(entry => entry.severity === 'error'), `${tub}: ${JSON.stringify(result.diagnostics)}`).toEqual([]);
    expect(result.definition!.mounts.map(mount => mount.weapon.id)).toEqual([gun]);
    // As a solid bounding box the same tub would reject the gun: the wall boxes are what leave its middle free.
    const solidCatalog = structuredClone(catalog); delete solidCatalog.equipment.find(entry => entry.id === tub)!.fitting;
    const solid = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(solidCatalog))) as ConstructionResult;
    expect(solid.diagnostics.some(entry => entry.severity === 'error' && (entry.sourceId === 'tub' || entry.sourceId === 'gun')), tub).toBe(true);
  }
});
