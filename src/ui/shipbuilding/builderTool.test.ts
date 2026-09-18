import { beforeAll, expect, test } from 'bun:test';
import init from '../../generated/naval-wasm/naval_wasm';
import { OVERLAP_NOTICE } from './blockMovement';
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { ConstructionRevisionOwner } from '../../ships/constructionRevisionOwner';
import type { ConstructionRevision, ConstructionStore, SaveConstructionSource } from '../../ships/constructionStore';
import { createStarterSource } from '../../ships/constructionStarter';
import { CORNER_SIGNS, VERTEX_FACES } from '../../ships/constructionVertex';
import { BuilderTool, type BuilderChrome, type BuilderKey } from './builderTool';
import type { BuilderPick } from './builderScene';
import { placementCenter } from './placement';

const part = (over: Partial<ConstructionEquipmentPart> & Pick<ConstructionEquipmentPart, 'id' | 'kind' | 'placement'>): ConstructionEquipmentPart => ({
  name: over.id, size: [1, 1, 2], boundsCenter: [0, .5, 0], centerOfGravity: [0, .5, 0], massKg: 500, modelUrl: `/models/components/${over.id}/x/model.glb`, contentHash: 'x', ...over,
});
const catalog: ConstructionCatalog = {
  schemaVersion: 1, revision: 'tool-test',
  weapons: { schemaVersion: 1, parts: [{ id: 'gun-part', name: 'Gun', kind: 'gun', massKg: 4000, traverseDeg: 150 } as unknown as ConstructionCatalog['weapons']['parts'][number]] },
  equipment: [
    part({ id: 'gun', kind: 'gun', placement: 'deck', gunPartId: 'gun-part', massKg: undefined }),
    part({ id: 'propeller', kind: 'propeller', placement: 'underwater', size: [4, 4, 2], boundsCenter: [0, 0, 0] }),
    part({ id: 'engine', kind: 'engine', placement: 'internal', size: [3, 3, 6] }),
    part({ id: 'rope', kind: 'deck-fitting', placement: 'deck', massKg: 2, path: { kind: 'rope', diameterM: .04, massKgPerM: 1 } }),
    part({ id: 'railing', kind: 'deck-fitting', placement: 'deck', massKg: 2, path: { kind: 'railing', diameterM: .04, heightM: 1.1, postSpacingM: 1.5, massKgPerM: 3, postMassKg: 2 } }),
  ],
};
/** The starting block's six faces as a compiled result, so face tools have something to assign. */
function compiledFor(source: ConstructionSource): ConstructionResult {
  const surfaces: ConstructionSurface[] = source.construction.primitives.flatMap(primitive => VERTEX_FACES.map(face => {
    const assigned = source.construction.surfaces.find(entry => entry.primitiveId === primitive.id && entry.face === face.name);
    return { id: `${primitive.id}:${face.name}`, primitiveId: primitive.id, face: face.name, vertices: face.corners.map(i => CORNER_SIGNS[i].map((n, k) => primitive.position[k] + n * primitive.size[k] / 2) as Vec3),
      normal: [0, 1, 0] as Vec3, areaM2: 1, thicknessMm: Math.max(assigned?.thicknessMm ?? source.construction.defaultThicknessMm, source.construction.defaultThicknessMm), material: assigned?.material ?? 'steel', paint: assigned?.paint ?? 'naval-gray', open: !!assigned?.open };
  }));
  return { sourceId: source.id, revision: source.revision, contentHash: 'fixture', surfaces, diagnostics: [], definition: { mounts: [{ position: [0, 1, 0], bearingDeg: 0, traverseDeg: 120, weapon: { traverseDeg: 150 } }] } as unknown as ConstructionResult['definition'] };
}
const revision = (input: SaveConstructionSource, id: string): ConstructionRevision => ({ formatVersion: 1, id, designId: input.designId, parentId: input.expectedRevisionId, createdAt: 1, schemaVersion: input.schemaVersion, catalogRevision: input.catalogRevision, sourceJson: JSON.stringify(input.source) });
function loaded(value: ConstructionSource) {
  return { source: value, revision: revision({ designId: value.id, name: value.name, source: value, expectedRevisionId: null, schemaVersion: 1, catalogRevision: value.construction.catalogRevision }, 'head1'), head: { id: value.id, name: value.name, revisionId: 'head1', updatedAt: 1, schemaVersion: 1, catalogRevision: value.construction.catalogRevision } };
}
/** A real revision owner over a fake store, the tool wired to it with deterministic IDs and an optional compile. */
async function setup(options: { connect?: boolean; compile?: boolean; retained?: boolean; source?: ConstructionSource } = {}) {
  const initial = options.source ?? createStarterSource(catalog, 'blank');
  const writes: SaveConstructionSource[] = [];
  const store: ConstructionStore = { list: async () => [], load: async () => loaded(initial), revisions: async () => [], close() {}, remove: async () => {}, save: async input => { writes.push(input); return revision(input, `head${writes.length + 1}`); } };
  const owner = new ConstructionRevisionOwner(initial, { retainRecovery: async () => {}, load: async () => loaded(initial) });
  let counter = 0;
  // A retained compile is the opening source's, so later edits must read through it as a pending compile would.
  const retained = options.retained ? compiledFor(initial) : undefined;
  const tool = new BuilderTool(owner, { catalog: () => catalog, compiled: () => options.compile === false ? undefined : compiledFor(owner.source), retained: () => retained, newId: prefix => `${prefix}-${++counter}` });
  if (options.connect !== false) await owner.connect(store, initial.id);
  const data = () => owner.source.construction;
  const labels = () => owner.getSnapshot().history.past.map(step => step.label);
  return { owner, tool, store, writes, data, labels, state: tool.getSnapshot };
}
const hit = (over: Partial<BuilderPick> = {}): BuilderPick => ({ point: [0, .5, 0], axis: 1, placement: [0, 1, 0], additive: false, ...over });
const key = (key: string, over: Partial<BuilderKey> = {}): BuilderKey => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, preventDefault() {}, ...over });
const chrome = (): BuilderChrome & { log: string[] } => { const log: string[] = []; return { log, dismiss: () => { log.push('dismiss'); return false; }, toggleDrawer: () => log.push('drawer'), toggleWarnings: () => log.push('warnings'), slotChosen: () => log.push('slot') }; };

