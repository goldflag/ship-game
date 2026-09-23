import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { CelestialModel, directionFromAngles } from '../celestialModel';
import { horizonCut, milkyWayShare, moonLighting, moonlight, starLimit, viewScale, type MoonLighting } from './bodies';
import { LightShafts } from './shafts';

const lighting = (): MoonLighting => ({ lit: 0, opposition: 0, right: new Vector3(), up: new Vector3(), sun: new Vector3(), surface: new Vector3(), earthshine: new Vector3() });

test('stars come out through twilight, brightest first, and a full moon well up hides the faintest', () => {
  expect(starLimit(0, 0)).toBeLessThan(-1.46);
  expect(starLimit(-6, 0)).toBeGreaterThan(0);
  expect(starLimit(-6, 0)).toBeLessThan(2);
  expect(starLimit(-18, 0)).toBeGreaterThan(6.5);
  const full = new Vector3(0, .8, .6).normalize(), set = new Vector3(0, -.3, .95).normalize();
  expect(moonlight(.5, full)).toBeCloseTo(1, 6);
  expect(moonlight(.5, set)).toBe(0);
  expect(moonlight(.12, full)).toBeLessThan(.15);
  expect(starLimit(-40, moonlight(.5, full))).toBeLessThan(starLimit(-40, moonlight(.12, full)));
});

test('the Milky Way needs astronomical twilight and is dimmed, not switched off, by a full moon', () => {
  expect(milkyWayShare(-5, 0)).toBe(0);
  expect(milkyWayShare(-20, 0)).toBe(1);
  expect(milkyWayShare(-12, 0)).toBeGreaterThan(0);
  expect(milkyWayShare(-12, 0)).toBeLessThan(1);
  expect(milkyWayShare(-40, 1)).toBeGreaterThan(.4);
  expect(milkyWayShare(-40, 1)).toBeLessThan(.7);
});

test('pixels and zoom: the normal field spans the pixels it should, binoculars brighten stars within a cap', () => {
  const normal = viewScale(52, 1, 900);
  expect(normal.pixelAngle).toBeCloseTo(2 * Math.tan(26 * Math.PI / 180) / 900, 12);
  expect(normal.starGain).toBeCloseTo(1, 12);
  const glasses = viewScale(2 * Math.atan(Math.tan(26 * Math.PI / 180) / 24) * 180 / Math.PI, 1, 900);
  expect(glasses.pixelAngle).toBeCloseTo(normal.pixelAngle / 24, 12);
  expect(glasses.starGain).toBe(3);
  expect(viewScale(52, 4, 900).pixelAngle).toBeCloseTo(normal.pixelAngle / 4, 12);
  // Stars stop at the sea horizon, which dips below the level as the camera climbs (3.8° at 14 km).
  expect(horizonCut(0)).toBeCloseTo(-.02, 12);
  expect(Math.asin(-horizonCut(14000) - .02) * 180 / Math.PI).toBeCloseTo(3.8, 1);
});

test('the moon is lit by the true sun: full faces the viewer, a crescent is lit on the side toward the sun', () => {
  const model = new CelestialModel(), target = lighting(), irradiance = new Vector3(.36, .47, .7);
  model.set(-30, 250, .5);
  const full = moonLighting(model.sun, model.moon, model.pole, .5, irradiance, 2.8, target);
  expect(full.lit).toBeCloseTo(1, 12);
  expect(full.opposition).toBeCloseTo(1, 9);
  expect(target.sun.z).toBeCloseTo(1, 9);
  // An orthonormal disc frame with the moon behind it, lunar north toward the pole.
  expect(target.right.dot(target.up)).toBeCloseTo(0, 12);
  expect(target.right.dot(model.moon)).toBeCloseTo(0, 12);
  expect(target.up.dot(model.pole)).toBeGreaterThan(0);
  expect(target.right.clone().cross(target.up).dot(model.moon)).toBeCloseTo(-1, 9);
  const fullSurface = target.surface.clone();
  model.set(-7, 276, .08);
  const crescent = moonLighting(model.sun, model.moon, model.pole, .08, irradiance.clone().multiplyScalar(.06 / (.5 * (1 - Math.cos(Math.PI)))), 2.8, target);
  // Nearly behind the moon: the sun lights only its limb, from the side it stands on.
  expect(target.sun.z).toBeLessThan(-.8);
  const sunOnDisc = new Vector3(model.sun.dot(target.right), model.sun.dot(target.up), 0);
  expect(sunOnDisc.x * target.sun.x + sunOnDisc.y * target.sun.y).toBeGreaterThan(0);
  expect(crescent.opposition).toBeLessThan(.45);
  // The lit face keeps a full moon's surface brightness (the lit share is divided back out); earthshine grows.
  expect(target.surface.length()).toBeGreaterThan(fullSurface.length() * .9);
  expect(target.earthshine.length()).toBeGreaterThan(.01);
});

test('shafts: from the light on screen at a low sun, fainter high, none when behind, set or under water', () => {
  const camera = new PerspectiveCamera(60, 16 / 9, .5, 60000), shafts = new LightShafts(24);
  const aim = (direction: Vector3) => { camera.position.set(0, 30, 0); camera.lookAt(direction.clone().multiplyScalar(1e4).add(camera.position)); camera.updateMatrixWorld(); };
  const low = directionFromAngles(6, 250), high = directionFromAngles(55, 250);
  aim(low);
  shafts.update(camera, low, false);
  expect(shafts.active).toBe(true);
  expect(shafts.light.value.x).toBeCloseTo(.5, 6);
  expect(shafts.light.value.y).toBeCloseTo(.5, 6);
  const golden = shafts.gain.value;
  aim(high);
  shafts.update(camera, high, false);
  expect(shafts.gain.value).toBeGreaterThan(0);
  expect(shafts.gain.value).toBeLessThan(golden * .5);
  // The light above the view's top edge: y in uv runs down the screen.
  aim(directionFromAngles(0, 250));
  shafts.update(camera, directionFromAngles(20, 250), false);
  expect(shafts.light.value.y).toBeLessThan(.5);
  aim(low);
  shafts.update(camera, directionFromAngles(6, 70), false);
  expect(shafts.active).toBe(false);
  shafts.update(camera, directionFromAngles(-3, 250), false);
  expect(shafts.active).toBe(false);
  shafts.update(camera, low, true);
  expect(shafts.active).toBe(false);
  // Far off screen the source disc has left the view.
  shafts.update(camera, directionFromAngles(6, 250 + 75), false);
  expect(shafts.active).toBe(false);
});
