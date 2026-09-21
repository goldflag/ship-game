import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction, construction_custom_fitting_parts } from '../generated/naval-wasm/naval_wasm';
import published from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionFittingDefinition, ConstructionResult, ConstructionSource } from './blueprint';
import { applyConstructionBatch, constructionDiffCommands, type ConstructionCommand } from './constructionCommands';
import {
  CUSTOM_FITTING_LIMITS,
  customFittingDefinitionOfPart,
  customFittingFault,
  effectiveConstructionCatalog,
  equipmentCounts,
  equipmentOverLimit,
  publishedConstructionCatalog,
  resolveCustomFitting,
} from './constructionCustomFittings';
import { CONSTRUCTION_LIMITS, decodeConstructionSource, decodeSavedConstruction } from './constructionEditor';
import { missingConstructionCatalogParts } from './constructionEquipment';
import { placementItems } from './constructionPlacement';
import { constructionBounds, constructionGet, constructionSummary } from './constructionQuery';
import { createStarterSource } from './constructionStarter';
import { cloneConstructionDesign, encodeConstructionSource, type ConstructionRevision, type ConstructionStore } from './constructionStore';
import { editableMesh } from './constructionMesh';

const catalog = published as unknown as ConstructionCatalog;
beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
});

const bollard: ConstructionFittingDefinition = {
  id: 'fit-bollard', name: 'Twin bollard', version: 1, attach: 'deck', fill: 0.35,
  solids: [
    { id: 'base', kind: 'vertex', size: [1.3, 0.12, 0.5], position: [0, 0.06, 0], rotationDeg: 0, shaping: { version: 1, edges: [2, 6, 10, 11], radius: 0.05, style: 'chamfer' } },
    { id: 'post-a', kind: 'cylinder', size: [0.32, 0.62, 0.32], position: [-0.38, 0.43, 0], rotationDeg: 0 },
    { id: 'post-b', kind: 'cylinder', size: [0.32, 0.62, 0.32], position: [0.38, 0.43, 0], rotationDeg: 30, paint: 'boot-top-black' },
  ],
  tubes: [{ id: 'bar', points: [[-0.38, 0.55, 0], [0.38, 0.55, 0]], diameterM: 0.07 }],
};
/** Tilted, warped and curved solids plus a bent tube: everything the two resolvers must agree on. */
const davit: ConstructionFittingDefinition = {
  id: 'fit-davit', name: 'Davit', version: 1, attach: 'deck', material: 'aluminium',
  solids: [
    { id: 'socket', kind: 'cone', size: [0.5, 0.4, 0.5], position: [0, 0.2, 0], rotationDeg: 0 },
    { id: 'knee', kind: 'wedge', size: [0.2, 0.6, 0.4], position: [0.1, 0.5, 0.3], rotationDeg: 40, tilt: { version: 1, pitchDeg: 20, rollDeg: -35 } },
    { id: 'lamp', kind: 'sphere', size: [0.3, 0.3, 0.3], position: [0, 3.2, -0.9], rotationDeg: 0 },
    {
      id: 'warped', kind: 'vertex', size: [0.4, 0.3, 0.4], position: [0.5, 0.15, 0], rotationDeg: 15,
      vertices: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.3, 0.5, -0.4], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.4, 0.4, 0.5]],
    },
    // An editable freeform cylinder, as the editor's D mode stores it.
    editableMesh({ id: 'drum', kind: 'cylinder', size: [0.4, 0.5, 0.4], position: [-0.6, 0.25, 0], rotationDeg: 0 }) as ConstructionFittingDefinition['solids'][number],
  ],
  tubes: [{ id: 'arm', points: [[0, 0, 0], [0, 2.2, 0], [0, 2.9, -0.3], [0, 3.1, -0.9]], diameterM: 0.16 }],
};
function source(definitions: ConstructionFittingDefinition[] = [bollard, davit]): ConstructionSource {
  const s = createStarterSource(catalog, 'fletcher-hull');
  s.construction.fittings = structuredClone(definitions);
  return s;
}
const batch = (s: ConstructionSource, ...commands: unknown[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Test', commands: commands as ConstructionCommand[] });

test('the TypeScript resolver matches the parts the native compiler synthesizes', () => {
  const native = JSON.parse(construction_custom_fitting_parts(JSON.stringify(source()))) as { parts: ConstructionEquipmentPart[] };
  expect(native.parts.map((part) => part.id)).toEqual(['design:fit-bollard', 'design:fit-davit']);
  for (const [i, def] of [bollard, davit].entries()) {
    const mine = resolveCustomFitting(def), theirs = native.parts[i];
    expect({ ...mine, size: 0, boundsCenter: 0, centerOfGravity: 0, massKg: 0, fitting: 0, contentHash: 0 }).toEqual({ ...theirs, size: 0, boundsCenter: 0, centerOfGravity: 0, massKg: 0, fitting: 0, contentHash: 0 } as never);
    for (const key of ['size', 'boundsCenter', 'centerOfGravity'] as const) for (let k = 0; k < 3; k++) expect(mine[key][k]).toBeCloseTo(theirs[key][k], 6);
    expect(mine.massKg! / theirs.massKg!).toBeCloseTo(1, 6);
    expect(mine.fitting!.length).toBe(theirs.fitting!.length);
    mine.fitting!.forEach((box, n) => { for (let k = 0; k < 3; k++) { expect(box.center[k]).toBeCloseTo(theirs.fitting![n].center[k], 6); expect(box.size[k]).toBeCloseTo(theirs.fitting![n].size[k], 6); } });
  }
  expect(resolveCustomFitting({ ...bollard, massKg: 250 }).massKg).toBe(250);
});

test('both resolvers refuse the same definitions and name the solid or tube', () => {
  const faults: [string, ConstructionFittingDefinition][] = [
    ['solid base is a ballast', { ...bollard, solids: [{ ...bollard.solids[1], id: 'base', kind: 'ballast' as never }] }],
    ['tube bar needs', { ...bollard, tubes: [{ ...bollard.tubes[0], diameterM: 3 }] }],
    ['above its datum', { ...bollard, tubes: [], solids: bollard.solids.map((solid) => ({ ...solid, position: [solid.position[0], solid.position[1] + 1, solid.position[2]] as [number, number, number] })) }],
    ['"deck" only', { ...bollard, attach: 'wall' as never }],
    ['at least one solid or tube', { ...bollard, solids: [], tubes: [] }],
    ['repeats the solid or tube ID bar', { ...bollard, tubes: [bollard.tubes[0], bollard.tubes[0]] }],
  ];
  for (const [text, def] of faults) {
    expect(customFittingFault(def)).toContain(text);
    const s = source([def]);
    // The syntax decoder stays lenient about ranges; the compiler names the fault.
    const native = JSON.parse(construction_custom_fitting_parts(JSON.stringify(s))) as { diagnostics: { code: string; message: string; sourceId: string }[] };
    expect(native.diagnostics[0]).toMatchObject({ code: 'custom-fitting', sourceId: 'fit-bollard' });
    expect(native.diagnostics[0].message).toContain(text);
  }
});

test('the effective catalog adds design parts, keeps its identity and never reaches the compiler', () => {
  const s = source(), effective = effectiveConstructionCatalog(s.construction, catalog);
  expect(effective.equipment.length).toBe(catalog.equipment.length + 2);
  expect(effectiveConstructionCatalog(structuredClone(s).construction, catalog)).toBe(effective);
  // Resolving again from an effective catalog never stacks or trusts its design parts.
  expect(effectiveConstructionCatalog(s.construction, effective)).toBe(effective);
  expect(publishedConstructionCatalog(effective)).toBe(catalog);
  expect(effectiveConstructionCatalog(createStarterSource(catalog, 'fletcher-hull').construction, catalog)).toBe(catalog);
  const part = effective.equipment.at(-1)!;
  expect(customFittingDefinitionOfPart(part)?.id).toBe('fit-davit');
  expect(part).toMatchObject({ kind: 'deck-fitting', placement: 'deck' });
  // A broken definition is left out; its instances read as missing until the compiler names the fault.
  expect(effectiveConstructionCatalog(source([{ ...bollard, fill: 7 }]).construction, catalog).equipment.length).toBe(catalog.equipment.length);
  // Design parts never hold a design on an old parts library.
  const fitted = batch(s, { op: 'equipment', value: { id: 'b1', partId: 'design:fit-bollard', position: [0, 5, 0], bearingDeg: 0 } });
  expect(missingConstructionCatalogParts(fitted, { ...catalog, revision: 'next' }, catalog)).toEqual([]);
});

test('fitting, fitting-patch, remove and diff commands edit the definitions table', () => {
  const empty = createStarterSource(catalog, 'fletcher-hull');
  let s = batch(empty, { op: 'fitting', value: bollard }, { op: 'equipment', value: { id: 'b1', partId: 'design:fit-bollard', position: [3, 4.47, -30], bearingDeg: 0 } });
  expect(s.construction.fittings).toEqual([bollard]);
  s = batch(s, { op: 'fitting-patch', id: 'fit-bollard', changes: { name: 'Bitts', fill: null, massKg: 300 } });
  expect(s.construction.fittings![0]).toMatchObject({ name: 'Bitts', massKg: 300 });
  expect(s.construction.fittings![0]).not.toHaveProperty('fill');
  expect(() => batch(s, { op: 'fitting-patch', id: 'fit-bolard', changes: { name: 'x' } })).toThrow('closest: "fit-bollard"');
  expect(() => batch(s, { op: 'fitting-patch', id: 'fit-bollard', changes: { id: 'other' } })).toThrow('unknown field changes.id');
  expect(() => batch(s, { op: 'fitting', value: { ...bollard, solids: [{ ...bollard.solids[0], kind: 'custom-hull' }] } })).toThrow('value.solids[0].kind');
  expect(() => batch(s, { op: 'fitting', value: { ...bollard, attach: 'wall' } })).toThrow('value.attach');
  expect(() => batch(s, { op: 'fitting', value: { ...bollard, id: 'b1' } })).toThrow('"b1" repeats');
  expect(() => batch(s, { op: 'remove', ids: ['fit-bollard'] })).toThrow('still fitted by b1');
  expect(() => batch(s, { op: 'copy', copies: [{ from: 'fit-bollard', to: 'fit-2' }] })).toThrow('custom fitting definition');
  const cleared = batch(s, { op: 'remove', ids: ['b1', 'fit-bollard'] });
  expect(cleared.construction).not.toHaveProperty('fittings');
  expect(cleared.construction.equipment).toEqual([]);
  // The diff reproduces every table change through the one edit door, in an order that applies.
  for (const [before, after] of [[empty, s], [s, cleared], [s, batch(s, { op: 'fitting', value: davit })]] as const) {
    const replayed = batch(before, ...constructionDiffCommands(before, after));
    expect(replayed.construction).toEqual(after.construction);
  }
  // Copies and mirrors of instances keep referencing the shared definition.
  const mirrored = batch(s, { op: 'copy', copies: [{ from: 'b1', to: 'b2' }], mirror: true });
  expect(mirrored.construction.equipment[1]).toMatchObject({ id: 'b2', partId: 'design:fit-bollard', position: [-3, 4.47, -30] });
  expect(mirrored.construction.fittings).toHaveLength(1);
});

test('custom instances have their own budget; decode checks the table', () => {
  const s = source();
  s.construction.equipment = Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, partId: 'design:fit-bollard', position: [0, 5, i] as [number, number, number], bearingDeg: 0 }));
  expect(equipmentCounts(s.construction)).toEqual({ catalog: 0, custom: 200 });
  expect(equipmentOverLimit(s.construction, [{ partId: 'design:fit-bollard' }], CONSTRUCTION_LIMITS.equipment)).toBe(false);
  expect(equipmentOverLimit(s.construction, Array(CUSTOM_FITTING_LIMITS.instances - 199).fill({ partId: 'design:fit-bollard' }), CONSTRUCTION_LIMITS.equipment)).toBe(true);
  expect(equipmentOverLimit(s.construction, Array(CONSTRUCTION_LIMITS.equipment + 1).fill({ partId: 'generic-bollard' }), CONSTRUCTION_LIMITS.equipment)).toBe(true);
  expect(decodeConstructionSource(s).construction.fittings).toHaveLength(2);
  for (const broken of [{ ...bollard, version: 2 }, { ...bollard, attach: 'wall' }, { ...bollard, tubes: [{ id: 't', points: [[0, 0, 0]], diameterM: 0.1 }] }, { ...bollard, solids: [{ ...bollard.solids[1], kind: 'ballast' }] }])
    expect(() => decodeConstructionSource({ ...s, construction: { ...s.construction, fittings: [broken] } })).toThrow();
  // 130 seated instances compile natively and stay outside the catalog equipment budget.
  const seated = structuredClone(s);
  seated.construction.equipment = seated.construction.equipment.slice(0, 130).map((item, i) => ({ ...item, position: [0, 0, 0] }));
  const result = JSON.parse(compile_construction(JSON.stringify(seated), JSON.stringify(catalog))) as ConstructionResult;
  expect(result.diagnostics.filter((d) => d.code === 'complexity')).toEqual([]);
});