test('block type filters keep palette keys and placement in sync across layers', async () => {
  const { tool } = await setup();
  tool.setHullCategory('bridges');
  expect(tool.palette.drawer).toHaveLength(6);
  expect(tool.palette.drawer.every(item => item.kind === 'shape' && item.shape.kind.includes('bridge'))).toBe(true);
  tool.key(key('2'), chrome());
  expect(tool.piece).toMatchObject({ kind: 'hull', shape: 'diagonal-bridge' });
  tool.switchLayer('armor');
  tool.switchLayer('hull');
  expect(tool.getSnapshot().hullCategory).toBe('bridges');
  tool.setHullCategory('ballast');
  tool.key(key('1'), chrome());
  expect(tool.piece).toMatchObject({ kind: 'hull', shape: 'ballast' });
  expect(tool.hasDrawer).toBe(true);
  tool.setHullCategory('all');
  expect(tool.palette.drawer.filter(item => item.kind === 'shape' && item.shape.kind === 'box' && item.shape.size.every(n => n === 4))).toHaveLength(1);
});

test('a click and a stroke on the hull lay cube pieces with their mirrored twins as one labelled batch each', async () => {
  const { tool, data, labels } = await setup();
  tool.setTool('place');
  expect(tool.scene(undefined)).toMatchObject({ gesture: 'stroke', moveTargets: 'none', pickTargets: 'all', placementPiece: { kind: 'hull', shape: 'box', size: [1, 1, 1], rotationDeg: 0 }, gridStep: 1 });
  expect(tool.pointer({ kind: 'lay', points: [[0, 1, 0]] })).toMatchObject({ accepted: true, changed: true });
  expect(data().primitives.map(part => [part.id, part.position])).toEqual([['hull', [0, 0, 0]], ['hull-1', [0, 1, 0]]]);
  expect(tool.pointer({ kind: 'lay', points: [[1, 0, 0], [2, 0, 0]] })).toMatchObject({ accepted: true });
  expect(data().primitives.slice(2).map(part => part.position)).toEqual([[1, 0, 0], [-1, 0, 0], [2, 0, 0], [-2, 0, 0]]);
  expect(labels()).toEqual(['Place hull piece', 'Lay hull pieces']);
  tool.toggleMirror(); tool.key(key('r'), chrome());
  expect(tool.scene(undefined).placementPiece).toMatchObject({ rotationDeg: 90 });
  expect(tool.scene(undefined).placementMirror).toBeUndefined();
  tool.pointer({ kind: 'lay', points: [[3, 0, 0]] });
  expect(data().primitives.at(-1)).toMatchObject({ position: [3, 0, 0], rotationDeg: 90 });
  expect(data().primitives).toHaveLength(7);
});

test('a shut door refuses every edit with its reason and leaves the source untouched', async () => {
  const { tool, owner, store, data } = await setup({ connect: false });
  tool.setTool('place');
  const before = JSON.stringify(owner.source);
  expect(tool.pointer({ kind: 'lay', points: [[0, 1, 0]] })).toEqual({ accepted: false, reason: 'not-ready', message: expect.stringContaining('still opening') });
  expect(tool.pointer({ kind: 'erase', id: 'hull' })).toMatchObject({ accepted: false, reason: 'not-ready' });
  expect(tool.pointer({ kind: 'move', ids: ['hull'], delta: [1, 0, 0] })).toMatchObject({ accepted: false, reason: 'not-ready' });
  expect(tool.scene(undefined)).toMatchObject({ gesture: 'none', moveTargets: 'none', placementPiece: undefined });
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull' }) });
  expect(tool.getSnapshot().selected.size).toBe(0);
  await owner.connect(store, owner.source.id);
  owner.setBusy('Launching');
  expect(tool.pointer({ kind: 'lay', points: [[0, 1, 0]] })).toMatchObject({ accepted: false, reason: 'busy', message: expect.stringContaining('Launching') });
  expect(JSON.stringify(owner.source)).toBe(before);
  owner.setBusy('');
  expect(tool.pointer({ kind: 'lay', points: [[0, 1, 0]] })).toMatchObject({ accepted: true });
  expect(data().primitives).toHaveLength(2);
});

test('select, move and erase: a drag translates the pressed piece and preserves wall offsets, right-click removes, the last block stays', async () => {
  const { tool, data, labels, state } = await setup();
  tool.setTool('place');
  tool.pointer({ kind: 'lay', points: [[0, 1, 0]] });
  tool.switchLayer('internals'); tool.setTool('deck');
  expect(tool.pointer({ kind: 'pick', hit: hit({ placement: [0, 1.5, 0] }) })).toMatchObject({ accepted: true });
  expect(data().boundaries).toEqual([{ id: 'boundary-2', axis: 'y', offset: 1.5, thicknessMm: 10 }]);
  expect(tool.pointer({ kind: 'pick', hit: hit({ placement: [0, 1.5, 0] }) })).toBeUndefined();
  expect(state().notice).toContain('already sits here');
  tool.switchLayer('hull'); tool.setTool('select');
  expect(tool.scene(undefined).moveTargets).toBe('all');
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull-1' }) });
  expect([...state().selected]).toEqual(['hull-1']);
  expect(tool.pointer({ kind: 'move', ids: ['hull-1', 'boundary-2'], delta: [2, 0, 0.3] })).toMatchObject({ accepted: true });
  expect(data().primitives[1].position).toEqual([2, 1, 0.3]);
  expect(data().boundaries[0].offset).toBe(1.5); // tangential motion never rounds an untouched wall
  expect([...state().selected]).toEqual(['hull-1', 'boundary-2']);
  expect(tool.pointer({ kind: 'erase', id: 'hull-1' })).toMatchObject({ accepted: true });
  expect(data().primitives.map(part => part.id)).toEqual(['hull']);
  expect(state().selected.size).toBe(1);
  expect(tool.pointer({ kind: 'erase', id: 'hull' })).toMatchObject({ accepted: true, changed: false });
  expect(data().primitives).toHaveLength(1);
  expect(state().notice).toContain('Kept the last hull block');
  expect(labels()).toEqual(['Place hull piece', 'Add deck', 'Move selection', 'Remove piece']);
});

