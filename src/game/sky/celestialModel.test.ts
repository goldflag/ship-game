import { expect, test } from 'bun:test';
import { Vector3 } from 'three/webgpu';
import { anglesOf, CelestialModel, directionFromAngles, moonIllumination } from './celestialModel';

test('compass angles round-trip in the game convention', () => {
  expect(directionFromAngles(0, 0).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-12);
  expect(directionFromAngles(0, 90).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12);
  for (const [elevation, azimuth] of [[48, 235], [-28, 320], [3, 270], [70, -45]]) {
    const angles = anglesOf(directionFromAngles(elevation, azimuth));
    expect(angles.elevation).toBeCloseTo(elevation, 10);
    expect((angles.azimuth - azimuth + 720) % 360).toBeCloseTo(0, 10);
  }
});

test('the sun stands exactly where the scene authored it and a full moon opposite', () => {
  const model = new CelestialModel();
  for (const [elevation, azimuth] of [[48, 235], [67, 135], [18, 205], [3, 270], [-28, 320], [-70, 0], [0, 90]]) {
    model.set(elevation, azimuth, .5);
    expect(model.sun.distanceTo(directionFromAngles(elevation, azimuth))).toBeLessThan(1e-9);
    expect(model.moon.distanceTo(model.sun.clone().negate())).toBeLessThan(1e-9);
    // The pole is a right angle from the equator the sun rides.
    expect(Math.abs(model.pole.dot(model.sun))).toBeLessThan(1e-9);
  }
});

test('phases place the moon along the arc: new beside the sun, a waxing crescent following it down', () => {
  const model = new CelestialModel();
  model.set(4, 270, 0);
  expect(model.moon.distanceTo(model.sun)).toBeLessThan(1e-9);
  model.set(40, 180, .1);
  // Elongation equals 2π·phase on an equinox arc.
  expect(model.moon.angleTo(model.sun)).toBeCloseTo(2 * Math.PI * .1, 9);
  // Hour angle grows toward the setting sun (azimuth 270, −X): the evening crescent trails it, on the rising side.
  const setting = model.onArc(Math.PI / 2);
  expect(setting.x).toBeLessThan(-.99);
  expect(model.moon.x).toBeGreaterThan(model.sun.x);
  expect(moonIllumination(0)).toBe(0);
  expect(moonIllumination(.5)).toBeCloseTo(1, 12);
  expect(moonIllumination(.25)).toBeCloseTo(.5, 12);
});

test('the star frame is a rotation whose pole is the celestial pole', () => {
  const model = new CelestialModel();
  model.sidereal = 1.3;
  model.set(-35, 140, .5);
  const e = model.starRotation.elements;
  expect(model.starRotation.determinant()).toBeCloseTo(1, 10);
  // Row three (column-major elements 2, 5, 8) is the pole.
  expect(new Vector3(e[2], e[5], e[8]).distanceTo(model.pole)).toBeLessThan(1e-10);
  const celestialPole = model.pole.clone().applyMatrix3(model.starRotation);
  expect(celestialPole.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-10);
});
