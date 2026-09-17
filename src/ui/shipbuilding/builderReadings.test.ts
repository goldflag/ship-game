import { expect, test } from 'bun:test';
import type { ConstructionResult, ConstructionSource, ConstructionSurface } from '../../ships/blueprint';
import { attitudeRows, hullBounds, ledgerRows, massGroups, pieceMassKg, warningEntries } from './builderReadings';

const surface = (id: string, primitiveId: string, material: string, areaM2: number, thicknessMm: number): ConstructionSurface =>
  ({ id, primitiveId, face: 'port', vertices: [], normal: [-1, 0, 0], areaM2, thicknessMm, material, paint: 'naval-gray', open: false });
const source = { construction: { primitives: [{ id: 'hull', kind: 'box', size: [8, 5, 48], position: [0, 0, 0], rotationDeg: 0 }, { id: 'deck', kind: 'box', size: [4, 1, 10], position: [0, 3, 0], rotationDeg: 90 }],
  surfaces: [], equipment: [], boundaries: [{ id: 'w', axis: 'z', offset: 0, thicknessMm: 8 }], loads: [] } } as unknown as ConstructionSource;
const result = {
  surfaces: [surface('hull:port', 'hull', 'armor-steel', 100, 50), surface('deck:port', 'deck', 'steel', 20, 0)],
  diagnostics: [{ severity: 'warning', code: 'unstable', message: 'GM low' }, { severity: 'error', code: 'equipment-fit', message: 'Gun overlaps', sourceId: 'gun' }, { severity: 'warning', code: 'auxiliary-services', message: 'Services note' }],
  loading: { massKg: 2_310_000, waterlineY: -1.2, rollMetacentricHeightM: 1.12, powerKw: 3000, estimatedSpeedMps: 10, usableVolumeM3: 900, centerOfGravity: [0, 0.4, 1.2],
    contributions: [{ id: 'skin-hull:port-0', kind: 'skin', massKg: 40000 }, { id: 'skin-deck:port-1', kind: 'skin', massKg: 5000 }, { id: 'w', kind: 'bulkhead', massKg: 1000 }, { id: 'engine', kind: 'equipment', massKg: 35000 }, { id: 'engine-service', kind: 'service', massKg: 500 }] },
  definition: { hull: { waterplaneAreaM2: 400 }, compartments: [{}, {}], mounts: [{}], torpedoTubes: [] },
} as unknown as ConstructionResult;

test('hull bounds include rotated pieces', () => {
  expect(hullBounds(source)).toEqual({ min: [-5, -2.5, -24], max: [5, 3.5, 24] });
});

test('ledger rows read draft from the keel, tone warned readings and add a layer row', () => {
  const rows = ledgerRows(source, result, 'armor');
  expect(rows.slice(0, 3)).toEqual([{ label: 'Length', value: '48 m', tone: undefined }, { label: 'Beam', value: '10 m', tone: undefined }, { label: 'Height', value: '6 m', tone: undefined }]);
  expect(rows.find(row => row.label === 'Draft')?.value).toBe('1.3 m');
  expect(rows.find(row => row.label === 'GM')).toEqual({ label: 'GM', value: '1.12 m', tone: 'warn' });
  expect(rows.find(row => row.label === 'Speed')?.value).toBe('19.4 kn');
  expect(rows.at(-1)).toEqual({ label: 'Coverage', value: '83 % of 120 m²', tone: undefined });
  expect(ledgerRows(source, result, 'internals').at(-1)?.value).toBe('2 · 1 walls');
  expect(ledgerRows(source, undefined, 'hull').at(-1)).toEqual({ label: 'Hull pieces', value: '2 / 10,000', tone: undefined });
  expect(ledgerRows(source, undefined, 'hull').slice(0, 3).map(row => row.value)).toEqual(['48 m', '10 m', '6 m']);
});

test('list and trim name the low side from the offset between gravity and buoyancy', () => {
  const afloat = (centerOfGravity: number[], rollMetacentricHeightM = 1) => ({ loading: { massKg: 1_025_000, centerOfGravity, buoyancyCenter: [0, -1, 0], rollMetacentricHeightM },
    definition: { hull: { waterplaneAreaM2: 400 } } }) as unknown as ConstructionResult;
  expect(attitudeRows(afloat([0, 0, 0]), 50)).toEqual([{ label: 'List', value: 'Level' }, { label: 'Trim', value: 'Level' }]);
  // Pitch GM ≈ 0.075 · 400 · 50² / 1000 − 1 = 74 m.
  expect(attitudeRows(afloat([.1, 0, -2]), 50)).toEqual([{ label: 'List', value: '5.7° to starboard', tone: 'warn' }, { label: 'Trim', value: '≈ 1.5° by the bow', tone: undefined }]);
  expect(attitudeRows(afloat([-.01, 0, 1]), 50).map(row => row.value)).toEqual(['0.57° to port', '≈ 0.77° by the stern']);
  expect(attitudeRows(afloat([.1, 0, 0], -.5), 50)[0]).toEqual({ label: 'List', value: 'Goes over to starboard', tone: 'bad' });
  expect(attitudeRows(undefined, 50).map(row => row.value)).toEqual(['—', '—']);
});

test('mass groups split armor skin from structural skin and warnings keep blocks apart from notes', () => {
  const groups = massGroups(result);
  expect(groups.map(group => group.massKg)).toEqual([5000, 40000, 1000, 35000, 500, 0]);
  expect(pieceMassKg(result, 'hull')).toBe(40000);
  expect(pieceMassKg(result, 'missing')).toBeUndefined();
  expect(warningEntries(result.diagnostics).map(entry => entry.tone)).toEqual(['block', 'warn', 'note']);
});

test('approximate internal weight is visible separately from fitted machinery and stores', () => {
  const loaded = structuredClone(result);
  loaded.loading!.contributions.push({ id: 'hull-internal-allowance', kind: 'internal-allowance', massKg: 120_000, center: [0, -1, 0], inertiaKgM2: [1, 1, 1] });
  const groups = massGroups(loaded);
  expect(groups.find(group => group.name === 'Internal allowance')?.massKg).toBe(120_000);
  expect(groups.find(group => group.name === 'Machinery & fittings')?.massKg).toBe(35_000);
  expect(groups.reduce((sum, group) => sum + group.massKg, 0)).toBe(201_500);
});
