import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleParts, decodeMesh, encodeMesh, listReferences, packReference, readReference, selectTriangles, visualGroup, writeReference, type RawPart } from './reference';
import { parseGlb, parseObj } from './referenceFile';
import { halfBreadthAt, hullStation, levelHistogram, meshView, nearestDeck, planPolygons, probeColumn, topLine, triangleCount, widthBands } from './slice';
import { loadCommand } from './command';

// Tiny synthetic fixtures only: the reference tooling is tested without touching the network or GameModels3D.
const scratch = () => mkdtemp(join(tmpdir(), 'reference-'));
const meta = (name: string) => ({
  name, kind: 'file' as const, source: 'synthetic', fetchedAt: '2026-01-01T00:00:00.000Z',
  frame: { metresPerUnit: 1, reflectedZ: false, waterlineY: 0, axes: 'test' },
});

/** A closed hull: a half-breadth section swept along z, with a flat weather deck at y = 5 and a keel at y = −5. */
const SECTION: [number, number][] = [[0, -5], [5, -5], [10, -2], [10, 1], [10, 3.5], [10, 5], [-10, 5], [-10, 3.5], [-10, 1], [-10, -2], [-5, -5]];
function hullPart(): RawPart {
  const positions: number[] = [];
  const index: number[] = [];
  const zs = Array.from({ length: 21 }, (_, i) => -50 + i * 5);
  for (const z of zs) for (const [x, y] of SECTION) positions.push(x, y, z);
  const ring = SECTION.length;
  for (let s = 0; s + 1 < zs.length; s++)
    for (let i = 0; i < ring; i++) {
      const [a, b] = [s * ring + i, s * ring + ((i + 1) % ring)];
      index.push(a, b, b + ring, a, b + ring, a + ring);
    }
  for (const cap of [0, zs.length - 1]) for (let i = 1; i + 1 < ring; i++) index.push(cap * ring, cap * ring + i, cap * ring + i + 1);
  return { key: 'hull', path: 'ship/hull', visual: 'content/ship/hull', group: 'hull', positions, index };
}
const boxPart = (key: string, group: string, min: [number, number, number], max: [number, number, number]): RawPart => {
  const positions: number[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) positions.push(x, y, z);
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const index = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { key, path: 'ship/' + key, visual: 'content/gun/artillery/' + key, group, positions, index };
};

test('a packed reference orders the hull first, round-trips through the cache and selects parts by group', async () => {
  const root = await scratch();
  const mesh = packReference({ parts: [boxPart('turret', 'gun-artillery', [-3, 5, -20], [3, 8, -12]), hullPart()], hardpoints: [], omitted: [] }, meta('fixture'));
  expect(mesh.meta.parts[0].key).toBe('hull');
  expect(mesh.meta.hullTriangles).toBe(mesh.meta.parts[0].count);
  expect(mesh.meta.bounds).toEqual({ min: [-10, -5, -50], max: [10, 8, 50] });
  const directory = await writeReference(root, mesh);
  expect(directory.endsWith(join('.build/references', 'fixture'))).toBe(true);
  const read = await readReference(root, 'fixture');
  expect(read.meta).toEqual(mesh.meta);
  expect(Array.from(read.index)).toEqual(Array.from(mesh.index));
  expect(Array.from(read.positions)).toEqual(Array.from(mesh.positions));
  expect((await listReferences(root)).map((entry) => entry.name)).toEqual(['fixture']);
  expect(selectTriangles(mesh.meta, ['hull'])).toEqual([{ first: 0, count: mesh.meta.hullTriangles }]);
  expect(() => selectTriangles(mesh.meta, ['nonexistent'])).toThrow(/No reference part matched/);
  expect(triangleCount(meshView(mesh, ['gun-artillery']))).toBe(12);
  expect(() => decodeMesh(Buffer.alloc(8))).toThrow(/Not a reference mesh file/);
  expect(decodeMesh(encodeMesh(mesh.positions, mesh.index)).index.length).toBe(mesh.index.length);
});

