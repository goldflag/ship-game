import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3, type WebGPURenderer } from 'three/webgpu';
import type { SkyScene } from '../contracts';
import { SKY_TIERS } from '../quality';
import { DEFAULT_SKY_SCENE } from '../state';
import { createStubAtmosphere } from '../stubs/atmosphere';
import { createSkyUniforms } from '../uniforms';
import { SOUND_SPEED } from './lightning';
import { WeatherSystem } from './WeatherSystem';

function weather(options: ConstructorParameters<typeof WeatherSystem>[2] = {}) {
  const uniforms = createSkyUniforms();
  const system = new WeatherSystem({ renderer: {} as WebGPURenderer, uniforms, quality: 'medium', reversedDepth: true }, createStubAtmosphere(uniforms), options);
  const camera = new PerspectiveCamera(60, 16 / 9, .5, 60000);
  camera.position.set(0, 30, 0); camera.lookAt(1000, 20, 0); camera.updateMatrixWorld();
  const frame = (dt: number) => system.update({ renderer: {} as WebGPURenderer, camera, dt, cut: false });
  return { system, camera, frame };
}
const scene = (precipitation: number, lightning: number): SkyScene => ({ ...structuredClone(DEFAULT_SKY_SCENE), port: false,
  weather: { precipitation, lightning }, clouds: { ...DEFAULT_SKY_SCENE.clouds, coverage: .94, altitude: 650, thickness: 4200 } });
const shown = (system: WeatherSystem) => system.meshes.filter(mesh => mesh.visible).map(mesh => mesh.name);

test('dry weather draws nothing once its pipelines have compiled, and a downpour draws the tier\'s drops', () => {
  const { system, frame } = weather();
  system.apply(scene(0, 0));
  // The first frames draw the empty meshes so the game's warm-up compiles them.
  frame(1 / 60);
  expect(shown(system).length).toBe(3);
  for (let i = 0; i < 30; i++) frame(1 / 60);
  expect(shown(system)).toEqual([]);
  expect(system.strike).toBeNull();
  expect(system.flash).toBe(0);
  system.apply(scene(.9, 0));
  frame(1 / 60);
  expect(shown(system)).toEqual(['Rain splashes', 'Rain']);
  expect(system.diagnostics().drops).toBe(Math.round(Math.sqrt(.9) * SKY_TIERS.medium.rainDrops));
  system.setQuality('ultra');
  frame(1 / 60);
  expect(system.diagnostics().drops).toBe(Math.round(Math.sqrt(.9) * SKY_TIERS.ultra.rainDrops));
});

test('no rain from the chart\'s height, under water or in a hull view', () => {
  let sheltered = false;
  const { system, camera, frame } = weather({ sheltered: () => sheltered });
  system.apply(scene(1, 0));
  for (let i = 0; i < 30; i++) frame(1 / 60);
  expect(shown(system)).toContain('Rain');
  for (const [y, rain] of [[1600, false], [1200, true], [-2, false], [4, true]] as const) {
    camera.position.y = y; camera.updateMatrixWorld();
    frame(1 / 60);
    expect(shown(system).includes('Rain')).toBe(rain);
  }
  // Splashes are specks from a chase camera 200 m up.
  camera.position.y = 200; camera.updateMatrixWorld(); frame(1 / 60);
  expect(shown(system)).toEqual(['Rain']);
  camera.position.y = 30; camera.updateMatrixWorld();
  sheltered = true; frame(1 / 60);
  expect(shown(system)).toEqual([]);
});

test('a storm fires strikes with thunder delayed by the sound\'s travel; paused frames hold everything', () => {
  const { system, frame } = weather();
  const thunder: { distance: number; delay: number; loudness: number }[] = [];
  system.onThunder = cue => thunder.push(cue);
  system.apply(scene(.9, 30));
  let flashes = 0, lit = 0;
  for (let i = 0; i < 60 * 120; i++) {
    frame(1 / 60);
    if (system.flash > 0) flashes++;
    if (system.strike && system.strike.intensity > 0) lit++;
  }
  // Thirty a minute for two minutes: about 60 strikes.
  expect(thunder.length).toBeGreaterThan(35);
  expect(thunder.length).toBeLessThan(90);
  for (const cue of thunder) {
    expect(cue.delay).toBeCloseTo(cue.distance / SOUND_SPEED, 9);
    expect(cue.distance).toBeGreaterThan(500);
    expect(cue.loudness).toBeGreaterThanOrEqual(0);
    expect(cue.loudness).toBeLessThanOrEqual(1);
  }
  expect(flashes).toBeGreaterThan(0);
  expect(lit).toBeGreaterThan(0);
  // Pausing: nothing new fires and the frame holds.
  const before = thunder.length;
  const strike = system.strike, age = strike?.age, flash = system.flash;
  for (let i = 0; i < 600; i++) frame(0);
  expect(thunder.length).toBe(before);
  expect(system.strike).toBe(strike);
  expect(system.strike?.age).toBe(age);
  expect(system.flash).toBe(flash);
});

test('a forced strike is deterministic, silent, and lights the clouds from inside the cloud base', () => {
  const run = () => {
    const { system, frame } = weather();
    let thunder = 0;
    system.onThunder = () => thunder++;
    system.apply(scene(.9, 0));
    const strike = system.forceStrike(new Vector3(4000, 0, 450), .006, 'ground', 7);
    frame(0);
    return { thunder, kind: strike.kind, position: strike.position.toArray(), intensity: strike.intensity, flash: system.flash, active: system.strike === strike };
  };
  const first = run();
  expect(first).toEqual(run());
  expect(first.thunder).toBe(0);
  expect(first.active).toBe(true);
  expect(first.intensity).toBeGreaterThan(10);
  expect(first.position[1]).toBeGreaterThan(650);
  expect(first.flash).toBeGreaterThan(.1);
  expect(first.flash).toBeLessThan(1.5);
});

test('a flash lights the scene directly from a ground stroke\'s channel, far less through a cloud, and not once dark', () => {
  const { system, frame } = weather();
  system.apply(scene(.9, 0));
  const ground = system.forceStrike(new Vector3(4000, 0, 450), .006, 'ground', 7);
  frame(0);
  const { position, intensity } = system.boltLight;
  // Midway down the channel, dimmed a little by the downpour on its 4 km way.
  expect(position.y).toBeCloseTo(ground.top.y / 2, 6);
  expect(intensity).toBeGreaterThan(ground.intensity * .6); expect(intensity).toBeLessThan(ground.intensity);
  const cloud = system.forceStrike(new Vector3(4000, 0, 450), .006, 'cloud', 7);
  frame(0);
  expect(system.boltLight.position.y).toBeCloseTo(cloud.top.y, 6);
  expect(system.boltLight.intensity).toBeLessThan(cloud.intensity * .25);
  system.clearStrike();
  expect(system.boltLight.intensity).toBe(0);
  frame(1 / 60);
  expect(system.boltLight.intensity).toBe(0);
});
