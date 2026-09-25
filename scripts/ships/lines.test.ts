import { expect, test } from 'bun:test';
import { DEFAULT_RULE, HullSlicer, compareSections, controlStations, findBreaks, levelHeights, linesFile, longestRun, measureLines, measureStation, parseLinesArgs, readSections, widthAt } from './lines';

type P = [number, number];
/** A hard-chine section: flat bottom at y = -4 out to x = 4, a 45-degree bilge to x = 5 at y = -3, a wall to the
 * deck at y = 3, and deck plating split at the centreline as source meshes split it. */
const section = (): [P, P][] => {
  const half: [P, P][] = [[[0, -4], [4, -4]], [[4, -4], [5, -3]], [[5, -3], [5, 3]], [[5, 3], [0, 3]]];
  return [...half, ...half.map(([a, b]): [P, P] => [[-a[0], a[1]], [-b[0], b[1]]])];
};

test('a station follows the shell from the keel to the deck', () => {
  const station = measureStation(section(), 0)!;
  expect(station.deck).toBeCloseTo(3, 6);
  expect(station.keel).toBeCloseTo(-4, 6);
  const points = [...station.points].sort((a, b) => a[0] - b[0]);
  expect(widthAt(points, 0)).toBeCloseTo(5, 6);
  expect(widthAt(points, -3.5)).toBeCloseTo(4.5, 2);
});

test('the walk does not follow a thin bilge keel off the shell', () => {
  // A bilge keel leaving the bilge at y = -3.5 and running out and down to (4.9, -3.9).
  const fin: [P, P][] = [[[4.5, -3.5], [4.9, -3.9]], [[4.9, -3.9], [4.45, -3.55]]];
  const station = measureStation([...section(), ...fin], 0)!;
  const points = [...station.points].sort((a, b) => a[0] - b[0]);
  expect(widthAt(points, -3.8)).toBeCloseTo(4.2, 1);
});

test('levels run from the keel to H0 and on to the deck, and rise with the keel at the ends', () => {
  const mid = levelHeights(-8, 6, DEFAULT_RULE);
  expect(mid.length).toBe(DEFAULT_RULE.LOW.length + DEFAULT_RULE.HIGH.length);
  expect(mid[0]).toBe(-8);
  expect(mid[DEFAULT_RULE.LOW.length - 1]).toBeCloseTo(DEFAULT_RULE.H0, 9);
  expect(mid.at(-1)).toBe(6);
  // Near the stem the keel is above H0 - endMargin, so H0 moves to three quarters of the depth.
  const end = levelHeights(4, 8, DEFAULT_RULE);
  expect(end[DEFAULT_RULE.LOW.length - 1]).toBeCloseTo(7, 9);
});

test('control stations crowd the ends and bracket each break', () => {
  const zs = controlStations(-100, 100, [20]);
  expect(zs[0]).toBe(-99.75);
  expect(zs[1] - zs[0]).toBe(0.5);
  expect(zs).toContain(19.85);
  expect(zs).toContain(20.15);
  const middle = zs.filter((z) => z > -50 && z < 0);
  expect(middle[1] - middle[0]).toBe(2);
});

test('a deck break is found where the median steps, not at a short misread run', () => {
  const stations = Array.from({ length: 80 }, (_, i) => ({ z: i * 0.5, deck: i < 40 ? 6 : 3 }));
  for (let i = 10; i < 14; i++) stations[i].deck = 9; // four misread stations
  const breaks = findBreaks(stations);
  expect(breaks).toEqual([19.75]);
  // Ten stations (5 m) misread high step up and back down: a bump, not two breaks.
  const bump = Array.from({ length: 80 }, (_, i) => ({ z: i * 0.5, deck: i >= 30 && i < 40 ? 9 : 6 }));
  expect(findBreaks(bump)).toEqual([]);
});

test('the hull span keeps the longest run of measurable stations', () => {
  expect(longestRun([0, 0.5, 1, 1.5, 4, 4.5], 1.5)).toEqual([0, 3]);
  expect(longestRun([0, 3, 3.5, 4, 4.5], 1.5)).toEqual([1, 4]);
});

/** Two boxes: a forecastle (deck 5) forward of z = 0 and a quarterdeck (deck 3) abaft it, 10 m wide, keel at -4. */
function boxes() {
  const positions: number[] = [], index: number[] = [];
  const box = (x: number, y0: number, y1: number, z0: number, z1: number) => {
    const base = positions.length / 3;
    for (const [a, b, c] of [[-x, y0, z0], [x, y0, z0], [x, y1, z0], [-x, y1, z0], [-x, y0, z1], [x, y0, z1], [x, y1, z1], [-x, y1, z1]]) positions.push(a, b, c);
    for (const f of [[0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1], [3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2]]) index.push(...f.map((v) => v + base));
  };
  box(5, -4, 5, -50, 0);
  box(5, -4, 3, 0, 50);
  return new HullSlicer(Float32Array.from(positions), Uint32Array.from(index), [{ first: 0, count: index.length / 3 }]);
}

test('lines of a stepped box: one break, both decks, full breadth, centred frame', () => {
  const lines = measureLines(boxes());
  expect(lines.breaks.length).toBe(1);
  expect(Math.abs(lines.breaks[0])).toBeLessThan(0.3);
  expect(lines.zShift).toBeCloseTo(0, 6);
  const at = (z: number) => lines.rows.reduce((best, row) => (Math.abs(row.z - z) < Math.abs(best.z - z) ? row : best));
  expect(at(-30).deck).toBeCloseTo(5, 6);
  expect(at(30).deck).toBeCloseTo(3, 6);
  expect(at(30).keel).toBeCloseTo(-4, 6);
  expect(at(-30).widths[0]).toBe(0);
  expect(at(-30).widths[5]).toBeCloseTo(5, 6);
});

test('both formats read back to the same sections and compare clean against their own measurement', () => {
  const lines = measureLines(boxes());
  for (const format of ['offsets', 'sections'] as const) {
    const file = linesFile(lines, format, DEFAULT_RULE, 'test');
    const sections = readSections(JSON.parse(JSON.stringify(file)), DEFAULT_RULE);
    expect(sections.length).toBe(lines.rows.length);
    const byZ = new Map(sections.map((s) => [Math.round(s.z * 1000), s]));
    const comparison = compareSections(sections, (z) => byZ.get(Math.round(z * 1000)));
    expect(comparison.halfBreadth.max).toBe(0);
    expect(comparison.deck.max).toBe(0);
  }
  const sectionsFile = linesFile(lines, 'sections', DEFAULT_RULE, 'test') as { sections: { station: number }[]; length: number };
  expect(sectionsFile.sections[0].station).toBeGreaterThanOrEqual(0);
  expect(sectionsFile.sections.at(-1)!.station).toBeLessThanOrEqual(sectionsFile.length);
});

test('arguments', () => {
  expect(parseLinesArgs(['hood'])).toMatchObject({ id: 'hood', parts: ['hull'], replace: false, rule: {} });
  expect(parseLinesArgs(['hood', '--ref', 'pbsb507', '--h0', '1.8', '--format', 'offsets', '--replace'])).toMatchObject({ reference: 'pbsb507', rule: { H0: 1.8 }, format: 'offsets', replace: true });
  expect(() => parseLinesArgs(['hood', '--format', 'csv'])).toThrow('--format');
  expect(() => parseLinesArgs(['hood', '--span', '1'])).toThrow('--span');
  expect(() => parseLinesArgs(['hood', '--station', '1'])).toThrow('Unknown flag');
});