test('slice measures the plan, the deck levels, the silhouette, the half-breadth and a vertical probe', () => {
  const mesh = packReference({ parts: [hullPart(), boxPart('turret', 'gun-artillery', [-3, 5, -20], [3, 8, -12])], hardpoints: [], omitted: [] }, meta('fixture'));
  const view = meshView(mesh);
  const plan = planPolygons(view, 2);
  expect(plan.length).toBe(1);
  // 20 m across by 100 m long at the waterline, minus nothing: the sweep is prismatic.
  expect(plan[0].area).toBeCloseTo(2000, 0);
  expect(plan[0].bounds).toEqual({ min: [-10, -50], max: [10, 50] });
  const hullOnly = meshView(mesh, ['hull']);
  const levels = levelHistogram(hullOnly);
  const deck = levels.find((row) => Math.abs(row.y - 5) < 0.2);
  expect(deck?.areaM2).toBeCloseTo(2000, -2);
  const silhouette = topLine(view, 'z', 5);
  expect(silhouette.find((row) => row.at === -20)?.top).toBe(8);
  expect(silhouette.find((row) => row.at === 20)?.top).toBe(5);
  const bands = widthBands(hullOnly, 1);
  expect(Math.max(...bands.map((row) => row.halfBreadth))).toBe(10);
  const crossings = probeColumn(view, 0, -16);
  expect(crossings[0].y).toBe(8);
  expect(nearestDeck(crossings, 6)).toMatchObject({ below: 5, above: 8, nearest: 5 });
  expect(nearestDeck(crossings, 7)).toMatchObject({ below: 5, above: 8, nearest: 8 });
  expect(nearestDeck(crossings, 20).above).toBeUndefined();
});

test('a hull station reads the deck line, the half outline and the section area', () => {
  const mesh = packReference({ parts: [hullPart()], hardpoints: [], omitted: [] }, meta('fixture'));
  const station = hullStation(meshView(mesh), 0);
  expect(station).toBeDefined();
  expect(station!.deckY).toBe(5);
  expect(station!.keelY).toBe(-5);
  expect(station!.halfBreadth).toBe(10);
  expect(station!.half[0][0]).toBeGreaterThan(0);
  expect(station!.half.every(([x]) => x >= 0)).toBe(true);
  expect(halfBreadthAt(station!.half, 5)).toBeCloseTo(10, 3);
  expect(halfBreadthAt(station!.half, -5)).toBeCloseTo(5, 3);
  expect(station!.areaM2).toBeGreaterThan(150);
  expect(hullStation(meshView(mesh), 200)).toBeUndefined();
});

test('local OBJ and GLB references parse, scale and reflect into the ship frame', () => {
  const obj = 'o box\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n';
  const plain = parseObj(obj);
  expect(plain.length).toBe(1);
  expect(plain[0].index.length).toBe(6);
  expect(plain[0].positions.slice(3, 6)).toEqual([1, 0, 0]);
  const scaled = parseObj('o box\nv 0 0 2\nv 1 0 2\nv 1 1 2\nf 1 2 3\n', { scale: 3, flipZ: true });
  expect(scaled[0].positions.slice(0, 3)).toEqual([0, 0, -6]);
  expect(scaled[0].index).toEqual([0, 2, 1]);
  expect(() => parseObj('v 0 0 0\n')).toThrow(/no triangle geometry/);
  expect(() => parseObj('o a\nv 0 0 0\nf 1 2 3\n')).toThrow(/Invalid OBJ face index/);
  const parsed = parseGlb(triangleGlb());
  expect(parsed.length).toBe(1);
  expect(parsed[0].key).toBe('wing');
  // The node translates by (0, 2, 0), so the first corner lands there.
  expect(parsed[0].positions.slice(0, 3)).toEqual([0, 2, 0]);
  expect(parsed[0].index).toEqual([0, 1, 2]);
  expect(() => parseGlb(Buffer.alloc(24))).toThrow(/Not a binary glTF/);
});