test('box selection switches to Select and adds with the modifier; arrows nudge, Delete removes, ⌘Z undoes', async () => {
  const { tool, owner, data, state } = await setup();
  tool.setTool('place');
  tool.pointer({ kind: 'lay', points: [[0, 1, 0], [0, 2, 0]] });
  tool.pointer({ kind: 'box', ids: ['hull-1'], additive: false });
  expect(state().tool).toBe('select'); expect([...state().selected]).toEqual(['hull-1']);
  tool.pointer({ kind: 'box', ids: ['hull-2'], additive: true });
  expect([...state().selected]).toEqual(['hull-1', 'hull-2']);
  tool.key(key('ArrowRight'), chrome());
  expect(data().primitives.slice(1).map(part => part.position)).toEqual([[1, 1, 0], [1, 2, 0]]);
  tool.key(key('PageDown'), chrome());
  expect(data().primitives[1].position).toEqual([1, 0, 0]);
  tool.key(key('Delete'), chrome());
  expect(data().primitives).toHaveLength(1); expect(state().selected.size).toBe(0);
  tool.key(key('z', { metaKey: true }), chrome());
  expect(data().primitives).toHaveLength(3);
  tool.key(key('z', { metaKey: true, shiftKey: true }), chrome());
  expect(data().primitives).toHaveLength(1);
  expect(owner.getSnapshot().history.lastAction).toBe('Redid remove selection');
});

test('switching layers resets the tool, faces and bearing; Internals keeps the whole ship visible; a face layer picks hull faces only', async () => {
  const { tool, state } = await setup();
  tool.setTool('place');
  tool.key(key('r'), chrome());
  expect(state().bearing).toBe(90);
  tool.switchLayer('armor');
  expect(state()).toMatchObject({ layer: 'armor', tool: 'apply', bearing: 0 });
  expect(tool.scene(undefined)).toMatchObject({ pickTargets: 'hull', highlightFaces: true, moveTargets: 'none', display: 'armor', gesture: 'faces' });
  tool.switchLayer('internals');
  expect(state()).toMatchObject({ layer: 'internals', tool: 'module' });
  expect(tool.scene(undefined)).toMatchObject({ rooms: true, display: 'internals', gridStep: .25 });
  tool.switchLayer('fittings');
  expect(tool.scene(undefined)).toMatchObject({ gridStep: .25, moveTargets: 'equipment' });
});

test('armor and paint: Paint assigns the active card to the clicked face and its mirror, Area gathers faces, Eyedrop copies, Opening toggles', async () => {
  const { tool, data, state, labels } = await setup();
  tool.setTool('place');
  tool.pointer({ kind: 'lay', points: [[1, 0, 0]] });
  tool.switchLayer('armor'); tool.setThickness(80);
  expect(tool.pointer({ kind: 'pick', hit: hit({ id: 'hull-1', surface: 'hull-1:top' }) })).toMatchObject({ accepted: true });
  expect(data().surfaces).toEqual([
    { primitiveId: 'hull-1', face: 'top', thicknessMm: 80, material: 'armor-steel', paint: 'naval-gray', open: false },
    { primitiveId: 'hull-2', face: 'top', thicknessMm: 80, material: 'armor-steel', paint: 'naval-gray', open: false },
  ]);
  tool.setTool('area');
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull', surface: 'hull:top' }) });
  expect([...state().surfaces].sort()).toEqual(['hull-1:top', 'hull-2:top', 'hull:top']);
  tool.setThickness(0);
  expect(data().surfaces.find(surface => surface.primitiveId === 'hull')).toMatchObject({ thicknessMm: 0, material: 'steel' });
  tool.setTool('eyedrop');
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull-1', surface: 'hull-1:top' }) });
  expect(state()).toMatchObject({ customMm: 16, tool: 'apply' });
  tool.setTool('opening');
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull', surface: 'hull:bow' }) });
  expect(data().surfaces.filter(surface => surface.open).map(surface => `${surface.primitiveId}:${surface.face}`)).toEqual(['hull:bow']);
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull', surface: 'hull:bow' }) });
  expect(data().surfaces.some(surface => surface.open)).toBe(false);
  tool.switchLayer('paint'); tool.key(key('2'), chrome());
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull', surface: 'hull:top' }) });
  expect(data().surfaces.find(surface => surface.primitiveId === 'hull' && surface.face === 'top')?.paint).toBe(tool.palette.bar[1].id);
  expect(labels()).toEqual(['Lay hull pieces', 'Assign 80 mm armor', 'Assign 0 mm armor', 'Open faces to sea', 'Close skin', `Paint ${tool.palette.bar[1].name.toLowerCase()}`]);
});

test('a face sweep assigns every crossed face and its mirror as one edit; the ship\'s thicknesses become keyed cards on its own colour scale', async () => {
  const { tool, data, state, labels } = await setup();
  tool.setTool('place');
  tool.pointer({ kind: 'lay', points: [[1, 0, 0]] });
  tool.switchLayer('armor');
  expect(state().customMm).toBe(10);
  expect(tool.scene(undefined)).toMatchObject({ gesture: 'faces', armorScale: { fromMm: 16, toMm: 16 } });
  expect(tool.palette.bar.map(item => item.id)).toEqual(['armor', 'mm-16', 'opening']);
  expect(tool.pointer({ kind: 'faces', surfaces: ['hull:top', 'hull-1:top', 'equipment:gun:top'] })).toMatchObject({ accepted: true });
  expect(labels().at(-1)).toBe('Assign 10 mm armor');
  expect(data().surfaces.filter(surface => surface.thicknessMm === 10).map(surface => `${surface.primitiveId}:${surface.face}`).sort()).toEqual(['hull-1:top', 'hull-2:top', 'hull:top']);
  expect(tool.thicknesses).toEqual([16]);
  expect(tool.armorScale).toEqual({ fromMm: 16, toMm: 16 });
  expect(tool.palette.bar.map(item => item.id)).toEqual(['armor', 'mm-16', 'opening']);
  tool.key(key('2'), chrome());
  expect(state().customMm).toBe(16);
  expect(tool.active).toMatchObject({ kind: 'thickness', mm: 16 });
  tool.pointer({ kind: 'faces', surfaces: ['hull:top'] });
  expect(labels().at(-1)).toBe('Assign 16 mm armor');
  expect(data().surfaces.find(surface => surface.primitiveId === 'hull' && surface.face === 'top')).toMatchObject({ thicknessMm: 16, material: 'armor-steel' });
  tool.setTool('opening');
  expect(tool.scene(undefined).gesture).toBe('faces');
  tool.pointer({ kind: 'faces', surfaces: ['hull:bow', 'hull:stern'] });
  expect(data().surfaces.filter(surface => surface.open).map(surface => `${surface.primitiveId}:${surface.face}`).sort()).toEqual(['hull:bow', 'hull:stern']);
  expect(tool.pointer({ kind: 'faces', surfaces: ['equipment:gun:top'] })).toBeUndefined();
  expect(state().notice).toContain('fixed equipment support');
  tool.setTool('select');
  expect(tool.scene(undefined).gesture).toBe('none');
});

