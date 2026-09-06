import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from './presets';
import { maximumRangeM, shipScores, shipStatistics } from './statistics';
import { maxHullIntegrity } from '../simulation/damage';

test('every preset prints a complete sheet whose figures come from the compiled definition', () => {
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id), sections = shipStatistics(def);
    expect(sections.map(s => s.id)).toEqual(['survivability', 'armor', 'main-battery', ...(def.mounts.some(m => m.battery === 'secondary') ? ['secondary-battery'] : []), ...[...new Set(def.torpedoTubes?.map(t => `torpedoes-${t.weapon.id}`))], ...[...new Set(def.depthChargeLaunchers?.map(l => `depth-charges-${l.weapon.id}`))], 'mobility', ...(def.submarine ? ['diving'] : []), 'dimensions', 'model-basis']);
    for (const section of sections) {
      expect(section.headline).not.toBe('');
      expect(section.headlineHelp.length).toBeGreaterThan(10);
      for (const row of section.rows) {
        expect(row.value).not.toBe('');
        expect(row.value).not.toContain('NaN');
        expect(row.help.length).toBeGreaterThan(10);
      }
    }
    const survivability = sections.find(s => s.id === 'survivability')!;
    expect(survivability.headline).toBe(maxHullIntegrity(def).toLocaleString('en-US'));
    expect(survivability.rows.find(r => r.label === 'Compartments')!.value).toBe(String(def.compartments.length));
    const main = sections.find(s => s.id === 'main-battery')!, weapon = def.mounts.find(m => m.battery === 'main')!.weapon;
    expect(main.headline).toBe(String(Math.round(weapon.caliberM * 1000)));
    expect(main.rows.find(r => r.label === 'Layout')!.value).toBe(`${def.mounts.filter(m => m.battery === 'main').length} × ${weapon.barrelCount ?? 2}`);
    expect(sections.find(s => s.id === 'model-basis')!.notes!.map(n => n.text)).toEqual([def.accuracy.exterior, def.accuracy.internals, def.accuracy.weapons]);
  }
});

test('the VIIC statistics retain torpedo supply and launch limits alongside its guns', () => {
  const sections = shipStatistics(shipPreset('type-viic'));
  const torpedoes = sections.find(s => s.title === 'Torpedoes')!;
  const row = (label: string) => torpedoes.rows.find(r => r.label === label)!;
  expect(torpedoes.headline).toBe('5');
  expect(row('Ammunition').value).toBe('14');
  expect(row('Diameter').value).toBe('533');
  expect(row('Arming distance').value).toBe('300');
  expect(row('Tube bearings').value).toBe('0° / 180°');
  expect(sections.some(s => s.id === 'main-battery')).toBe(true);
  expect(shipStatistics(shipPreset('bismarck')).some(s => s.title === 'Torpedoes')).toBe(false);
});

test('category scores stay within 0-100 and separate the presets by their simulation data', () => {
  const scores = Object.fromEntries(Object.keys(shipPresets).map(id => [id, Object.fromEntries(shipScores(shipPreset(id)).map(s => [s.id, s.score]))]));
  for (const ship of Object.values(scores)) for (const value of Object.values(ship)) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(100); expect(Number.isInteger(value)).toBe(true); }
  expect(scores.yamato.survivability).toBeGreaterThan(scores.bismarck.survivability);
  expect(scores.bismarck.survivability).toBeGreaterThan(scores.baltimore.survivability);
  expect(scores.yamato.artillery).toBeGreaterThan(scores.baltimore.artillery);
  expect(scores.baltimore.concealment).toBeGreaterThan(scores.bismarck.concealment);
  // Bismarck's modeled batteries have no gun light enough to engage aircraft.
  expect(scores.bismarck.airDefense).toBe(0);
  expect(scores['enterprise-cv6'].airDefense).toBeGreaterThan(scores.baltimore.airDefense);
  expect(shipScores(shipPreset('bismarck')).map(s => s.id)).toEqual(['survivability', 'artillery', 'airDefense', 'maneuverability', 'concealment']);
});

test('maximum range follows the low-arc solver: elevation limited, then capped at 30 km', () => {
  const bismarck = shipPreset('bismarck').mounts[0].weapon;
  expect(maximumRangeM(bismarck)).toBeLessThanOrEqual(30000);
  // Elevation above 45° never extends the low arc past its 45° maximum.
  expect(maximumRangeM({ ...bismarck, ballistics: undefined, muzzleSpeed: 400, elevationMaxDeg: 85 })).toBeCloseTo(400 ** 2 / 9.81, 3);
  expect(maximumRangeM({ ...bismarck, ballistics: undefined, muzzleSpeed: 400, elevationMaxDeg: 30 })).toBeCloseTo(400 ** 2 * Math.sin(Math.PI / 3) / 9.81, 3);
  const slow = { ...bismarck, muzzleSpeed: 400 };
  expect(maximumRangeM(slow)).toBeLessThan(maximumRangeM({ ...slow, ballistics: undefined }));
});
