import {expect, test} from 'bun:test';
import blueprint from '../../assets/ships/kongo/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import {compileShip, type Vec3} from '../ships/blueprint';
import {structuralHits} from './structure';

const definition = compileShip(blueprint, catalog);

test('Kongō aft AA shields stop a crossing shot while their rear stays open', () => {
  for (const mount of definition.mounts.filter(m => /^aa25-(3[5-9]|4[0-8])$/.test(m.id))) {
    const [x, y, z] = mount.position, sign = Math.sign(x);
    const hits = (a: Vec3, b: Vec3) => structuralHits(a, b, definition)
      .filter(h => h.surface.id === `fixed-fitting-aft-seat-${mount.id}`);
    expect(hits([x+sign, y+.6, z], [x, y+.6, z]).length).toBeGreaterThan(0);
    expect(hits([x-sign*1.5, y+.6, z], [x, y+.6, z])).toEqual([]);
    const footing = hits([x, y+.1, z], [x, y-.2, z]);
    expect(footing[0]?.point[1]).toBeCloseTo(y, 5);
  }
});

test('Kongō weather-deck contacts preserve the casemate wells and adjacent deck', () => {
  const deck = (x: number, z: number, bottom = 4.64) => structuralHits([x, 8, z], [x, bottom, z], definition)
    .filter(h => h.surface.id === 'fixed-fitting-weather-deck');
  for (const mount of definition.mounts.filter(m => m.id.startsWith('casemate-'))) {
    const [x, y, z] = mount.position;
    // The well floor below the mounting datum is physical support.
    expect(deck(x, z, y).map(h => h.point)).toEqual([]);
  }
  expect(deck(8, 48)[0]?.point[1]).toBeCloseTo(5.11, 2);
});