test('face edits continue on the retained compile while the current one is pending, reading the source\'s assignments over it', async () => {
  const { tool, data } = await setup({ compile: false, retained: true });
  tool.switchLayer('armor');
  expect(tool.pointer({ kind: 'pick', hit: hit({ id: 'hull', surface: 'hull:top' }) })).toMatchObject({ accepted: true });
  expect(data().surfaces).toEqual([{ primitiveId: 'hull', face: 'top', thicknessMm: 10, material: 'armor-steel', paint: 'naval-gray', open: false }]);
  expect(tool.editableSurfaces.find(surface => surface.face === 'top')).toMatchObject({ thicknessMm: 16, material: 'armor-steel' });
  expect(tool.thicknesses).toEqual([16]);
  expect(tool.palette.bar.map(item => item.id)).toEqual(['armor', 'mm-16', 'opening']);
});

test('face tools wait for a compiled preview and refuse fixed equipment supports', async () => {
  const { tool, state } = await setup({ compile: false });
  tool.switchLayer('armor');
  expect(tool.pointer({ kind: 'pick', hit: hit({ id: 'hull', surface: 'hull:top' }) })).toBeUndefined();
  expect(state().notice).toContain('compiled preview');
  const compiled = await setup();
  compiled.tool.switchLayer('armor');
  compiled.tool.pointer({ kind: 'pick', hit: hit({ surface: 'equipment:gun:top' }) });
  expect(compiled.state().notice).toContain('fixed equipment support');
});

test('fittings: cards pick parts, the ghost carries a gun arc, placement mirrors bearings and Arc shows fitted mounts', async () => {
  const { tool, data, state } = await setup();
  tool.switchLayer('fittings');
  expect(tool.active?.id).toBe('gun');
  expect(tool.scene(undefined).placementPiece).toMatchObject({ kind: 'equipment', partId: 'gun', arc: { traverseDeg: 150, radius: 12 }, bearingDeg: 0 });
  tool.key(key('r'), chrome()); tool.key(key('r'), chrome());
  expect(tool.pointer({ kind: 'lay', points: [[2, .5, -3]] })).toMatchObject({ accepted: true });
  expect(data().equipment).toEqual([
    { id: 'equipment-1', partId: 'gun', position: [2, .5, -3], bearingDeg: 30 },
    { id: 'equipment-2', partId: 'gun', position: [-2, .5, -3], bearingDeg: 330 },
  ]);
  expect(tool.scene(undefined).arcs).toEqual([]);
  tool.key(key('a'), chrome());
  expect(state().showArcs).toBe(true);
  expect(tool.scene(undefined).arcs).toEqual([{ position: [0, 1, 0], bearingDeg: 0, traverseDeg: 120, radius: 12, color: '#86e4c5' }]);
});

test('connected routes: points accumulate outside history, Enter commits the route and its mirror, Escape discards', async () => {
  const { tool, owner, data, state } = await setup();
  tool.switchLayer('fittings');
  tool.selectSlot(tool.palette.all!.find(item => item.id === 'railing')!);
  expect(tool.pathPart?.id).toBe('railing');
  // The card came from another shelf: the bar opens that shelf.
  expect(state().fittingFilter.category).toBe('deck-gear'); expect(tool.palette.drawer.map(item => item.id)).toContain('railing');
  expect(tool.scene(undefined)).toMatchObject({ gesture: 'none', moveTargets: 'none', placementPiece: undefined, pathDraft: { points: [], mirror: true, slackM: 0 } });
  tool.pointer({ kind: 'path-point', point: [1, .5, -2] });
  expect(tool.pointer({ kind: 'path-finish' })).toBeUndefined();
  expect(state().notice).toContain('second point');
  tool.pointer({ kind: 'path-point', point: [1, .5, 2] });
  expect(owner.getSnapshot().history.past).toHaveLength(0);
  tool.key(key('Backspace'), chrome());
  expect(state().pathPoints).toHaveLength(1);
  tool.pointer({ kind: 'path-point', point: [1, .5, 3] });
  tool.key(key('Enter'), chrome());
  expect(data().equipment.map(item => [item.id, item.partId, item.position, item.path?.points])).toEqual([
    ['path-1', 'railing', [1, .5, -2], [[0, 0, 0], [0, 0, 5]]],
    ['path-2', 'railing', [-1, .5, -2], [[-0, 0, 0], [-0, 0, 5]]],
  ]);
  expect(state()).toMatchObject({ tool: 'select', pathPoints: [] });
  expect([...state().selected]).toEqual(['path-1', 'path-2']);
  tool.setTool('place');
  tool.pointer({ kind: 'path-point', point: [0, .5, 0] });
  tool.key(key('Escape'), chrome());
  expect(state()).toMatchObject({ tool: 'select', pathPoints: [] });
  expect(data().equipment).toHaveLength(2);
});

test('copy and mirror copy replay the editor helper through the door and select the copies', async () => {
  const { tool, data, state, labels } = await setup();
  tool.setTool('place');
  tool.pointer({ kind: 'lay', points: [[1, 0, 0]] });
  tool.setTool('select'); tool.pointer({ kind: 'pick', hit: hit({ id: 'hull-1' }) });
  tool.key(key('c', { metaKey: true }), chrome());
  expect(data().primitives).toHaveLength(4);
  expect(data().primitives[3].position).toEqual([2, 0, 0]);
  expect(state().selected.size).toBe(1); expect(state().selected.has(data().primitives[3].id)).toBe(true);
  expect(state().notice).toContain('1 m to starboard');
  tool.key(key('c', { metaKey: true, shiftKey: true }), chrome());
  expect(data().primitives[4].position).toEqual([-2, 0, 0]);
  expect(labels()).toEqual(['Lay hull pieces', 'Copy selection', 'Mirror selection']);
});

