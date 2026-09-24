import { expect, test } from 'bun:test';
import { CHART_LEVELS_M, chartContours } from './chartContours';
import { Heightfield } from './heightfield';
import { installMapTerrain } from './testing';

/** Every closed loop of a path as [x, z] vertices in chart metres. */
function loops(path: string): [number, number][][] {
  return path.split('M').filter(Boolean).map(part => {
    const numbers = part.replace('z', '').split(/l|\s+/).filter(Boolean).map(Number);
    const points: [number, number][] = [[numbers[0], numbers[1]]];
    for (let k = 2; k < numbers.length; k += 2) points.push([points.at(-1)![0] + numbers[k], points.at(-1)![1] + numbers[k + 1]]);
    return points;
  });
}
const area = (loop: [number, number][]) => Math.abs(loop.reduce((sum, [x, z], k) => sum + x * loop[(k + 1) % loop.length][1] - loop[(k + 1) % loop.length][0] * z, 0)) / 2;

/** A 700 m cone standing in 40 m of water at chart (2000, −1000), with a 150 m islet to its east. */
function coneField(): Heightfield {
  const columns = 201, rows = 201, cell = 40, origin = -4000, quanta = new Int16Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const x = origin + i * cell, z = origin + j * cell;
    const cone = 700 - Math.hypot(x - 2000, z + 1000) * .5, islet = 150 - Math.hypot(x + 2500, z - 2000) * .6;
    quanta[j * columns + i] = Math.round(Math.max(-40, cone, islet) / .25);
  }
  return new Heightfield(columns, rows, cell, origin, origin, .25, quanta);
}

test('the coast and each band trace closed loops around the land they enclose', () => {
  const contours = chartContours(coneField());
  // No land reaches 1,000 m, so that band is not drawn; the rest are, lowest first.
  expect(contours.map(contour => contour.level)).toEqual([0, 100, 300, 600]);
  const [coast, hundred, , summit] = contours.map(contour => loops(contour.path));
  expect(coast).toHaveLength(2);
  expect(hundred).toHaveLength(2);
  expect(summit).toHaveLength(1);
  // The cone's shoreline is a circle of 1,400 m radius about its peak; the islet's, 250 m.
  const cone = coast.find(loop => loop.every(([x]) => x > 0))!;
  for (const [x, z] of cone) expect(Math.abs(Math.hypot(x - 2000, z + 1000) - 1400)).toBeLessThan(45);
  expect(area(cone) / (Math.PI * 1400 ** 2)).toBeCloseTo(1, 1);
  const islet = coast.find(loop => loop !== cone)!;
  for (const [x, z] of islet) expect(Math.abs(Math.hypot(x + 2500, z - 2000) - 250)).toBeLessThan(45);
  // Higher bands nest inside lower ones: 600 m is the 200 m circle at the summit.
  for (const [x, z] of summit[0]) expect(Math.abs(Math.hypot(x - 2000, z + 1000) - 200)).toBeLessThan(45);
});

test('open water charts nothing, and a field is traced once', () => {
  const sea = new Heightfield(3, 3, 40, 0, 0, .25, new Int16Array(9).fill(-40));
  expect(chartContours(sea)).toEqual([]);
  const field = coneField();
  expect(chartContours(field)).toBe(chartContours(field));
});

test('a real chart\'s coastline runs where the surveyed land meets the sea', async () => {
  const field = await installMapTerrain('vestfjord');
  const contours = chartContours(field);
  expect(contours.map(contour => contour.level)).toEqual([...CHART_LEVELS_M]);
  const coast = loops(contours[0].path);
  expect(coast.length).toBeGreaterThan(50);
  // Every vertex has a land sample and a sea sample of the full-resolution survey within 100 m.
  const seaWithin = (x: number, z: number, radius: number) => {
    for (let j = Math.floor((z - radius - field.originZ) / field.cell); j <= Math.ceil((z + radius - field.originZ) / field.cell); j++)
      for (let i = Math.floor((x - radius - field.originX) / field.cell); i <= Math.ceil((x + radius - field.originX) / field.cell); i++)
        if (Math.hypot(field.originX + i * field.cell - x, field.originZ + j * field.cell - z) <= radius && !field.sampleIsLand(i, j)) return true;
    return false;
  };
  let checked = 0;
  for (const loop of coast) for (const [x, z] of loop.filter((_, k) => k % 7 === 0)) {
    expect(field.landWithin(x, z, 100)).toBe(true);
    expect(seaWithin(x, z, 100)).toBe(true);
    checked++;
  }
  expect(checked).toBeGreaterThan(500);
});
