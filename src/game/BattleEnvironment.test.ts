import { expect, test } from 'bun:test';
import { HemisphereLight } from 'three/webgpu';
import { Atmosphere, Clouds, Sun, SunDriver, TimeOfDay } from '../../vendor/threejs-sky-pro/build/index.js';
import { OCEAN_MAPS, oceanMap } from '../maps/catalog';
import { battleEnvironment, TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '../maps/conditions';
import { validateBattleSetup } from '../simulation/battle';
import { Game } from './Game';

test('all battle conditions combine across maps without mutating their defaults', () => {
  const original = JSON.stringify(OCEAN_MAPS);
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 5000 };
  for (const map of OCEAN_MAPS) {
    expect(battleEnvironment(map).sky).toEqual(map.sky);
    expect(battleEnvironment(map).fog).toEqual(map.fog);
    for (const time of TIME_OF_DAY_PRESETS) for (const weather of WEATHER_PRESETS) {
      validateBattleSetup({ ...setup, mapId: map.id, timeOfDay: time.id, weather: weather.id }, ['bismarck']);
      const environment = battleEnvironment(map, time.id, weather.id);
      expect(Object.values(environment.sky).every(Number.isFinite)).toBe(true);
      expect(environment.sky.elevation).toBe(time.sky.elevation ?? map.sky.elevation);
      expect(environment.fog.end).toBeGreaterThan(environment.fog.start);
      expect(environment.sky.coverage).toBeGreaterThanOrEqual(0);
      expect(environment.sky.coverage).toBeLessThanOrEqual(1);
    }
  }
  expect(JSON.stringify(OCEAN_MAPS)).toBe(original);
  for (const value of ['missing', '', null, 7]) {
    expect(() => validateBattleSetup({ ...setup, timeOfDay: value as never }, ['bismarck'])).toThrow('time of day');
    expect(() => validateBattleSetup({ ...setup, weather: value as never }, ['bismarck'])).toThrow('weather preset');
  }
});

test('night, fog and storm lighting reach the live uniforms; the sky stays fixed and port restores daylight', () => {
  const sky = { sun: new Sun(), timeOfDay: new TimeOfDay(), atmosphere: new Atmosphere(), clouds: new Clouds() };
  const driver = new SunDriver({ sun: sky.sun, timeOfDay: sky.timeOfDay });
  const game = Object.assign(Object.create(Game.prototype), {
    simulation: { mapId: 'pacific-islands' }, inPort: false, sky,
    ambientLight: new HemisphereLight(), effects: { setSun() {} }, water: { fog: {} },
  });
  for (const time of TIME_OF_DAY_PRESETS) for (const weather of WEATHER_PRESETS) {
    game.battleTimeOfDay = time.id; game.battleWeather = weather.id;
    game.updatePortLighting();
    driver.update(0);
    const expected = battleEnvironment(oceanMap('pacific-islands'), time.id, weather.id);
    expect(sky.sun.elevationDeg).toBeCloseTo(expected.sky.elevation, 8);
    expect((sky.sun.azimuthDeg + 360) % 360).toBeCloseTo(expected.sky.azimuth, 8);
    const direction = sky.sun.direction.value.clone();
    driver.update(600);
    expect(sky.sun.direction.value.distanceTo(direction)).toBeLessThan(1e-10);
    expect(sky.clouds.shape.coverage.value).toBe(expected.sky.coverage);
    expect(game.water.fog.fadeEnd).toBe(expected.fog.end);
    expect(game.ambientLight.intensity).toBe(expected.sky.ambient);
    if (time.id === 'night') {
      expect(sky.sun.intensity.value).toBe(0);
      expect(sky.timeOfDay.moonDirection.value.y).toBeGreaterThan(0);
      expect(game.ambientLight.intensity).toBeLessThan(.25);
      expect(game.water.fog.color).toBe('#182839');
    }
  }
  game.inPort = true;
  game.updatePortLighting(); driver.update(0);
  expect(sky.sun.elevationDeg).toBeCloseTo(36);
  expect(sky.sun.azimuthDeg).toBeCloseTo(58);
  expect(sky.sun.peakIntensity).toBe(5);
  expect(game.ambientLight.intensity).toBe(1.1);
  expect(sky.clouds.shape.coverage.value).toBe(.38);
  expect(sky.clouds.wind.speed).toBe(12);
  expect(sky.clouds.lighting.ambientIntensity.value).toBe(1.1);
  expect(sky.clouds.lighting.baseShadowStrength.value).toBe(.2);
  expect(game.water.fog.color).toBe('#819aa5');
  expect(game.water.fog.fadeEnd).toBe(5600);
});
