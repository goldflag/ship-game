import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { hullFootprints, surfaceContact, type SeaHull } from './hullSea';
import { coupledHeight, hullSeaHeight, hullSeaSlot, hullSeaWavelength, hullSeaWeight } from './ocean/waves/hullSea';
import { createSeaState, seaHeight, seaResponse, seaWaves } from './session/sea';
import { wakeHull } from './wakeHull';

const storm = { ...createSeaState('north-atlantic', 'map', 0x5eed, 25), direction: 35 * Math.PI / 180 };
const bismarck = shipPreset('bismarck'), submarine = shipPreset('type-viic');
const hull = (definition: SeaHull['definition'], motion: Partial<SeaHull['motion']> = {}): SeaHull =>
  ({ definition, motion: { x: 0, y: 0, z: 0, heading: 0, waveHeave: 0, ...motion } });

test('the sea\'s components sum to the combat sea the hulls ride', () => {
  const waves = seaWaves(storm);
  expect(hullSeaWavelength(waves)).toBe(storm.wavelengthM);
  for (const time of [0, 12.5, 907.25]) for (const [x, z] of [[0, 0], [431, -212], [-15_000, 8_000]])
    expect(hullSeaHeight(waves, time, x, z)).toBeCloseTo(seaHeight(storm, x, z, time), 9);
});

test('a footprint sits on the hull\'s own waterplane and points its axis at the bow', () => {
  const shape = wakeHull(bismarck.hull);
  for (const heading of [0, .7, Math.PI / 2, 4]) {
    const [footprint] = hullFootprints([hull(bismarck, { x: 500, z: -300, heading })], { x: 0, z: 0 }, 4);
    // seaResponse's local frame: (x, z) lies at (cos·x − sin·z, sin·x + cos·z); the bow is local −z.
    const cos = Math.cos(heading), sin = Math.sin(heading);
    expect(footprint.x).toBeCloseTo(500 + cos * shape.centerX - sin * shape.centerZ, 9);
    expect(footprint.z).toBeCloseTo(-300 + sin * shape.centerX + cos * shape.centerZ, 9);
    expect(Math.cos(footprint.bearing)).toBeCloseTo(sin, 12); expect(Math.sin(footprint.bearing)).toBeCloseTo(-cos, 12);
    expect(footprint).toMatchObject({ length: shape.length, beam: shape.beam, contact: 1 });
  }
});

test('the water around a hull is the sea it rides: every waterplane sample of its heave agrees', () => {
  const waves = seaWaves(storm), pose = { x: 250, z: -900, heading: 1.1 }, time = 318.4;
  const slots = hullFootprints([hull(bismarck, pose)], { x: 0, z: 0 }, storm.amplitudeM).map(f => hullSeaSlot(f, hullSeaWavelength(waves)));
  const cos = Math.cos(pose.heading), sin = Math.sin(pose.heading);
  let heave = 0;
  for (const z of [-.4, -.2, 0, .2, .4]) for (const x of [-.3, .3]) {
    const wx = pose.x + cos * x * bismarck.hull.beam - sin * z * bismarck.hull.length, wz = pose.z + sin * x * bismarck.hull.beam + cos * z * bismarck.hull.length;
    expect(hullSeaWeight(slots, wx, wz).weight).toBeCloseTo(1, 12);
    // Drawn long waves of any height give way to the combat sea there.
    const drawn = coupledHeight(-4.6, -4.6, slots, waves, time, wx, wz);
    expect(drawn).toBeCloseTo(seaHeight(storm, wx, wz, time), 9);
    heave += drawn / 10;
  }
  expect(heave).toBeCloseTo(seaResponse(storm, bismarck.hull, pose, time).heave, 9);
});

test('a submarine couples while any of it reaches the surface, and not when it runs deep', () => {
  const eye = submarine.submarine!.periscopeEye[1];
  expect(surfaceContact(hull(submarine), 4)).toBe(1);
  expect(surfaceContact(hull(submarine, { y: -eye + .5 }), 4)).toBe(1);
  const awash = surfaceContact(hull(submarine, { y: -eye - 2 }), 4);
  expect(awash).toBeGreaterThan(0); expect(awash).toBeLessThan(1);
  expect(surfaceContact(hull(submarine, { y: -eye - 5.5 }), 4)).toBe(0);
  expect(surfaceContact(hull(submarine, { y: -50 }), 4)).toBe(0);
  // Heave rides on the depth: the same depth on a crest is the same contact.
  expect(surfaceContact(hull(submarine, { y: -eye - 2 + 3, waveHeave: 3 }), 4)).toBeCloseTo(awash, 12);
  // A wreck going down leaves the sea too.
  expect(surfaceContact(hull(bismarck, { y: -40, waveHeave: 0 }), 4)).toBe(0);
});

test('only the nearest hulls couple, and those near the cut fade instead of popping', () => {
  const fleet = Array.from({ length: 20 }, (_, i) => hull(bismarck, { x: 1000 * (i + 1), z: 0 }));
  const footprints = hullFootprints(fleet, { x: 0, z: 0 }, 4, 16);
  expect(footprints).toHaveLength(16);
  expect(footprints.map(f => Math.round(f.x / 1000))).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  // The first hull left out is 17 km away: the sixteenth fades, the twelfth (within ¾ of it) does not.
  expect(footprints[11].contact).toBe(1);
  expect(footprints[15].contact).toBeGreaterThan(0); expect(footprints[15].contact).toBeLessThan(.2);
  expect(hullFootprints(fleet.slice(0, 16), { x: 0, z: 0 }, 4, 16).every(f => f.contact === 1)).toBe(true);
});
