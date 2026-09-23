import { expect, test } from 'bun:test';
import { DataUtils } from 'three/webgpu';
import { SKY_TIERS } from '../quality';
import { blackbodyColor, colorTemperature, COLOR_INDEX_RANGE, EMPTY_MAGNITUDE, gridCell, LIMITING_MAGNITUDE, MAX_STARS, STAR_GRID, starCatalog,
  starTexels, slotTexel } from './stars';

const stars = starCatalog();
const fainterThan = (magnitude: number) => stars.filter(star => star.magnitude < magnitude).length;

test('the catalog is seeded: the same stars every time, others for another seed', () => {
  expect(stars).toHaveLength(MAX_STARS);
  expect(starCatalog()).toEqual(stars);
  expect(starCatalog(7).slice(0, 20)).not.toEqual(stars.slice(0, 20));
  for (const tier of Object.values(SKY_TIERS)) expect(tier.stars).toBeLessThanOrEqual(MAX_STARS);
});

test('cumulative counts rise about threefold per magnitude to the naked-eye limit, brightest first', () => {
  for (let magnitude = 2.5; magnitude <= LIMITING_MAGNITUDE; magnitude++) {
    expect(fainterThan(magnitude) / fainterThan(magnitude - 1)).toBeGreaterThan(2.7);
    expect(fainterThan(magnitude) / fainterThan(magnitude - 1)).toBeLessThan(3.3);
  }
  expect(fainterThan(LIMITING_MAGNITUDE + 1e-9)).toBe(MAX_STARS);
  expect(fainterThan(1)).toBeGreaterThan(10);
  expect(fainterThan(1)).toBeLessThan(35);
  for (let i = 1; i < stars.length; i++) expect(stars[i].magnitude).toBeGreaterThanOrEqual(stars[i - 1].magnitude);
});

test('each tier draws exactly its brightest stars', () => {
  for (const { stars: count } of Object.values(SKY_TIERS)) {
    const data = starTexels(stars, count);
    const drawn: number[] = [];
    for (let texel = 0; texel < data.length; texel += 4) {
      const magnitude = DataUtils.fromHalfFloat(data[texel + 2]);
      if (magnitude < EMPTY_MAGNITUDE) drawn.push(magnitude);
    }
    expect(drawn).toHaveLength(count);
    expect(Math.max(...drawn)).toBeCloseTo(stars[count - 1].magnitude, 2);
  }
});

test('colours: B−V within range, most stars between 5,000 and 7,000 K, blackbody tints from blue-white to orange', () => {
  const temperatures = stars.map(star => colorTemperature(star.colorIndex));
  expect(Math.min(...stars.map(star => star.colorIndex))).toBeGreaterThanOrEqual(COLOR_INDEX_RANGE[0]);
  expect(Math.max(...stars.map(star => star.colorIndex))).toBeLessThanOrEqual(COLOR_INDEX_RANGE[1]);
  expect(temperatures.filter(t => t >= 5000 && t <= 7000).length / stars.length).toBeGreaterThan(.5);
  expect(colorTemperature(.65)).toBeCloseTo(5780, -2);
  const hot = blackbodyColor(colorTemperature(-.3)), cool = blackbodyColor(colorTemperature(2)), white = blackbodyColor(6504);
  expect(hot[2]).toBeGreaterThan(hot[0]);
  expect(cool[0]).toBeGreaterThan(2 * cool[2]);
  for (const channel of white) expect(Math.abs(channel - 1)).toBeLessThan(.06);
  for (const rgb of [hot, cool, white]) expect(.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]).toBeCloseTo(1, 6);
});

test('faint stars crowd toward the galactic plane', () => {
  const band = Math.sin(10 * Math.PI / 180);
  const faint = stars.filter(star => star.magnitude > 5);
  expect(faint.filter(star => Math.abs(star.z) < band).length / faint.length).toBeGreaterThan(1.5 * band);
  const bright = stars.slice(0, 60);
  expect(bright.filter(star => Math.abs(star.z) < band).length / bright.length).toBeLessThan(2.5 * band);
});

test('every star sits alone in a grid cell the dome reads, clear of its edges', () => {
  const texels = new Set<number>();
  for (const star of stars) {
    expect(Math.hypot(star.x, star.y, star.z)).toBeCloseTo(1, 12);
    const cell = gridCell(star.slot.grid, star.x, star.y, star.z);
    expect(cell).toMatchObject(star.slot);
    expect(cell.clearance).toBeGreaterThanOrEqual(STAR_GRID.margin);
    texels.add(slotTexel(star.slot));
  }
  expect(texels.size).toBe(stars.length);
  const data = starTexels(stars, MAX_STARS), star = stars[1234], texel = slotTexel(star.slot) * 4;
  expect(DataUtils.fromHalfFloat(data[texel])).toBeCloseTo(star.slot.a, 3);
  expect(DataUtils.fromHalfFloat(data[texel + 1])).toBeCloseTo(star.slot.b, 3);
  expect(DataUtils.fromHalfFloat(data[texel + 2])).toBeCloseTo(star.magnitude, 2);
});