test('Escape walks chrome, the proposal, a measurement, the tool and finally the selection', async () => {
  const { tool, state } = await setup();
  const ui = chrome(); let open = true; ui.dismiss = () => { const closed = open; open = false; return closed; };
  tool.setTool('measure');
  tool.pointer({ kind: 'pick', hit: hit({ point: [0, 0, 0] }) }); tool.pointer({ kind: 'pick', hit: hit({ point: [3, 4, 0] }) });
  expect(state().measure).toEqual({ from: [0, 0, 0], to: [3, 4, 0] });
  tool.key(key('Escape'), ui);
  expect(state().measure).toBeDefined();
  tool.key(key('Escape'), ui);
  expect(state().measure).toBeUndefined(); expect(state().tool).toBe('measure');
  tool.key(key('Escape'), ui);
  expect(state().tool).toBe('select');
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull' }) });
  tool.key(key('Escape'), ui);
  expect(state().selected.size).toBe(0);
  tool.key(key('0'), ui); tool.key(key('w'), ui); tool.key(key('1'), ui);
  expect(ui.log).toEqual(['drawer', 'warnings', 'slot']);
});

test('a new design clears selections, proposals and pending routes; a removed block ends freeform editing', async () => {
  const { tool, owner, state } = await setup();
  tool.setTool('select'); tool.pointer({ kind: 'pick', hit: hit({ id: 'hull' }) });
  expect(tool.enterFreeform()).toBe(true);
  expect(tool.freeformMode).toBe(true);
  expect(tool.scene(undefined).freeform).toMatchObject({ id: 'hull', unit: .2, axes: [true, false, false] });
  tool.key(key('g'), chrome());
  expect(state().freeformSettings.unit).toBe(.5);
  tool.setTool('place');
  expect(tool.freeformMode).toBe(false); expect(state().freeform).toBeUndefined();
  tool.pointer({ kind: 'lay', points: [[0, 1, 0]] });
  tool.setTool('select'); tool.pointer({ kind: 'pick', hit: hit({ id: 'hull-1' }) });
  const other = createStarterSource(catalog, 'blank');
  await owner.replace(other, null, false);
  expect(state().selected.size).toBe(0);
  expect(tool.source.id).toBe(other.id);
  tool.setTool('place');
  expect(tool.pointer({ kind: 'lay', points: [[0, 1, 0]] })).toMatchObject({ accepted: true });
});

test('Grid steps are remembered per layer; nudges use the step and resolved pointer moves stay exact', async () => {
  const { tool, data, state } = await setup();
  tool.setTool('place');
  expect(tool.gridStep).toBe(1); expect(tool.scene(undefined).gridStep).toBe(1);
  tool.cycleSnap(); expect(tool.gridStep).toBe(2);
  tool.cycleSnap(); expect(tool.gridStep).toBe(5);
  tool.cycleSnap(); expect(tool.gridStep).toBe(.25);
  tool.switchLayer('fittings'); expect(tool.gridStep).toBe(.25);
  tool.cycleSnap(); expect(tool.gridStep).toBe(.5);
  tool.switchLayer('hull'); tool.setTool('place'); expect(state().snapSteps).toEqual({ hull: .25, equipment: .5 });
  tool.pointer({ kind: 'lay', points: [[0, 1, 0]] });
  tool.setTool('select'); tool.pointer({ kind: 'pick', hit: hit({ id: 'hull-1' }) });
  tool.key(key('ArrowRight'), chrome());
  expect(data().primitives[1].position).toEqual([.25, 1, 0]);
  tool.switchLayer('internals'); tool.setTool('deck');
  tool.pointer({ kind: 'pick', hit: hit({ placement: [0, 1.25, 0] }) });
  expect(data().boundaries[0].offset).toBe(1.25);
  tool.setTool('select');
  tool.pointer({ kind: 'move', ids: ['boundary-2'], delta: [0, .3, 0] });
  expect(data().boundaries[0].offset).toBe(1.55);
});

test('movement stops at another block: a blocked nudge adds no history and says so, a partial move keeps the reachable part', async () => {
  const { tool, owner, data, state } = await setup();
  tool.setTool('place');
  tool.pointer({ kind: 'lay', points: [[0, 0, -3]] });
  tool.setTool('select'); tool.pointer({ kind: 'pick', hit: hit({ id: 'hull-1' }) });
  const steps = owner.getSnapshot().history.past.length;
  expect(tool.pointer({ kind: 'move', ids: ['hull-1'], delta: [0, 0, 5] })).toMatchObject({ accepted: true });
  expect(data().primitives[1].position[2]).toBeCloseTo(-.1, 5);
  // The accepted part of the move clears the notice again, as the component did; a fully blocked move leaves it.
  expect(state().notice).toBe('');
  expect(owner.getSnapshot().history.past).toHaveLength(steps + 1);
  expect(tool.pointer({ kind: 'move', ids: ['hull-1'], delta: [0, 0, 1] })).toBeUndefined();
  expect(state().notice).toBe(OVERLAP_NOTICE);
  expect(data().primitives[1].position[2]).toBeCloseTo(-.1, 5);
  expect(owner.getSnapshot().history.past).toHaveLength(steps + 1);
  expect(tool.pointer({ kind: 'move', ids: ['hull-1'], delta: [1, 0, 0] })).toMatchObject({ accepted: true });
  expect(data().primitives[1].position[0]).toBe(1);
  expect(data().primitives[1].position[2]).toBeCloseTo(-.1, 5);
});

test('Internals edits only internal packages and walls: entering drops external selections, picks and box selections skip the hull, select-all takes the internals', async () => {
  const { tool, data, state } = await setup();
  tool.switchLayer('internals'); tool.selectSlot(tool.palette.drawer.find(item => item.id === 'engine')!);
  expect(state().tool).toBe('module'); expect(tool.active?.id).toBe('engine');
  tool.pointer({ kind: 'lay', points: [[0, 0, 0]] });
  tool.setTool('deck'); tool.pointer({ kind: 'pick', hit: hit({ placement: [0, 2, 0] }) });
  tool.switchLayer('hull'); tool.setTool('select'); tool.pointer({ kind: 'pick', hit: hit({ id: 'hull' }) });
  tool.key(key('a', { metaKey: true }), chrome());
  expect([...state().selected].sort()).toEqual(['equipment-1', 'hull']);
  tool.switchLayer('internals');
  expect([...state().selected]).toEqual(['equipment-1']);
  expect(tool.scene(undefined).pickTargets).toBe('internals');
  tool.setTool('select');
  tool.pointer({ kind: 'pick', hit: hit({ id: 'hull' }) });
  expect([...state().selected]).toEqual(['equipment-1']);
  tool.pointer({ kind: 'box', ids: ['hull', 'boundary-2'], additive: false });
  expect([...state().selected]).toEqual(['boundary-2']);
  tool.key(key('a', { metaKey: true }), chrome());
  expect([...state().selected].sort()).toEqual(['boundary-2', 'equipment-1']);
  expect(tool.pointer({ kind: 'erase', id: 'hull' })).toBeUndefined();
  expect(data().primitives).toHaveLength(1);
  expect(tool.pointer({ kind: 'move', ids: ['hull', 'equipment-1'], delta: [0, 0, 1] })).toMatchObject({ accepted: true });
  expect(data().primitives[0].position).toEqual([0, 0, 0]);
  expect(data().equipment[0].position).toEqual([0, 0, 1]);
});