test('summary, get, bounds and place read definitions and instances', () => {
  const s = batch(source(), { op: 'equipment', value: { id: 'd1', partId: 'design:fit-davit', position: [4, 3, 0], bearingDeg: 90 } });
  const summary = constructionSummary(s, catalog);
  expect(summary.limits.equipment).toEqual({ used: 0, limit: 1_000, free: 1_000 });
  expect(summary.limits.customFittingInstances).toEqual({ used: 1, limit: 1_000, free: 999 });
  expect(summary.limits.customFittingDefinitions).toEqual({ used: 2, limit: 32, free: 30 });
  expect(summary.customFittings).toEqual([
    ['fit-bollard', 'Twin bollard', 3, 1, Number(resolveCustomFitting(bollard).massKg!.toFixed(3)), 0, 'design:fit-bollard'],
    ['fit-davit', 'Davit', 5, 1, Number(resolveCustomFitting(davit).massKg!.toFixed(3)), 1, 'design:fit-davit'],
  ]);
  expect(summary.equipmentCounts).toEqual({ 'deck-fitting': 1 });
  expect(constructionGet(s, catalog, { ids: ['fit-davit'] }, { fields: ['name'] }).records).toEqual({ fittings: [{ id: 'fit-davit', name: 'Davit' }] });
  expect(constructionGet(s, catalog, { kind: 'custom-fitting' }).count).toBe(2);
  const row = constructionBounds(s, catalog, { ids: ['d1'] }).bounds[0];
  expect(row).toMatchObject({ kind: 'deck-fitting', part: 'design:fit-davit', datum: [4, 3, 0] });
  expect(row.max[1]).toBeGreaterThan(6);
  // Bearing 90 turns the arm (local −Z) to starboard.
  expect(row.max[0]).toBeGreaterThan(4.9);
  const items = placementItems(s, catalog, { partId: 'design:fit-bollard', at: [3, -30], mirror: true, id: 'fwd' });
  expect(items.map((item) => item.equipment.partId)).toEqual(['design:fit-bollard', 'design:fit-bollard']);
  expect(() => placementItems(s, catalog, { partId: 'design:fit-nothing', at: [0, 0] })).toThrow('Define it with a `fitting` command');
  expect(() => placementItems(source([{ ...bollard, fill: 9 }]), catalog, { partId: 'design:fit-bollard', at: [0, 0] })).toThrow('needs a fill of 0.01–1');
});

