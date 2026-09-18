import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Hull } from '../../src/ships/blueprint';
import { DEFAULT_HULL_PRESET, HULL_PRESETS } from '../../src/ships/constructionHullPresets';
import { makeHull, invalidReason } from '../../src/ships/customHullModel';
import { deriveHullPreset, PRESET_OPTIONS } from './hull-presets';

test('the chooser provides two existing ship hulls per class and an available default', () => {
  expect(HULL_PRESETS.filter(p => p.category === 'Battleship')).toHaveLength(2);
  expect(HULL_PRESETS.filter(p => p.category === 'Cruiser')).toHaveLength(2);
  expect(HULL_PRESETS.filter(p => p.category === 'Destroyer')).toHaveLength(2);
  expect(HULL_PRESETS.filter(p => p.category === 'Generic').map(p => p.id)).toEqual(['patrol-hull', 'destroyer-hull', 'battleship-hull', 'barge-hull']);
  expect(HULL_PRESETS.some(p => p.id === DEFAULT_HULL_PRESET)).toBe(true);
});

test.each(HULL_PRESETS.filter(p => p.shipId !== null))('$name retains its original ship dimensions, orientation and deck profile', async preset => {
  const blueprint = JSON.parse(await readFile(new URL(`../../assets/ships/${preset.shipId}/blueprint.json`, import.meta.url), 'utf8')) as { hull: Hull };
  const original = blueprint.hull, derived = deriveHullPreset(original, PRESET_OPTIONS[preset.shipId]);
  expect(JSON.stringify({ length: preset.length, beam: preset.beam, depth: preset.depth, customHull: preset.customHull })).toBe(JSON.stringify(derived));
  const hull = makeHull(HULL_PRESETS.indexOf(preset));
  expect(invalidReason(hull)).toBeUndefined();
  expect([hull.length, hull.beam]).toEqual([original.length, original.beam]);
  for (const section of hull.stations) {
    const source = original.sections![Number(section.id.slice('section-'.length))];
    // The section format reverses the legacy stern-to-bow coordinates.
    expect((1 - section.t) * hull.length).toBeCloseTo(source.station, 8);
    expect(section.points[0].y * hull.depth).toBeCloseTo(source.points.at(-1)![1], 8);
    if ((section.t > 0 && section.t < 1) || !PRESET_OPTIONS[preset.shipId]?.bluntEnds) {
      expect(section.points[8].x * hull.beam / 2).toBeCloseTo(source.points.at(-1)![0], 8);
    }
  }
});

test.each([...HULL_PRESETS])('$name has well-separated, independently editable sections', preset => {
  const hull = makeHull(HULL_PRESETS.indexOf(preset));
  expect(invalidReason(hull)).toBeUndefined();
  expect(hull.stations.length).toBeLessThanOrEqual(16);
  for (let i = 1; i < hull.stations.length; i++) {
    expect(hull.stations[i].t - hull.stations[i - 1].t).toBeGreaterThanOrEqual(.04 - 1e-9);
  }
  // Editing a new design must not alter the next starter or its saved template.
  hull.stations[1].points[0].x -= .2;
  expect(makeHull(HULL_PRESETS.indexOf(preset)).stations).toEqual(preset.customHull.stations);
});

test.each(HULL_PRESETS.filter(p => p.category === 'Battleship'))('$name has broad end caps instead of needle tips', preset => {
  for (const section of [preset.customHull.stations[0], preset.customHull.stations.at(-1)!]) {
    expect((section.points.at(-1)!.x - section.points[0].x) * preset.beam / 2).toBeGreaterThan(2);
    expect((section.points[0].y - section.points[4].y) * preset.depth).toBeGreaterThan(2.5);
  }
});
