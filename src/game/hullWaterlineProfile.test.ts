import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { hullWaterlineProfile, PROFILE_LEVELS, PROFILE_STATIONS } from './hullWaterlineProfile';

const middle = (PROFILE_LEVELS - 1) / 2;

test('a box hull slices to its half-breadths, with empty stations past both ends', () => {
  const root = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 100));
  box.position.set(1, -2, 0); root.add(box);
  // The pose of the ship itself must not leak into its own frame.
  root.position.set(500, 3, -40); root.rotation.set(.1, 1.2, -.05, 'YXZ');
  const profile = hullWaterlineProfile(root)!;
  expect(profile.bow).toBeCloseTo(-50, 0); expect(profile.stern).toBeCloseTo(50, 0);
  expect(profile.halfBeam).toBeCloseTo(6, 3);
  const row = middle * PROFILE_STATIONS;
  expect(Number.isNaN(profile.starboard[row])).toBe(true);
  expect(Number.isNaN(profile.port[row + PROFILE_STATIONS - 1])).toBe(true);
  for (let station = 2; station < PROFILE_STATIONS - 2; station++) {
    expect(profile.starboard[row + station]).toBeCloseTo(6, 3);
    expect(profile.port[row + station]).toBeCloseTo(4, 3);
  }
});

test('a sloped side widens with height, and levels the hull does not reach stay empty', () => {
  // A wedge section: 4 m wide at the keel (y = -4), 12 m at y = +4.
  const shape = new THREE.Shape([new THREE.Vector2(-2, -4), new THREE.Vector2(2, -4), new THREE.Vector2(6, 4), new THREE.Vector2(-6, 4)]);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 80, bevelEnabled: false }).translate(0, 0, -40);
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry));
  const profile = hullWaterlineProfile(root)!;
  const at = (level: number) => profile.starboard[level * PROFILE_STATIONS + PROFILE_STATIONS / 2];
  expect(at(middle)).toBeCloseTo(4, 2);
  expect(at(middle + 1)).toBeCloseTo(5, 2);
  expect(at(middle - 1)).toBeCloseTo(3, 2);
  expect(Number.isNaN(at(0))).toBe(true);
  expect(Number.isNaN(at(PROFILE_LEVELS - 1))).toBe(true);
});

test('side heights follow the deck edge, not the superstructure inboard or a lone yard over the side', () => {
  const root = new THREE.Group(), hull = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 100));
  hull.position.y = -2; root.add(hull);
  const house = new THREE.Mesh(new THREE.BoxGeometry(4, 20, 20)); house.position.y = 14; root.add(house);
  // A yard reaching past the side at one station's centre.
  const spacing = 100 / (PROFILE_STATIONS - 3), yard = new THREE.Mesh(new THREE.BoxGeometry(12, .2, .4));
  yard.position.set(0, 20, -50 - spacing + 15 * spacing); root.add(yard);
  const profile = hullWaterlineProfile(root)!;
  expect(profile.starboardSide[0]).toBe(0); expect(profile.portSide[PROFILE_STATIONS - 1]).toBe(0);
  for (let station = 2; station < PROFILE_STATIONS - 2; station++) {
    expect(profile.starboardSide[station]).toBeCloseTo(4, 3);
    expect(profile.portSide[station]).toBeCloseTo(4, 3);
  }
});

test('a model with nothing at the waterline has no profile', () => {
  const root = new THREE.Group(), mast = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mast.position.y = 30; root.add(mast);
  expect(hullWaterlineProfile(root)).toBeUndefined();
});
