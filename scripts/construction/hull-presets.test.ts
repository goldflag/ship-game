import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Hull } from '../../src/ships/blueprint';
import { DEFAULT_HULL_PRESET, HULL_PRESETS } from '../../src/ships/constructionHullPresets';
import { makeHull, invalidReason } from '../../src/ships/customHullModel';
import { deriveHullPreset } from './hull-presets';

test('the chooser provides two existing ship hulls per class and an available default', () => {
  expect(HULL_PRESETS.filter(p => p.category === 'Battleship')).toHaveLength(2);
  expect(HULL_PRESETS.filter(p => p.category === 'Cruiser')).toHaveLength(2);
  expect(HULL_PRESETS.filter(p => p.category === 'Destroyer')).toHaveLength(2);
  expect(HULL_PRESETS.some(p => p.id === DEFAULT_HULL_PRESET)).toBe(true);
});

test.each([...HULL_PRESETS])('$name retains its original ship dimensions, orientation and deck profile', async preset => {
  const blueprint = JSON.parse(await readFile(new URL(`../../assets/ships/${preset.shipId}/blueprint.json`, import.meta.url), 'utf8')) as { hull: Hull };
  const original = blueprint.hull, derived = deriveHullPreset(original);
  expect(JSON.stringify({ length: preset.length, beam: preset.beam, depth: preset.depth, customHull: preset.customHull })).toBe(JSON.stringify(derived));
  const hull = makeHull(HULL_PRESETS.indexOf(preset));
  expect(invalidReason(hull)).toBeUndefined();
  expect([hull.length, hull.beam]).toEqual([original.length, original.beam]);
  for (const section of hull.stations) {
    const source = original.sections![Number(section.id.slice('section-'.length))];
    // The section format reverses the legacy stern-to-bow coordinates. Only
    // very short end transitions move, within the editor's minimum spacing.
    expect(Math.abs((1 - section.t) * hull.length - source.station)).toBeLessThanOrEqual(.0051 * hull.length + 1e-9);
    expect(section.points[0].y * hull.depth).toBeCloseTo(source.points.at(-1)![1], 8);
    expect(section.points[8].x * hull.beam / 2).toBeCloseTo(source.points.at(-1)![0], 8);
  }
  // Editing a new design must not alter the next starter or its saved template.
  hull.stations[1].points[0].x -= .2;
  expect(makeHull(HULL_PRESETS.indexOf(preset)).stations).toEqual(preset.customHull.stations);
});