test('Clone carries the definitions with the instances', async () => {
  const s = batch(source(), { op: 'equipment', value: { id: 'b1', partId: 'design:fit-bollard', position: [3, 4.47, -30], bearingDeg: 0 } });
  const envelope = { formatVersion: 1 as const, parentId: null, createdAt: 1, schemaVersion: 1, catalogRevision: s.construction.catalogRevision };
  const stored = (designId: string, value: unknown): ConstructionRevision => ({ ...envelope, id: 'stored-' + designId, designId, sourceJson: encodeConstructionSource(value) });
  const designs = new Map([[s.id, { name: s.name, revision: stored(s.id, s) }]]);
  const head = (id: string) => ({ id, name: designs.get(id)!.name, revisionId: designs.get(id)!.revision.id, updatedAt: 1, schemaVersion: 1, catalogRevision: s.construction.catalogRevision });
  const store: ConstructionStore = {
    list: async () => [...designs.keys()].map(head),
    load: async (id) => ({ head: head(id), revision: designs.get(id)!.revision }),
    revisions: async (id) => [designs.get(id)!.revision],
    save: async (input) => { const saved = stored(input.designId, input.source); designs.set(input.designId, { name: input.name, revision: saved }); return saved; },
    remove: async () => {}, close() {},
  };
  const clone = await cloneConstructionDesign(store, s.id);
  const copy = decodeSavedConstruction(clone.revision);
  expect(copy.id).not.toBe(s.id);
  expect(copy.construction.fittings).toEqual(s.construction.fittings);
  expect(copy.construction.equipment).toEqual(s.construction.equipment);
  // The copy compiles to the same loading as the original: the definitions travelled with it.
  const loading = (value: ConstructionSource) => (JSON.parse(compile_construction(JSON.stringify({ ...value, id: 'same', revision: 'same', name: 'same' }), JSON.stringify(catalog))) as ConstructionResult).loading;
  expect(loading(copy)).toEqual(loading(s));
  expect(loading(copy)!.contributions.some((mass) => mass.id === 'b1')).toBe(true);
});