test('ship:slice and ship:hardpoints read the cache and reject a bad measurement', async () => {
  const root = await scratch();
  await mkdir(join(root, '.build/references'), { recursive: true });
  const hardpoints = [
    { id: 'HP_Gun_1', path: 'HP_Gun_1', visual: 'content/gun/artillery/main', position: [0, 6, -16] as [number, number, number], bearingDeg: 0, matrix: [] as number[] },
    { id: 'HP_Barrel', path: 'HP_Gun_1/HP_Barrel', nested: true as const, position: [0, 7, -18] as [number, number, number], bearingDeg: 0, matrix: [] as number[] },
  ];
  await writeReference(root, packReference({ parts: [hullPart(), boxPart('turret', 'gun-artillery', [-3, 5, -20], [3, 8, -12])], hardpoints, omitted: [] }, meta('fixture')));
  const slice = (await loadCommand('slice'))!;
  const context = (positionals: string[], flags: Record<string, string | true>) => ({
    root, id: '', positionals, option: (flag: string) => (typeof flags[flag] === 'string' ? (flags[flag] as string) : undefined), has: (flag: string) => flags[flag] === true, print: () => {},
  });
  const levels = (await slice.run(context(['fixture'], { '--levels': true, '--parts': 'hull' }))) as { measurement: string; strongest: number[] };
  expect(levels.measurement).toBe('deck-levels');
  expect(levels.strongest).toContain(5.05);
  const station = (await slice.run(context(['fixture'], { '--station': '0' }))) as { stations: { deckY: number }[] };
  expect(station.stations[0].deckY).toBe(5);
  await expect(slice.run(context(['fixture'], {}))).rejects.toThrow(/exactly one measurement/);
  await expect(slice.run(context(['fixture'], { '--plan': '0', '--levels': true }))).rejects.toThrow(/exactly one measurement/);
  await expect(slice.run(context(['missing'], { '--plan': '0' }))).rejects.toThrow(/No cached reference/);
  const list = (await (await loadCommand('reference'))!.run(context([], { '--list': true }))) as { references: { name: string }[] };
  expect(list.references.map((entry) => entry.name)).toEqual(['fixture']);
  const points = (await (await loadCommand('hardpoints'))!.run(context(['fixture'], {}))) as { matched: number; hardpoints: { id: string; deckY: number | null }[] };
  expect(points.matched).toBe(1);
  expect(points.hardpoints[0]).toMatchObject({ id: 'HP_Gun_1', deckY: 5 });
  const nested = (await (await loadCommand('hardpoints'))!.run(context(['fixture'], { '--nested': true }))) as { matched: number };
  expect(nested.matched).toBe(2);
});

test('assembleParts places a composed node tree into the ship frame and marks nested hardpoints', () => {
  const geometry = { main: { position: [0, 0, 0, 1, 0, 0, 0, 1, 0], index: [0, 1, 2] } };
  const scheme = {
    nodes: {
      HP_Turret: {
        visual: 'content/gun/artillery/main',
        transform: { matrix: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 1, 2, 1]] },
        nodes: { HP_Barrel: { transform: { matrix: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 1, 1]] } } },
      },
    },
  } as never;
  const assembled = assembleParts(scheme, { 'content/gun/artillery/main': { geometry } } as never, 2);
  expect(assembled.parts.length).toBe(1);
  // (0, 1, 2) source units at 2 m per unit, with +Z reflected to −Z.
  expect(assembled.parts[0].positions.slice(0, 3)).toEqual([0, 2, -4]);
  expect(assembled.hardpoints.map((point) => point.position)).toEqual([[0, 2, -4], [0, 2, -6]]);
  expect(assembled.hardpoints[0].nested).toBeUndefined();
  expect(assembled.hardpoints[1].nested).toBe(true);
  expect(visualGroup('content/gun/artillery/main')).toBe('gun-artillery');
  expect(visualGroup('content/ship/hull')).toBe('hull');
});

/** A one-triangle glTF 2.0 binary, written by hand so the reader is tested without a fixture file. */
function triangleGlb(): Buffer {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const indices = Buffer.from(new Uint16Array([0, 1, 2, 0]).buffer);
  const binary = Buffer.concat([positions, indices]);
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [{ name: 'wing', mesh: 0, translation: [0, 2, 0] }],
      meshes: [{ name: 'wing', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: 6 }],
      buffers: [{ byteLength: binary.length }],
    }),
  );
  const pad = (data: Buffer, fill: number) => (data.length % 4 ? Buffer.concat([data, Buffer.alloc(4 - (data.length % 4), fill)]) : data);
  const jsonChunk = pad(json, 0x20);
  const binChunk = pad(binary, 0);
  const chunk = (data: Buffer, kind: number) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(kind, 4);
    return Buffer.concat([head, data]);
  };
  const body = Buffer.concat([chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

test('writeFile fixtures never leak outside the ignored build directory', async () => {
  const root = await scratch();
  await writeFile(join(root, 'marker'), 'x');
  await writeReference(root, packReference({ parts: [hullPart()], hardpoints: [], omitted: [] }, meta('guard')));
  expect((await listReferences(root)).length).toBe(1);
});
