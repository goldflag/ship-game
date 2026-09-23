import { expect, test } from 'bun:test';
import { applyConstructionBatch, constructionDiffCommands, type ConstructionBatch } from './constructionCommands';
import { createStarterSource } from './constructionStarter';
import { customHullPanels, mirroredPanelId } from './constructionPanels';
import { ConstructionCommandError, type ConstructionCommand } from './constructionCommands';
import { rotateConstructionSelection } from './constructionEditor';
import { setBarbetteHeight } from './constructionArmament';
import type { ConstructionCatalog, ConstructionSource } from './blueprint';
const source = (): ConstructionSource => ({ schemaVersion: 1, id: 'test', name: 'Test', revision: 'one', coordinates: 'meters-y-up-bow-negative-z', construction: { version: 1, catalogRevision: 'test', defaultThicknessMm: 10, primitives: [{ id: 'hull', kind: 'box', size: [10, 4, 20], position: [0, 0, 0], rotationDeg: 0 }], surfaces: [], equipment: [], boundaries: [], loads: [] } });
test('ship finish round-trips through source commands without changing geometry or colors', () => {
  const original = source();
  const apply = (s: ConstructionSource, commands: ConstructionCommand[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Finish', commands });
  const finished = apply(original, [{ op: 'finish', finish: 'semi-gloss' }]);
  expect(finished.construction).toEqual({ ...original.construction, finish: 'semi-gloss' });
  const saved = JSON.parse(JSON.stringify(finished));
  expect(constructionDiffCommands(original, saved)).toEqual([{ op: 'finish', finish: 'semi-gloss' }]);
  expect(apply(saved, [{ op: 'finish' }]).construction).toEqual(original.construction);
  expect(() => apply(original, [{ op: 'finish', finish: 'chrome' } as unknown as ConstructionCommand])).toThrow('Command 0 (finish): finish must be one of "matte", "satin", "semi-gloss", "gloss", got "chrome"');
  expect(original.construction.finish).toBeUndefined();
  const painted = apply(original, [{ op: 'ship-paint', paint: 'sea-blue' }]);
  expect(painted.construction.paint).toBe('sea-blue');
  expect(constructionDiffCommands(original, painted)).toEqual([{ op: 'ship-paint', paint: 'sea-blue' }]);
  expect(apply(painted, [{ op: 'ship-paint' }]).construction).toEqual(original.construction);
  expect(() => apply(original, [{ op: 'ship-paint', paint: '' }])).toThrow('Command 0 (ship-paint): paint must be a string of 1 to 64 characters, got ""');
});
test('ship wear and roof paint round-trip through source commands and the diff', () => {
  const original = source();
  const apply = (s: ConstructionSource, commands: ConstructionCommand[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Weather', commands });
  const weathered = JSON.parse(JSON.stringify(apply(original, [{ op: 'wear', wear: 'battle-worn' }, { op: 'roof-paint', paint: 'deck-gray' }])));
  expect(weathered.construction).toEqual({ ...original.construction, wear: 'battle-worn', roofPaint: 'deck-gray' });
  expect(constructionDiffCommands(original, weathered)).toEqual([{ op: 'roof-paint', paint: 'deck-gray' }, { op: 'wear', wear: 'battle-worn' }]);
  expect(constructionDiffCommands(weathered, original)).toEqual([{ op: 'roof-paint', paint: undefined }, { op: 'wear', wear: undefined }]);
  expect(apply(weathered, constructionDiffCommands(weathered, original)).construction).toEqual(original.construction);
  expect(apply(weathered, [{ op: 'wear' }, { op: 'roof-paint' }]).construction).toEqual(original.construction);
  expect(() => apply(original, [{ op: 'wear', wear: 'rusted' } as unknown as ConstructionCommand]))
    .toThrow('Command 0 (wear): wear must be one of "fresh", "in-commission", "long-deployment", "battle-worn", got "rusted"');
  expect(() => apply(original, [{ op: 'roof-paint', paint: '' }])).toThrow('Command 0 (roof-paint): paint must be a string of 1 to 64 characters, got ""');
  expect(original.construction.wear).toBeUndefined();
});
test('agent batch is atomic and rejects stale revisions and syntax failures', () => {
  const original = source(), before = JSON.stringify(original);
  const batch: ConstructionBatch = { version: 1, expectedRevision: 'one', label: 'Refit', commands: [{ op: 'name', name: 'Changed' }, { op: 'move', ids: ['absent'], delta: [1, 0, 0] }] };
  expect(() => applyConstructionBatch(original, batch)).toThrow('unknown');
  expect(JSON.stringify(original)).toBe(before);
  expect(() => applyConstructionBatch(original, { ...batch, expectedRevision: 'old' })).toThrow('revision');
});
test('batch preserves stable IDs, face assignments and equipment links through one source revision', () => {
  const s = source();
  const next = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Fit gun', commands: [
    { op: 'equipment', value: { id: 'gun', partId: 'exact-variant', position: [0, 2, 0], bearingDeg: 0, magazineId: 'mag' } },
    { op: 'surface', value: { primitiveId: 'hull', face: 'top', thicknessMm: 20, material: 'steel', paint: 'deck-gray' } },
    { op: 'vertices', id: 'hull', selection: { mode: 'face', index: 5 }, delta: [0, 1, 0] },
  ] }, 'two');
  expect(next.revision).toBe('two');
  expect(next.construction.primitives[0].id).toBe('hull');
  expect(next.construction.primitives[0].vertices).toHaveLength(8);
  expect(next.construction.equipment[0].magazineId).toBe('mag');
  expect(next.construction.surfaces[0].primitiveId).toBe('hull');
  expect(s.construction.equipment).toHaveLength(0);
});

test('a diff between a source and its edited copy replays as one batch, upserting before removing so the last hull block is never protected by mistake', () => {
  const s = source();
  s.construction.surfaces = [{ primitiveId: 'hull', face: 'top', thicknessMm: 20, material: 'armor-steel', paint: 'deck-gray' }];
  const next = structuredClone(s);
  next.name = 'Split'; next.construction.catalogRevision = 'newer';
  next.construction.primitives = [{ id: 'a', kind: 'box', size: [10, 4, 10], position: [0, 0, -5], rotationDeg: 0 }, { id: 'b', kind: 'box', size: [10, 4, 10], position: [0, 0, 5], rotationDeg: 0 }];
  next.construction.surfaces = [{ primitiveId: 'a', face: 'top', thicknessMm: 20, material: 'armor-steel', paint: 'deck-gray' }];
  next.construction.boundaries = [{ id: 'deck', axis: 'y', offset: 1, thicknessMm: 10 }];
  const commands = constructionDiffCommands(s, next);
  expect(commands.map(command => command.op)).toEqual(['name', 'catalog', 'primitive', 'primitive', 'boundary', 'remove', 'surface']);
  const applied = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Diff', commands }, 'two');
  expect({ ...applied, revision: s.revision }).toEqual({ ...next, revision: s.revision });
  expect(constructionDiffCommands(s, s)).toEqual([]);
  const cleared = structuredClone(s); cleared.construction.surfaces = [];
  const removal = constructionDiffCommands(s, cleared);
  expect(removal).toEqual([{ op: 'surface-remove', targets: [{ primitiveId: 'hull', face: 'top' }] }]);
  expect(applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Inherit', commands: removal }).construction.surfaces).toEqual([]);
});

test('adjustable hull edits preserve section IDs, equipment and panel armor; malformed patches roll back', () => {
  const s = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull');
  // Start below the section limit so the expansion exercises ID preservation.
  s.construction.primitives[0] = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Eight sections', commands: [{ op: 'hull-sections', id: 'hull', count: 8 }] }).construction.primitives[0];
  const hull = s.construction.primitives[0], ids = hull.customHull!.stations.map(s => s.id);
  s.construction.equipment.push({ id: 'gun', partId: 'variant', position: [0, 5, 0], bearingDeg: 0 });
  const panel = customHullPanels(hull).find(p => p.face === 'port')!;
  s.construction.surfaces.push({ primitiveId: hull.id, ...panel, thicknessMm: 50, material: 'armor-steel', paint: 'naval-gray' });
  const run = (commands: ConstructionCommand[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Shape hull', commands });
  const next = run([
    { op: 'primitive-patch', id: 'hull', changes: { size: [14, 10, 130], customHull: { rake: .4, redPaintY: null } } },
    { op: 'hull-station', id: 'hull', stationId: ids[1], changes: { t: .09 } },
    { op: 'surface-patch', targets: [{ primitiveId: 'hull', ...panel }], changes: { paint: 'deck-gray' }, mirror: true },
  ]);
  expect(next.construction.primitives[0].customHull!.stations.map(s => s.id)).toEqual(ids);
  expect(next.construction.primitives[0].customHull!.stations[1].t).toBe(.09);
  expect(next.construction.primitives[0].customHull!.redPaintY).toBeUndefined();
  expect(next.construction.equipment).toEqual(s.construction.equipment);
  const painted = next.construction.surfaces.find(p => p.panelId === panel.panelId)!;
  expect(painted.thicknessMm).toBe(50); expect(painted.material).toBe('armor-steel');
  expect(next.construction.surfaces.find(p => p.panelId === mirroredPanelId(panel.panelId))?.paint).toBe('deck-gray');
  const expanded = run([{ op: 'hull-sections', id: 'hull', count: 12 }]);
  expect(expanded.construction.primitives[0].customHull!.stations).toHaveLength(12);
  expect(ids.every(id => expanded.construction.primitives[0].customHull!.stations.some(s => s.id === id))).toBe(true);
  expect(expanded.construction.surfaces).toEqual(s.construction.surfaces);
  const before = JSON.stringify(s);
  expect(() => run([{ op: 'name', name: 'Bad' }, { op: 'hull-sections', id: 'hull', count: 49 }])).toThrow('4 to 48');
  expect(() => run([{ op: 'primitive-patch', id: 'hull', changes: { customHull: { stations: [] } } }])).toThrow('4–48');
  expect(() => run([{ op: 'primitive-patch', id: 'hull', changes: { customHull: { typo: 1 } } } as unknown as ConstructionCommand])).toThrow('Command 0 (primitive-patch): unknown field changes.customHull.typo');
  expect(JSON.stringify(s)).toBe(before);
});

test('targeted fittings edits preserve nested settings, linked wall partners, routes and exact variants', () => {
  const s = source();
  s.construction.equipment = [
    { id: 'gun', partId: 'variant', position: [0, 2, 0], bearingDeg: 12.5, gun: { barbetteHeightM: .5, battery: 'secondary', traverseLimitsDeg: [-60, 60] } },
    { id: 'rope', partId: 'rope-variant', position: [0, 2, 0], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, 4]], slackM: .2 } },
    { id: 'window-p', partId: 'window', position: [-5, 0, 0], bearingDeg: -90, wall: { version: 1, widthM: 1, heightM: 1, mirrorId: 'window-s' } },
    { id: 'window-s', partId: 'window', position: [5, 0, 0], bearingDeg: 90, wall: { version: 1, widthM: 1, heightM: 1, mirrorId: 'window-p' } },
    { id: 'screw', partId: 'screw', position: [0, 0, 10], bearingDeg: 0, powerSourceId: 'manual-engine' },
  ];
  const next = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Refit', commands: [
    { op: 'equipment-patch', id: 'gun', changes: { gun: { barbetteHeightM: 1 }, bearingDeg: 13.1 } },
    { op: 'equipment-patch', id: 'rope', changes: { path: { slackM: .5 } } },
    { op: 'equipment-patch', id: 'window-p', changes: { wall: { widthM: 2 }, paint: 'deck-gray' } },
    { op: 'equipment-patch', id: 'screw', changes: { powerSourceId: null } },
  ] });
  expect(next.construction.equipment[0].gun).toEqual({ ...s.construction.equipment[0].gun, barbetteHeightM: 1 });
  expect(next.construction.equipment[0].partId).toBe('variant');
  expect(next.construction.equipment[1].path).toEqual({ ...s.construction.equipment[1].path!, slackM: .5 });
  expect(next.construction.equipment[3].wall).toEqual({ ...s.construction.equipment[3].wall!, widthM: 2 });
  expect(next.construction.equipment[3].paint).toBe('deck-gray');
  expect(next.construction.equipment[4].powerSourceId).toBeUndefined();
  expect(s.construction.equipment[4].powerSourceId).toBe('manual-engine');
});

