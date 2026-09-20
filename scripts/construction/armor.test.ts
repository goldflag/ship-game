import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { applyConstructionBatch } from '../../src/ships/constructionCommands';
import { customHullPanels } from '../../src/ships/constructionPanels';
import { applyArmorRules, parseArmorRules, primitiveTargets } from './armor';
import { guardedBatch } from './transaction';

const root = resolve(import.meta.dir, '../..');
const catalog = parseConstructionCatalog(JSON.parse(readFileSync(join(root, 'public/models/components/catalog.json'), 'utf8')));
const design = () => createStarterSource(catalog, 'fletcher-hull');

test('a scheme is checked whole before anything is generated', () => {
  expect(() => parseArmorRules([])).toThrow('empty');
  expect(() => parseArmorRules({})).toThrow('array of rules');
  expect(() => parseArmorRules([{ changes: {} }])).toThrow('changes` is empty');
  expect(() => parseArmorRules([{ changes: { thicknessMm: 100 }, belt: true }])).toThrow('unknown field belt');
  expect(() => parseArmorRules([{ changes: { thicknessMm: -1 } }])).toThrow('non-negative');
  expect(() => parseArmorRules([{ changes: { material: 'wood' } }])).toThrow('steel or armor-steel');
  expect(() => parseArmorRules([{ changes: { thicknessMm: 1 }, faces: ['deck'] }])).toThrow('unknown face deck');
  expect(() => parseArmorRules([{ changes: { thicknessMm: 1 }, z: [0] }])).toThrow('[min, max]');
  expect(parseArmorRules({ rules: [{ changes: { open: true }, z: [-10, null] }] })[0].z).toEqual([-10, null]);
});

test('the targets carry the same panel IDs the editor assigns', () => {
  const hull = design().construction.primitives[0];
  const targets = primitiveTargets(hull);
  expect(targets.map((target) => [target.face, target.panelId])).toEqual(
    customHullPanels(hull).map((panel) => [panel.face, panel.panelId]),
  );
  // Every strip has a real extent, ordered low to high.
  for (const target of targets) {
    expect(target.z[1]).toBeGreaterThanOrEqual(target.z[0]);
    expect(target.y[1]).toBeGreaterThanOrEqual(target.y[0]);
  }
});

test('a z window selects a belt, faces narrow it, and the report names what a rule missed', () => {
  const source = design();
  const hull = source.construction.primitives[0];
  const [, , length] = hull.size;
  const midships: [number, number] = [hull.position[2] - length / 4, hull.position[2] + length / 4];
  const { reports, commands } = applyArmorRules(
    source,
    parseArmorRules([
      { name: 'belt', faces: ['port', 'starboard'], z: midships, changes: { thicknessMm: 127, material: 'armor-steel' } },
      { name: 'nothing', panels: ['not-a-panel'], changes: { thicknessMm: 10 } },
    ]),
  );
  expect(reports[0].targets.length).toBeGreaterThan(0);
  // The belt stays inside its window and touches only the two sides it named.
  for (const target of reports[0].targets) {
    expect(['port', 'starboard']).toContain(target.face);
    expect(target.z[0]).toBeGreaterThanOrEqual(midships[0] - 1e-6);
    expect(target.z[1]).toBeLessThanOrEqual(midships[1] + 1e-6);
  }
  expect(reports[0].targets.length).toBeLessThan(primitiveTargets(hull).length);
  expect(reports[1].targets).toEqual([]);
  expect(reports[1].unmatched).toEqual(['panel not-a-panel']);
  // One command per rule that matched something, mirrored by default.
  expect(commands).toHaveLength(1);
  expect(commands[0].op === 'surface-patch' && commands[0].mirror).toBe(true);
});

test('rules read in order and the whole scheme applies as one batch', () => {
  const source = design();
  const { commands } = applyArmorRules(
    source,
    parseArmorRules([
      { name: 'shell', faces: ['port', 'starboard'], changes: { thicknessMm: 20 } },
      { name: 'belt', faces: ['port'], y: [-100, 0], changes: { thicknessMm: 150 }, mirror: false },
    ]),
  );
  expect(commands).toHaveLength(2);
  expect(commands[1].op === 'surface-patch' && commands[1].mirror).toBe(false);
  const next = applyConstructionBatch(source, guardedBatch({ source, hash: 'hash' }, 'Armor', commands));
  const belt = next.construction.surfaces.filter((surface) => surface.thicknessMm === 150);
  expect(belt.length).toBeGreaterThan(0);
  // The later rule wins where the two overlap; the rest keeps the shell plating.
  expect(next.construction.surfaces.some((surface) => surface.thicknessMm === 20)).toBe(true);
  for (const surface of belt) expect(surface.face).toBe('port');
});