test('a design that opens as a custom hull starts in Select with nothing chosen; the cursor piece carries a starter hull', async () => {
  const { tool, state, data } = await setup({ source: createStarterSource(catalog, 'fletcher-hull') });
  expect(data().primitives[0].kind).toBe('custom-hull');
  expect(state()).toMatchObject({ tool: 'select' });
  expect([...state().selected]).toEqual([]);
  tool.setTool('place'); tool.selectSlot(tool.palette.drawer.find(item => item.id === 'custom-hull')!);
  tool.toggleMirror();
  expect(tool.pointer({ kind: 'lay', points: [[0, 0, 60]] })).toMatchObject({ accepted: true });
  expect(data().primitives[1]).toMatchObject({ kind: 'custom-hull', size: [6.5, 4, 36] });
  expect(data().primitives[1].customHull?.stations.length).toBeGreaterThanOrEqual(4);
});

test('propeller cards preserve blade clearance through the builder scene and mirrored placement', async () => {
  const { tool } = await setup();
  tool.switchLayer('fittings');
  tool.selectSlot(tool.palette.all!.find(item => item.id === 'propeller')!);
  const scene = tool.scene(undefined);
  for (const piece of [scene.placementPiece, scene.placementMirror]) {
    expect(piece).toMatchObject({ kind: 'equipment', propellerDiameterM: 4 });
    const position = placementCenter(piece!, { point: [2, -1, -5], normal: [0, -1, 0] }, .25);
    expect(position[1] + 2).toBeLessThan(-1);
  }
});

test('turret rise uses one undoable command batch and keeps the deck datum fixed across keyboard changes', async () => {
  const source = createStarterSource(catalog, 'blank');
  source.construction.version = 1;
  source.construction.equipment = [{ id: 'turret', partId: 'gun', position: [0, 1, 0], bearingDeg: 0, magazineId: 'legacy' }];
  const { tool, owner, data } = await setup({ source });
  tool.selectOnly(['turret']);
  tool.key(key('PageUp'), chrome());
  const raised = data().equipment[0];
  expect(data().version).toBe(2);
  expect(raised.magazineId).toBeUndefined();
  expect(raised.gun?.barbetteHeightM).toBe(tool.gridStep);
  expect(raised.position[1] - raised.gun!.barbetteHeightM!).toBe(1);
  owner.undo();
  expect(data()).toEqual(source.construction);
  owner.redo();
  tool.key(key('PageDown'), chrome());
  expect(data().equipment[0].position[1]).toBe(1);
  expect(data().equipment[0].gun?.barbetteHeightM).toBe(0);
  tool.raiseTurrets(['turret'], () => 30);
  tool.key(key('PageUp'), chrome());
  expect(data().equipment[0].gun?.barbetteHeightM).toBe(30);
});


test('entering Armor or Paint replaces whole-hull selection with face selection', async () => {
  const { tool, state, labels } = await setup({ source: createStarterSource(catalog, 'fletcher-hull') });
  tool.selectOnly(['hull']);
  tool.switchLayer('armor'); expect(state().selected.size).toBe(0);
  tool.selectOnly(['hull']); tool.switchLayer('paint'); expect(state().selected.size).toBe(0);
  expect(labels()).toEqual([]);
});

test('fitting paint is undoable, saved, mirrored and inherited by subsequent fittings and paths', async () => {
  const { tool, owner, data, writes } = await setup();
  tool.switchLayer('fittings');
  const choose = (id: string) => tool.selectSlot(tool.palette.all!.find(item => item.id === id)!);
  choose('gun'); tool.placeAt([[2, 1, 0]]);
  const id = data().equipment[0].id;
  expect(data().equipment.every(item => item.paint === undefined)).toBe(true);
  expect(tool.paintFittings([id], 'sea-blue')).toMatchObject({ accepted: true });
  expect(data().equipment.map(item => item.paint)).toEqual(['sea-blue', 'sea-blue']);
  owner.undo(); expect(data().equipment.every(item => !item.paint)).toBe(true);
  owner.redo(); expect(data().equipment.every(item => item.paint === 'sea-blue')).toBe(true);
  tool.switchLayer('paint'); tool.selectSlot(tool.palette.bar.find(item => item.id === 'red-oxide')!);
  tool.pick(hit({ surface: 'hull:top', id: 'hull' }));
  expect(tool.getSnapshot().fittingPaint).toBe('sea-blue');
  tool.switchLayer('fittings'); choose('propeller'); tool.placeAt([[4, -1, 0]]);
  expect(data().equipment.slice(-2).every(item => item.paint === 'sea-blue')).toBe(true);
  choose('railing'); tool.addPathPoint([3, 1, 0]); tool.addPathPoint([3, 1, 3]); tool.finishPath();
  expect(data().equipment.slice(-2).every(item => item.paint === 'sea-blue' && item.path)).toBe(true);
  await owner.flush();
  expect(writes.at(-1)?.source).toMatchObject({ construction: { equipment: data().equipment } });
  owner.setBusy('Saving');
  expect(tool.paintFittings([id], 'red-oxide')).toMatchObject({ accepted: false });
  expect(tool.getSnapshot().fittingPaint).toBe('sea-blue');
  owner.setBusy(''); tool.paintFittings([id]);
  expect(data().equipment.slice(0, 2).every(item => !item.paint)).toBe(true);
  expect(tool.getSnapshot().fittingPaint).toBeUndefined();
  tool.dispose();
});