test('copy uses requested stable IDs, mirrors hull panels and remaps copied system links', () => {
  const s = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull');
  s.construction.primitives[0].position[0] = -5;
  const panel = customHullPanels(s.construction.primitives[0])[0];
  s.construction.surfaces.push({ primitiveId: 'hull', ...panel, thicknessMm: 30, material: 'steel', paint: 'naval-gray' });
  s.construction.equipment.push({ id: 'engine', partId: 'engine', position: [-5, 0, 0], bearingDeg: 0 }, { id: 'screw', partId: 'screw', position: [-5, 0, 10], bearingDeg: 5, powerSourceId: 'engine' });
  const command: ConstructionCommand = { op: 'copy', copies: [{ from: 'hull', to: 'hull-s' }, { from: 'engine', to: 'engine-s' }, { from: 'screw', to: 'screw-s' }], mirror: true };
  const run = (commands: ConstructionCommand[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Twin hull', commands });
  const next = run([command, { op: 'move', ids: ['hull-s', 'engine-s', 'screw-s'], delta: [1, 0, 0] }]);
  expect(next.construction.primitives[1].position[0]).toBe(6);
  expect(next.construction.equipment.find(p => p.id === 'screw-s')).toMatchObject({ powerSourceId: 'engine-s', bearingDeg: 355 });
  expect(next.construction.surfaces.find(p => p.primitiveId === 'hull-s' && p.panelId === mirroredPanelId(panel.panelId))?.thicknessMm).toBe(30);
  expect(() => run([{ op: 'copy', copies: [{ from: 'hull', to: 'engine' }] }])).toThrow('new and unique');
  expect(() => run([{ op: 'copy', copies: [{ from: 'hull', to: 'one' }, { from: 'hull', to: 'two' }] }])).toThrow();
  expect(s.construction.primitives).toHaveLength(1);
});

test('balcony edges and freeform treatments can be patched without replacing unrelated source', () => {
  const s = source();
  s.construction.primitives.push({ id: 'platform', kind: 'balcony', size: [4, .2, 3], position: [0, 3, 0], rotationDeg: 0, balcony: { version: 1, heightM: 1, wallThicknessM: .05, points: [{ id: 'a', x: -.5, z: -.5, edge: 'wall' }, { id: 'b', x: .5, z: -.5, edge: 'railing' }, { id: 'c', x: 0, z: .5, edge: 'open' }] } });
  const next = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Detail', commands: [
    { op: 'primitive-patch', id: 'platform', changes: { balcony: { heightM: 1.2 } } },
    { op: 'primitive-patch', id: 'hull', changes: { kind: 'vertex', shaping: { version: 1, edges: [0, 1], radius: .1, style: 'round' } } },
  ] });
  expect(next.construction.primitives[1].balcony!.points).toEqual(s.construction.primitives[1].balcony!.points);
  expect(next.construction.primitives[0].shaping?.edges).toEqual([0, 1]);
  const cleared = applyConstructionBatch(next, { version: 1, expectedRevision: next.revision, label: 'Sharp', commands: [{ op: 'primitive-patch', id: 'hull', changes: { shaping: null } }] });
  expect(cleared.construction.primitives[0].shaping).toBeUndefined();
});

