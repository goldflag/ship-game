import { expect, test } from 'bun:test';
import catalog from './presetCatalog.json';
import { shipPreset, shipPresets } from './presets';
import { armorZones, equipmentGroups, floodingSpaces, gunBatteries, modeEntries, mountLabels, sideProfile } from './particulars';
import { shipParticulars, shipScores, shipStatistics } from './statistics';

test('every armor surface lands in exactly one zone, heaviest first, on historical and built ships', () => {
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id),
      zones = armorZones(def),
      ids = zones.flatMap((zone) => zone.entryIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(modeEntries(def, 'armor').length);
    const steel = zones.filter((zone) => zone.id !== 'underwater');
    for (let i = 1; i < steel.length; i++) expect(steel[i - 1].maxMm).toBeGreaterThanOrEqual(steel[i].maxMm);
    for (const zone of zones) {
      expect(zone.thicknesses.flatMap((t) => t.entryIds).length).toBe(zone.id === 'underwater' ? 0 : zone.entryIds.length);
      expect(zone.span[0]).toBeLessThanOrEqual(zone.span[1]);
    }
  }
});

test('belts and armored decks are read from where plates sit, not from their names', () => {
  // A historical ship names its plates; the belt and deck still come out as the heaviest side and deck.
  const bismarck = armorZones(shipPreset('bismarck'));
  expect(bismarck.find((z) => z.id === 'belt')!.maxMm).toBe(320);
  expect(bismarck.find((z) => z.id === 'deck')!.maxMm).toBeGreaterThanOrEqual(100);
  expect(bismarck.find((z) => z.id === 'turrets')!.maxMm).toBe(360);
  // A built ship names plates after hull faces and boundaries.
  const valiant = shipPreset('valiant'),
    zones = armorZones(valiant);
  const hullSide = modeEntries(valiant, 'armor').filter((e) => /^hull:(port|starboard)/.test(e.name));
  expect(zones.find((z) => z.id === 'belt')!.maxMm).toBe(Math.max(...hullSide.map((e) => e.thicknessMm ?? 0)));
  expect(zones.find((z) => z.id === 'deck')!.entryIds.every((id) => modeEntries(valiant, 'armor').find((e) => e.id === id)!.name.startsWith('hull:top'))).toBe(true);
  expect(zones.find((z) => z.id === 'fittings')!.entryIds.length).toBeGreaterThan(0);
  const armor = shipStatistics(valiant).find((s) => s.id === 'armor')!;
  expect(armor.rows.find((r) => r.label === 'Main belt')!.value).toBe(String(zones.find((z) => z.id === 'belt')!.maxMm));
});

test('guns group by calibre and equipment groups cover every damageable module once', () => {
  const bismarck = shipPreset('bismarck');
  expect(gunBatteries(bismarck).map((b) => [b.calibreMm, b.role])).toEqual([
    [380, 'Main battery'],
    [150, 'Secondary'],
    [105, 'Dual-purpose'],
    [37, 'Light AA'],
    [20, 'Light AA'],
  ]);
  expect(mountLabels(bismarck).slice(0, 4)).toEqual(['Anton', 'Bruno', 'Cäsar', 'Dora']);
  // Built ships repeat the gun's name on every mount; the main battery is lettered bow to stern.
  const valiant = shipPreset('valiant'),
    labels = mountLabels(valiant);
  expect(gunBatteries(valiant)[0].mountIndexes.map((i) => labels[i]).sort()).toEqual(['Turret A', 'Turret B', 'Turret C']);
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id),
      groups = equipmentGroups(def),
      ids = groups.flatMap((group) => group.entryIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(modeEntries(def, 'internals').length);
    if (def.mounts.length) expect(groups[0].id).toBe(gunBatteries(def)[0].id);
  }
  const magazines = equipmentGroups(valiant).find((g) => g.kind === 'magazine')!;
  expect(magazines.items.some((item) => /^Turret [A-C] magazine$/.test(item.name))).toBe(true);
  expect(magazines.items.every((item) => !item.name.endsWith(' ammunition'))).toBe(true);
});

test('flooding spaces run bow to stern and keep every compartment', () => {
  for (const id of ['bismarck', 'valiant', 'fletcher']) {
    const def = shipPreset(id),
      spaces = floodingSpaces(def);
    expect(spaces.length).toBe(def.compartments.length);
    for (let i = 1; i < spaces.length; i++) expect(spaces[i].span[0]).toBeGreaterThanOrEqual(spaces[i - 1].span[0]);
    expect(spaces.reduce((n, s) => n + s.capacityM3, 0)).toBeCloseTo(def.compartments.reduce((n, c) => n + c.capacityM3, 0), 3);
    const profile = sideProfile(def);
    expect(profile.shapes.length).toBeGreaterThan(0);
    expect(profile.z1 - profile.z0).toBeGreaterThan(def.hull.length * 0.9);
  }
});

test('historical ships rate from their menu summaries, before their plates load', () => {
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id),
      entry = (catalog as Record<string, { armorMaxMm?: number }>)[id];
    expect(entry.armorMaxMm).toBe(def.armor.reduce((n, a) => Math.max(n, a.thicknessMm), 0));
    // A summary carries everything but the plates themselves.
    const { armor: _armor, ...summary } = def;
    expect(shipScores({ ...summary, armorMaxMm: entry.armorMaxMm } as unknown as typeof def)).toEqual(shipScores(def));
  }
});

test('the particulars print the heaviest battery and read protection from the zones', () => {
  const def = shipPreset('bismarck'),
    figures = Object.fromEntries(shipParticulars(def).map((f) => [f.label, f]));
  expect(Object.keys(figures)).toEqual(['Hull integrity', 'Main belt', 'Armored deck', 'Main battery', 'Gun range', 'Top speed', 'Turning circle', 'Flooding reserve']);
  expect(figures['Main battery']).toMatchObject({ value: '8 × 380', unit: 'mm' });
  expect(figures['Main belt']).toMatchObject({ value: '320', unit: 'mm' });
  for (const figure of Object.values(figures)) {
    expect(figure.value).not.toContain('NaN');
    expect(figure.help.length).toBeGreaterThan(10);
  }
  const bare = shipParticulars({ ...def, mounts: [], armor: [], handling: { ...def.handling, forwardSpeed: 0 } });
  expect(bare.find((f) => f.label === 'Main battery')!.value).toBe('None');
  expect(bare.find((f) => f.label === 'Turning circle')!.value).toBe('—');
});