test('Paint layer picks fittings, eyedrops and paints selected fittings from its palette', async () => {
  const { tool, data } = await setup();
  tool.switchLayer('fittings'); tool.selectSlot(tool.palette.all!.find(item => item.id === 'gun')!); tool.placeAt([[0, 1, 0]]);
  const id = data().equipment[0].id;
  tool.switchLayer('paint'); expect(tool.scene(undefined).pickTargets).toBe('all');
  tool.selectSlot(tool.palette.bar.find(item => item.id === 'sea-blue')!);
  tool.pick(hit({ id })); expect(data().equipment[0].paint).toBe('sea-blue');
  tool.setTool('select'); tool.pick(hit({ id }));
  tool.selectSlot(tool.palette.bar.find(item => item.id === 'red-oxide')!);
  expect(data().equipment[0].paint).toBe('red-oxide');
  tool.setTool('eyedrop'); tool.pick(hit({ id })); expect(tool.getSnapshot().slots.paint).toBe('red-oxide');
  expect(tool.getSnapshot().tool).toBe('apply');
  tool.dispose();
});

test('fine fitting rotation preserves fractional bearings, filters hull IDs and commits one undoable batch', async () => {
  const { tool, data, owner, labels } = await setup();
  tool.switchLayer('fittings');
  tool.pointer({ kind: 'rotate', ids: [], degrees: 359.4 });
  tool.key(key('R', { shiftKey: true }), chrome());
  expect(tool.getSnapshot().bearing).toBeCloseTo(.4);
  expect(labels()).toEqual([]);
  tool.pointer({ kind: 'lay', points: [[2, 1, 0]] });
  const fittings = data().equipment.map(item => ({ id: item.id, bearing: item.bearingDeg, position: [...item.position] as Vec3 }));
  expect(fittings).toHaveLength(2);
  const before = labels().length;
  tool.pointer({ kind: 'rotate', ids: ['hull', ...fittings.map(item => item.id)], degrees: -2.7 });
  expect(labels()).toHaveLength(before + 1);
  expect(data().primitives[0].rotationDeg).toBe(0);
  fittings.forEach((item, i) => {
    expect(data().equipment[i].bearingDeg).toBeCloseTo((item.bearing - 2.7 + 360) % 360);
    expect(data().equipment[i].position).toEqual(item.position);
  });
  owner.undo();
  fittings.forEach((item, i) => expect(data().equipment[i].bearingDeg).toBeCloseTo(item.bearing));
  tool.pointer({ kind: 'rotate', ids: fittings.map(item => item.id), degrees: 360 });
  tool.pointer({ kind: 'rotate', ids: fittings.map(item => item.id), degrees: NaN });
  expect(labels()).toHaveLength(before);
});

test('clicking an active placement card stops placement and clicking again resumes', async () => {
  const { tool } = await setup();
  for (const layer of ['hull', 'fittings', 'internals'] as const) {
    tool.switchLayer(layer);
    const card = tool.palette.drawer.find(item => layer === 'hull' ? item.kind === 'shape' : item.kind === 'part')!;
    tool.selectSlot(card);
    expect(tool.piece).toBeDefined();
    tool.toggleSlot(card);
    expect(tool.getSnapshot().tool).toBe('select');
    expect(tool.piece).toBeUndefined();
    tool.toggleSlot(card);
    expect(tool.piece).toBeDefined();
  }
});

test('armor and paint cards resume their brush after being toggled off', async () => {
  const { tool } = await setup();
  for (const layer of ['armor', 'paint'] as const) {
    tool.switchLayer(layer);
    const card = tool.active!;
    tool.toggleSlot(card);
    expect(tool.getSnapshot().tool).toBe('select');
    tool.toggleSlot(card);
    expect(tool.getSnapshot().tool).toBe('apply');
  }
});


test('opening a blank design starts in Select without a placement card or selected piece', async () => {
  const { tool, state } = await setup();
  expect(state().tool).toBe('select');
  expect(state().selected.size).toBe(0);
  expect(tool.piece).toBeUndefined();
});

test('N and a held override preserve target choices, including freeform mode', async () => {
  const { tool, state } = await setup();
  tool.changeSnapping({ grid: false, geometry: true });
  tool.key(key('n'), chrome());
  expect(tool.scene(undefined).snapping).toMatchObject({ enabled: false, grid: false, geometry: true });
  tool.key(key('n', { repeat: true }), chrome());
  expect(state().snapping.enabled).toBe(false);
  tool.setSnapOverride(true); expect(tool.effectiveSnapping.enabled).toBe(true);
  tool.setSnapOverride(false); expect(tool.effectiveSnapping.enabled).toBe(false);
  tool.choose('hull'); tool.enterFreeform(); tool.key(key('n'), chrome());
  expect(tool.effectiveSnapping.enabled).toBe(true);
  expect(state().snapping.grid).toBe(false);
  tool.dispose();
});

test('exact moves retain fractional positions and wall offsets through undo', async () => {
  const { tool, data, owner } = await setup();
  tool.switchLayer('internals'); tool.setTool('deck');
  tool.pointer({ kind: 'pick', hit: hit({ placement: [0, .15, 0] }) });
  const wall = data().boundaries[0];
  tool.movePieces([wall.id], [0, .0123, 0]);
  expect(data().boundaries[0].offset).toBeCloseTo(.1623, 10);
  owner.undo(); expect(data().boundaries[0].offset).toBe(.15);
  tool.dispose();
});