const apply = (s: ConstructionSource, ...commands: unknown[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Test', commands: commands as ConstructionCommand[] });
const failure = (s: ConstructionSource, ...commands: unknown[]): ConstructionCommandError => {
  const before = JSON.stringify(s);
  try { apply(s, ...commands); } catch (error) {
    expect(JSON.stringify(s)).toBe(before);
    expect(error).toBeInstanceOf(ConstructionCommandError);
    return error as ConstructionCommandError;
  }
  throw new Error('Expected the batch to be rejected.');
};
const armed = () => {
  const s = source();
  s.construction.equipment = [{ id: 'gun-forward', partId: 'variant', position: [0, 2, -5], bearingDeg: 0 }];
  s.construction.boundaries = [{ id: 'deck', axis: 'y', offset: 1, thicknessMm: 10 }];
  return s;
};

test('malformed commands are rejected before anything applies, naming the command, path and value', () => {
  const s = armed(), ok = { op: 'name', name: 'Applied first' };
  const cases: [unknown, string, string | undefined][] = [
    [{ op: 'move', ids: ['gun-forward'], delta: [0, null, 1] }, 'Command 1 (move): delta[1] must be a finite number, got null', 'delta[1]'],
    [{ op: 'move', ids: ['gun-forward'], delta: [0, 1] }, 'Command 1 (move): delta must be an array of 3 values, got [0,1]', 'delta'],
    [{ op: 'move', ids: ['gun-forward'] }, 'Command 1 (move): delta is required', 'delta'],
    [{ op: 'move', ids: ['gun-forward'], delta: [0, NaN, 0] }, 'Command 1 (move): delta[1] must be a finite number, got NaN', 'delta[1]'],
    [{ op: 'rotate', ids: ['gun-forward'] }, 'Command 1 (rotate): degrees is required', 'degrees'],
    [{ op: 'rotate', ids: ['gun-forward'], degrees: '90' }, 'Command 1 (rotate): degrees must be a finite number, got "90"', 'degrees'],
    [{ op: 'rotate', ids: ['gun-forward'], degress: 90 }, 'Command 1 (rotate): unknown field degress; closest: "degrees". Accepted: ids, degrees', 'degress'],
    [{ op: 'rotat', ids: ['gun-forward'], degrees: 90 }, 'Command 1 (rotat): unknown op "rotat"; closest: "rotate"', 'op'],
    [{ ids: [] }, 'Command 1 (unknown): unknown op undefined', 'op'],
    [null, 'Command 1 (unknown): it must be an object, got null', ''],
    [{ op: 'skin', thicknessMm: Infinity }, 'Command 1 (skin): thicknessMm must be a finite number, got Infinity', 'thicknessMm'],
    [{ op: 'name', name: 7 }, 'Command 1 (name): name must be a string, got 7', 'name'],
    [{ op: 'remove', ids: 'gun-forward' }, 'Command 1 (remove): ids must be an array, got "gun-forward"', 'ids'],
    [{ op: 'remove', ids: ['gun-forward', 4] }, 'Command 1 (remove): ids[1] must be a string, got 4', 'ids[1]'],
    [{ op: 'hull-sections', id: 'hull', count: 8.5 }, 'Command 1 (hull-sections): count must be an integer from 4 to 48, got 8.5', 'count'],
    [{ op: 'construction-version', version: 3 }, 'Command 1 (construction-version): version must be one of 1, 2, got 3', 'version'],
    [{ op: 'copy', copies: [] }, 'Command 1 (copy): copies must be an array of at least 1 item, got []', 'copies'],
    [{ op: 'copy', copies: [{ from: 'hull' }] }, 'Command 1 (copy): copies[0].to is required', 'copies[0].to'],
    [{ op: 'vertices', id: 'hull', selection: { mode: 'corner', index: 0 }, delta: [0, 0, 0] }, 'selection.mode must be one of "vertex", "edge", "face", "ring", got "corner"', 'selection.mode'],
    [{ op: 'vertices', id: 'hull', selection: { mode: 'face', index: 0 }, delta: [0, 0, 0], mirror: [true, false] }, 'mirror must be an array of 3 values', 'mirror'],
    [{ op: 'surface-patch', targets: [{ primitiveId: 'hull', face: 'deck' }], changes: {} }, 'targets[0].face must be one of', 'targets[0].face'],
    [{ op: 'surface-patch', targets: [{ primitiveId: 'hull', face: 'top' }], changes: { thicknessMm: '20' } }, 'changes.thicknessMm must be a finite number, got "20"', 'changes.thicknessMm'],
    [{ op: 'equipment', value: { id: 'gun', partId: 'variant', position: [0, 0, 0], bearingdeg: 0 } }, 'Command 1 (equipment): unknown field value.bearingdeg; closest: "bearingDeg"', 'value.bearingdeg'],
    [{ op: 'equipment-patch', id: 'gun-forward', changes: { position: null } }, 'Command 1 (equipment-patch): changes.position must be an array of 3 values, got null', 'changes.position'],
    [{ op: 'equipment-patch', id: 'gun-forward', changes: { gun: { barbetteHeightM: 'high' } } }, 'changes.gun.barbetteHeightM must be a finite number', 'changes.gun.barbetteHeightM'],
    [{ op: 'turret-rise', id: 'gun-forward', heightM: 31 }, 'Command 1 (turret-rise): heightM must be a number from 0 to 30, got 31', 'heightM'],
  ];
  for (const [command, message, path] of cases) {
    const error = failure(s, ok, command);
    expect(error.message).toContain(message);
    expect({ commandIndex: error.commandIndex, path: error.path }).toEqual({ commandIndex: 1, path });
  }
  expect(failure(s, { op: 'move', ids: ['gun-forward'], delta: [0, null, 1] }).toJSON()).toEqual({
    error: 'Command 0 (move): delta[1] must be a finite number, got null', commandIndex: 0, op: 'move', path: 'delta[1]', value: null,
  });
  // The editor builds commands with undefined members; they are omitted fields, not unknown ones.
  expect(apply(s, { op: 'finish', finish: undefined }, { op: 'surface-patch', targets: [], changes: {}, mirror: undefined })).toEqual(s);
});

test('a malformed batch envelope is rejected without a command index', () => {
  const s = source();
  const run = (batch: unknown) => { try { applyConstructionBatch(s, batch as ConstructionBatch); } catch (error) { return error as ConstructionCommandError; } throw new Error('accepted'); };
  expect(run({ version: 2, expectedRevision: 'one', label: 'x', commands: [] }).message).toBe('Batch: version must be 1, got 2');
  expect(run({ version: 1, expectedRevision: 'one', commands: [] }).message).toBe('Batch: label is required');
  expect(run({ version: 1, expectedRevision: 'one', label: 'x' }).message).toBe('Batch: commands must be an array, got undefined');
  expect(run({ version: 1, expectedRevision: 'one', label: 'x', commands: [], comands: [] }).message).toContain('unknown field comands; closest: "commands"');
  expect(run({ version: 1, expectedRevision: 'one', label: 'x', commands: Array(10_001).fill({ op: 'name', name: 'x' }) }).message).toContain('at most 10000 commands');
  expect(run({ version: 1, expectedRevision: 'one', label: 7, commands: [] })).toMatchObject({ commandIndex: undefined, path: 'label', value: 7 });
  // ship:apply carries its file guard in the same object.
  expect(applyConstructionBatch(s, { version: 1, expectedRevision: 'one', expectedFileHash: 'abc', label: 'x', commands: [] } as ConstructionBatch)).toEqual(s);
});

test('unknown IDs name the command, the offending ID and close matches', () => {
  const s = armed();
  const error = failure(s, { op: 'name', name: 'x' }, { op: 'remove', ids: ['hull', 'gun-fwd'] });
  expect(error.message).toBe('Command 1 (remove): unknown source ID "gun-fwd"; closest: "gun-forward"');
  expect({ op: error.op, path: error.path, value: error.value }).toEqual({ op: 'remove', path: 'ids[1]', value: 'gun-fwd' });
  expect(failure(s, { op: 'equipment-patch', id: 'gun-foward', changes: {} }).message).toBe('Command 0 (equipment-patch): unknown equipment ID "gun-foward"; closest: "gun-forward"');
  expect(failure(s, { op: 'equipment-patch', id: 'hull', changes: {} }).message).toBe('Command 0 (equipment-patch): "hull" is not equipment');
  expect(failure(s, { op: 'primitive-patch', id: 'zzz', changes: {} }).message).toBe('Command 0 (primitive-patch): unknown hull piece ID "zzz"');
  expect(failure(s, { op: 'hull-sections', id: 'hull', count: 8 }).message).toBe('Command 0 (hull-sections): "hull" is a box, not a custom hull');
  expect(failure(s, { op: 'rotate', ids: ['hull', 'deck'], degrees: 5 }).message).toContain('Command 0 (rotate): "deck" is a boundary, load or custom fitting definition');
  expect(failure(s, { op: 'copy', copies: [{ from: 'hull', to: 'deck' }] }).message).toContain('Command 0 (copy): destination ID "deck" already exists');
  expect(failure(s, { op: 'surface', value: { primitiveId: 'hul', face: 'top', thicknessMm: 1, material: 'steel', paint: 'gray' } }).message).toBe('Command 0 (surface): unknown hull piece ID "hul"; closest: "hull"');
  const hull = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull');
  const stationId = hull.construction.primitives[0].customHull!.stations[2].id;
  expect(failure(hull, { op: 'hull-station', id: 'hull', stationId: stationId + 'x', changes: { t: .2 } }).message).toContain(`closest: "${stationId}"`);
  const panel = customHullPanels(hull.construction.primitives[0]).find(p => p.face === 'port')!;
  expect(failure(hull, { op: 'surface-patch', targets: [{ primitiveId: 'hull', face: 'port', panelId: panel.panelId + '0' }], changes: { paint: 'x' } }).path).toBe('targets[0].panelId');
});

test('a result the source syntax check rejects is blamed on the command that produced it; physically odd drafts pass', () => {
  const s = armed();
  const error = failure(s, { op: 'name', name: 'x' }, { op: 'primitive-patch', id: 'hull', changes: { kind: 'custom-hull' } }, { op: 'name', name: 'y' });
  expect(error.message).toBe('Command 1 (primitive-patch): result is not a valid source: Custom hull must be an object');
  expect(failure(s, { op: 'boundary', value: { id: 'hull', axis: 'y', offset: 0, thicknessMm: 5 } }).message).toContain('Command 0 (boundary): result is not a valid source: Source IDs must be unique');
  // Far outside any hull and absurdly armored: the native compiler judges that, not the command door.
  const odd = apply(s, { op: 'move', ids: ['gun-forward'], delta: [900, -900, 0] }, { op: 'skin', thicknessMm: -5 });
  expect(odd.construction.equipment[0].position).toEqual([900, -898, -5]);
});

test('rotate requires degrees while the editor helper keeps its quarter-turn default', () => {
  const s = armed();
  expect(apply(s, { op: 'rotate', ids: ['gun-forward'], degrees: 12.5 }).construction.equipment[0].bearingDeg).toBe(12.5);
  const draft = structuredClone(s);
  rotateConstructionSelection(draft, new Set(['gun-forward']));
  expect(draft.construction.equipment[0].bearingDeg).toBe(90);
});

test('turret-rise moves the gun with its rise exactly as the editor helper does; patching the field alone does not', () => {
  const s = armed();
  const risen = apply(s, { op: 'turret-rise', id: 'gun-forward', heightM: 1.5 }).construction.equipment[0];
  const expected = structuredClone(s.construction.equipment[0]);
  setBarbetteHeight(expected, 1.5);
  expect(risen).toEqual(expected);
  expect(risen).toMatchObject({ position: [0, 3.5, -5], gun: { barbetteHeightM: 1.5 } });
  const lowered = applyConstructionBatch({ ...s, construction: { ...s.construction, equipment: [risen] } }, { version: 1, expectedRevision: s.revision, label: 'Lower', commands: [{ op: 'turret-rise', id: 'gun-forward', heightM: .5 }] });
  expect(lowered.construction.equipment[0]).toMatchObject({ position: [0, 2.5, -5], gun: { barbetteHeightM: .5 } });
  expect(apply(s, { op: 'equipment-patch', id: 'gun-forward', changes: { gun: { barbetteHeightM: 1.5 } } }).construction.equipment[0].position).toEqual([0, 2, -5]);
  expect(failure(s, { op: 'turret-rise', id: 'hull', heightM: 1 }).message).toBe('Command 0 (turret-rise): "hull" is not equipment');
});

test('surface-remove restores inheritance for sides and panels, mirrored on request, and refuses absent assignments', () => {
  const s = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull');
  const panel = customHullPanels(s.construction.primitives[0]).find(p => p.face === 'port')!;
  const twin = { face: 'starboard' as const, panelId: mirroredPanelId(panel.panelId) };
  const armored = apply(s,
    { op: 'surface-patch', targets: [{ primitiveId: 'hull', face: 'top' }], changes: { paint: 'deck-gray' } },
    { op: 'surface-patch', targets: [{ primitiveId: 'hull', ...panel }], changes: { thicknessMm: 80 }, mirror: true });
  expect(armored.construction.surfaces.filter(p => p.panelId !== undefined && p.thicknessMm === 80)).toHaveLength(2);
  const one = apply(armored, { op: 'surface-remove', targets: [{ primitiveId: 'hull', ...panel }] });
  expect(one.construction.surfaces.some(p => p.panelId === panel.panelId)).toBe(false);
  expect(one.construction.surfaces.some(p => p.panelId === twin.panelId)).toBe(true);
  const both = apply(armored, { op: 'surface-remove', targets: [{ primitiveId: 'hull', ...panel }], mirror: true });
  expect(both.construction.surfaces.filter(p => p.panelId !== undefined)).toEqual(s.construction.surfaces.filter(p => p.panelId !== undefined));
  expect(both.construction.surfaces.some(p => p.face === 'top' && p.paint === 'deck-gray')).toBe(true);
  // The mirrored side may already inherit; only the named target must exist.
  expect(apply(one, { op: 'surface-remove', targets: [{ primitiveId: 'hull', ...twin }], mirror: true }).construction.surfaces).toEqual(both.construction.surfaces);
  const error = failure(both, { op: 'surface-remove', targets: [{ primitiveId: 'hull', ...panel }] });
  expect(error.message).toContain('has no assignment to remove');
  expect(error.path).toBe('targets[0]');
  expect(constructionDiffCommands(armored, both)).toEqual([{ op: 'surface-remove', targets: [{ primitiveId: 'hull', ...panel }, { primitiveId: 'hull', ...twin }] }]);
});