test('S cycles the active grid, preserves layer choices and ignores repeat and modifiers', async () => {
  const { tool, state } = await setup();
  tool.key(key('s'), chrome()); expect(tool.gridStep).toBe(2);
  for (const options of [{ repeat: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) tool.key(key('s', options), chrome());
  expect(tool.gridStep).toBe(2);
  tool.switchLayer('fittings'); tool.key(key('s'), chrome()); expect(tool.gridStep).toBe(.5);
  tool.switchLayer('hull'); expect(tool.gridStep).toBe(2);
  tool.choose('hull'); tool.enterFreeform();
  tool.changeFreeformSettings({ unit: 2 }); tool.key(key('s'), chrome());
  expect(state().freeformSettings.unit).toBe(.05);
  tool.exitFreeform(); expect(tool.gridStep).toBe(2);
  tool.key(key('s'), chrome()); tool.key(key('s'), chrome()); expect(tool.gridStep).toBe(.25);
  tool.dispose();
});

test('Center on ship preserves a group arrangement and commits one undoable move', async () => {
  const source = createStarterSource(catalog, 'blank');
  source.construction.equipment = [
    { id: 'one', partId: 'gun', position: [2, 3, 4], bearingDeg: 0 },
    { id: 'two', partId: 'gun', position: [4, 3, 8], bearingDeg: 0 },
  ];
  const { tool, data, owner, labels } = await setup({ source });
  tool.choose('one'); tool.choose('two', true);
  tool.centerSelection();
  expect(data().equipment.map(p => p.position)).toEqual([[-1, 3, 4], [1, 3, 8]]);
  expect(labels()).toEqual(['Move selection']);
  owner.undo(); expect(data().equipment.map(p => p.position)).toEqual([[2, 3, 4], [4, 3, 8]]);
  tool.dispose();
});


test('invalid hull placements and mirrored overlaps add no history; partial overlap is undoable', async () => {
  const { tool, owner, data, state } = await setup();
  tool.setTool('place');
  const before = owner.getSnapshot().history.past.length;
  expect(tool.placeAt([[0,0,0]])).toBeUndefined();
  expect(data().primitives).toHaveLength(1);
  expect(state().notice).toBe(OVERLAP_NOTICE);
  expect(tool.placeAt([[.02,1,0]])).toBeUndefined();
  expect(owner.getSnapshot().history.past).toHaveLength(before);
  tool.toggleMirror();
  expect(tool.placeAt([[.2,0,0]])).toMatchObject({accepted:true});
  expect(data().primitives).toHaveLength(2);
  owner.undo(); expect(data().primitives).toHaveLength(1);
  owner.redo(); expect(data().primitives).toHaveLength(2);
});

test('D converts one selected curved shape, ignores repeat/modifiers, and toggles freeform without losing edits',async()=>{
  const source=createStarterSource(catalog,'blank');source.construction.primitives[0].kind='cylinder';
  const {tool,data,owner}=await setup({source}),ui=chrome();
  tool.key(key('d'),ui);expect(tool.freeformMode).toBe(false);
  tool.choose('hull');tool.key(key('d',{altKey:true}),ui);expect(tool.freeformMode).toBe(false);
  tool.key(key('d'),ui);expect(tool.freeformMode).toBe(true);expect(data().primitives[0].mesh?.rings).toHaveLength(2);
  tool.key(key('d',{repeat:true}),ui);expect(tool.freeformMode).toBe(true);
  tool.key(key('d'),ui);expect(tool.freeformMode).toBe(false);expect(data().primitives[0].mesh).toBeDefined();
  owner.undo();expect(data().primitives[0].kind).toBe('cylinder');
  tool.switchLayer('internals');tool.key(key('d'),ui);expect(tool.getSnapshot().tool).toBe('deck');
  tool.dispose();
});

test('new ropes sag in preview and source, bounded for short spans; zero stays available', async () => {
  const { tool, data } = await setup();
  tool.switchLayer('fittings');
  tool.selectSlot(tool.palette.all!.find(slot => slot.id === 'rope')!);
  tool.addPathPoint([0, 2, 0]); tool.addPathPoint([0, 2, 4]);
  expect(tool.scene(undefined).pathDraft?.slackM).toBe(.15);
  tool.finishPath();
  expect(data().equipment.at(-1)?.path?.slackM).toBe(.15);
  tool.selectSlot(tool.palette.all!.find(slot => slot.id === 'rope')!);
  tool.addPathPoint([0, 2, 0]); tool.addPathPoint([0, 2, .1]);
  expect(tool.scene(undefined).pathDraft?.slackM).toBe(.05);
  tool.setRopeSlack(0);
  tool.finishPath();
  expect(data().equipment.at(-1)?.path?.slackM).toBe(0);
});

test('editing a detached balcony reseats it in the same undoable source transaction', async () => {
  const initial = createStarterSource(catalog, 'blank');
  initial.construction.primitives[0].size = [8, 8, 8];
  const { defaultBalcony } = await import('../../ships/constructionBalcony');
  const balcony = { id: 'balcony', kind: 'balcony' as const, size: [2, .08, 1] as Vec3, position: [5.1, 0, 0] as Vec3, rotationDeg: 0, balcony: defaultBalcony() };
  initial.construction.primitives.push(balcony);
  const { tool, owner, data, labels } = await setup({ source: initial });
  const changed = structuredClone(balcony); changed.size[0] = 1;
  tool.editPrimitive('Resize hull piece', changed);
  expect(data().primitives[1].position[0]).toBeCloseTo(4.49, 8);
  expect(data().primitives[1].size[0]).toBe(1);
  expect(labels()).toEqual(['Resize hull piece']);
  owner.undo();
  expect(data().primitives[1]).toEqual(balcony);
});

test('rotation mode selects ship axes, commits precise angles and restores each edit with undo', async () => {
  const { tool, data, labels } = await setup();
  tool.choose('hull', false); tool.key(key('o'), chrome());
  expect(tool.scene(undefined)).toMatchObject({ moveTargets: 'none', rotation: { id: 'hull', axis: 1, snap: true } });
  tool.key(key('x'), chrome()); tool.key(key('r'), chrome());
  expect(data().primitives[0].tilt?.pitchDeg).toBe(90);
  expect(labels()).toEqual(['Rotate block']);
  tool.key(key('r', { shiftKey: true }), chrome());
  expect(data().primitives[0].tilt).toBeUndefined();
  tool.undo(); expect(data().primitives[0].tilt?.pitchDeg).toBe(90);
  tool.setBlockAngle(0, 24.5); tool.setBlockAngle(1, 37); tool.setBlockAngle(2, -15);
  expect(data().primitives[0]).toMatchObject({ rotationDeg: 37, tilt: { version: 1, pitchDeg: 24.5, rollDeg: -15 } });
  const saved = structuredClone(data().primitives[0]); tool.resetBlockRotation();
  expect(data().primitives[0].tilt).toBeUndefined(); expect(data().primitives[0].rotationDeg).toBe(0);
  tool.undo(); expect(data().primitives[0]).toEqual(saved);
  tool.key(key('Escape'), chrome());
  expect(tool.getSnapshot().selected.has('hull')).toBe(true); expect(tool.scene(undefined).rotation).toBeUndefined();
  tool.key(key('r'), chrome()); expect(data().primitives[0].rotationDeg).toBe(127);
});
