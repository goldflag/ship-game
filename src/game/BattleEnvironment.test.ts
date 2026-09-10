import { expect, test } from 'bun:test';
import { Color, DirectionalLight, Group, Vector3 } from 'three/webgpu';
import { Atmosphere, Clouds, Sun, SunDriver, TimeOfDay } from '../../vendor/threejs-sky-pro/build/index.js';
import { OCEAN_MAPS, oceanMap } from '../maps/catalog';
import { battleEnvironment, TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '../maps/conditions';
import { validateBattleSetup } from '../simulation/battle';
import { VisualEnvironment } from './VisualEnvironment';

/** The Water Pro surface the environment writes to, reduced to its live uniforms. */
function fakeWater(lighting?: { sun: { direction: { value: Vector3 }; intensity: { value: number }; color: Color }; sunLight: DirectionalLight }) {
  return {
    waves: { amplitude: { value: 0 }, windSpeed: { value: 0 }, peakWavelength: { value: 0 }, choppiness: { value: 0 }, windDirection: { value: 0 }, dirty: false },
    color: { absorptionColor: new Color(), waterColor: new Color(), transmissionColor: new Color(),
      update(colors: { waterColor: string; transmissionColor: string; absorptionColor: string }) {
        this.waterColor.set(colors.waterColor); this.transmissionColor.set(colors.transmissionColor); this.absorptionColor.set(colors.absorptionColor);
      } },
    foam: { waves: { opacity: 0, color: new Color() }, surface: { color: new Color() }, shoreline: { color: new Color() } },
    fog: {} as { color?: string; fadeStart?: number; fadeEnd?: number; fadePower?: number; skyBlendDistance?: number },
    underwaterDistortion: { intensity: .02 },
    lighting,
  };
}
function windSink() { return { wind: [] as number[], setWind(speed: number, direction: number) { this.wind = [speed, direction]; } }; }
function lightSink() {
  return { direct: 0, ambient: 0, setWind() {}, setSun() {},
    setIllumination(_color: Color, intensity: number, ambient: number) { this.direct = intensity; this.ambient = ambient; } };
}

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
      expect(environment.waves.amplitude).toBe(weather.waves.amplitude * map.water.amplitudeScale);
      expect(environment.waves.windSpeed).toBe(weather.waves.windSpeed * map.water.windScale);
      expect(environment.waves.peakWavelength).toBe(weather.waves.peakWavelength * map.water.wavelengthScale);
    }
  }
  expect(JSON.stringify(OCEAN_MAPS)).toBe(original);
  for (const value of ['missing', '', null, 7]) {
    expect(() => validateBattleSetup({ ...setup, timeOfDay: value as never }, ['bismarck'])).toThrow('time of day');
    expect(() => validateBattleSetup({ ...setup, weather: value as never }, ['bismarck'])).toThrow('weather preset');
  }
});

test('weather drives live waves across maps, overrides obsolete settings, and restores sheltered port water', () => {
  const water = fakeWater();
  const effects = { ...windSink(), setSun() {}, setIllumination() {} }, funnelSmoke = windSink();
  const environment = new VisualEnvironment({ effects, funnelSmoke, sunAnchor: new Group() });
  environment.attachWater(water as never);
  let mapId = OCEAN_MAPS[0].id;
  for (const map of OCEAN_MAPS) {
    mapId = map.id;
    let previous = 0;
    for (const weather of ['clear', 'partly-cloudy', 'overcast', 'storm-clouds'] as const) {
      environment.setBattle({ timeOfDay: 'map', weather, conditions: {} });
      environment.setScene(map.id, false);
      const expected = battleEnvironment(map, 'map', weather).waves;
      expect(water.waves.amplitude.value).toBe(expected.amplitude);
      expect(water.waves.windSpeed.value).toBe(expected.windSpeed);
      expect(water.waves.peakWavelength.value).toBe(expected.peakWavelength);
      expect(water.waves.amplitude.value).toBeGreaterThan(previous);
      expect(water.waves.windDirection.value).toBe(map.water.windDirection * Math.PI / 180);
      expect(effects.wind).toEqual([expected.windSpeed, water.waves.windDirection.value]);
      expect(funnelSmoke.wind).toEqual(effects.wind);
      expect(water.waves.dirty).toBe(true);
      previous = water.waves.amplitude.value;
    }
    environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: {} }); environment.setScene(map.id, false);
    expect(water.waves.amplitude.value).toBe(battleEnvironment(map, 'map', 'clear').waves.amplitude);
  }
  environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: { timeHours: 0 } }); environment.setScene(mapId, false);
  const nightWater = water.color.waterColor.clone(), nightFoam = water.foam.waves.color.clone();
  environment.setScene(mapId, false);
  expect(water.color.waterColor).toEqual(nightWater);
  expect(water.foam.waves.color).toEqual(nightFoam);
  environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: { timeHours: 12 } }); environment.setScene(mapId, false);
  const dayPalette = oceanMap(mapId).water;
  expect(water.color.waterColor).toEqual(new Color(dayPalette.waterColor));
  expect(water.color.absorptionColor).toEqual(new Color(dayPalette.absorptionColor));
  expect(water.foam.waves.color).toEqual(new Color(1, 1, 1));
  environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: { timeHours: 0 } }); environment.setScene(mapId, false);
  environment.setScene(mapId, true);
  expect(water.color.waterColor).toEqual(new Color(oceanMap('north-atlantic').water.waterColor));
  expect(water.waves.amplitude.value).toBe(.12);
  expect(water.waves.windSpeed.value).toBe(4);
  expect(water.waves.peakWavelength.value).toBe(14);
  expect(effects.wind).toEqual([4, 35 * Math.PI / 180]);
  expect(funnelSmoke.wind).toEqual(effects.wind);
});

test('night, fog and storm lighting reach the live uniforms; the sky stays fixed and port restores daylight', () => {
  const sky = { sun: new Sun(), timeOfDay: new TimeOfDay(), atmosphere: new Atmosphere(), clouds: new Clouds() };
  const driver = new SunDriver({ sun: sky.sun, timeOfDay: sky.timeOfDay });
  const water = fakeWater(), effects = lightSink();
  const environment = new VisualEnvironment({ effects, funnelSmoke: windSink(), sunAnchor: new Group() });
  environment.attachWater(water as never); environment.attachSky(sky as never);
  for (const time of TIME_OF_DAY_PRESETS) for (const weather of WEATHER_PRESETS) {
    environment.setBattle({ timeOfDay: time.id, weather: weather.id, conditions: {} });
    environment.setScene('pacific-islands', false);
    driver.update(0);
    // No water step occurs on a paused frame; the sky must still reach smoke.
    environment.syncLighting();
    const expected = battleEnvironment(oceanMap('pacific-islands'), time.id, weather.id);
    expect(sky.sun.elevationDeg).toBeCloseTo(expected.sky.elevation, 8);
    expect((sky.sun.azimuthDeg + 360) % 360).toBeCloseTo(expected.sky.azimuth, 8);
    const direction = sky.sun.direction.value.clone();
    driver.update(600);
    expect(sky.sun.direction.value.distanceTo(direction)).toBeLessThan(1e-10);
    expect(sky.clouds.shape.coverage.value).toBe(expected.sky.coverage);
    expect(water.fog.fadeEnd).toBe(expected.fog.end);
    expect(environment.ambientLight.intensity).toBe(expected.sky.ambient);
    expect(effects.ambient).toBe(expected.sky.ambient);
    if (time.id === 'night') {
      expect(sky.sun.intensity.value).toBe(0);
      expect(sky.timeOfDay.moonDirection.value.y).toBeGreaterThan(0);
      expect(environment.ambientLight.intensity).toBeLessThan(.5);
      expect(water.fog.color).toBe('#182839');
      expect(effects.direct).toBeLessThan(1);
      expect(effects.direct).toBeGreaterThan(0);
    } else if (sky.sun.elevationDeg >= 18) expect(effects.direct).toBeCloseTo(sky.sun.intensity.value);
    else expect(effects.direct).toBeLessThan(sky.sun.intensity.value);
  }
  environment.setScene('pacific-islands', true); driver.update(0);
  expect(sky.sun.elevationDeg).toBeCloseTo(36);
  expect(sky.sun.azimuthDeg).toBeCloseTo(58);
  expect(sky.sun.peakIntensity).toBe(5.8);
  expect(environment.ambientLight.intensity).toBe(1.75);
  expect(sky.clouds.shape.coverage.value).toBe(.38);
  expect(sky.clouds.wind.speed).toBe(12);
  expect(sky.clouds.lighting.ambientIntensity.value).toBe(1.1);
  expect(sky.clouds.lighting.baseShadowStrength.value).toBe(.2);
  expect(water.fog.color).toBe('#819aa5');
  expect(water.fog.fadeEnd).toBe(5600);
});

test('continuous battle conditions keep clouds independent of CPU and visual wind', () => {
  for (const map of OCEAN_MAPS) {
    const clear = battleEnvironment(map, 'map', 'map', { timeHours: 12, cloudCover: 0, windSpeed: 18 });
    const cloudy = battleEnvironment(map, 'map', 'map', { timeHours: 12, cloudCover: 100, windSpeed: 18 });
    expect(clear.sky.coverage).toBe(0);
    expect(cloudy.sky.coverage).toBe(1);
    expect(clear.waves).toEqual(cloudy.waves);
    expect(clear.waves.windSpeed).toBe(18);
    expect(clear.sky.elevation).toBe(70);
    const calmNight = battleEnvironment(map, 'map', 'map', { timeHours: 0, cloudCover: 100, windSpeed: 0 });
    expect(calmNight.sky.elevation).toBe(-70);
    expect(calmNight.sky.ambient).toBeLessThan(cloudy.sky.ambient);
    expect(calmNight.waves.amplitude).toBe(0);
    expect(calmNight.cloudWind).toBe(0);
    expect(battleEnvironment(map, 'map', 'map', { timeHours: 24 }).sky.elevation).toBeCloseTo(calmNight.sky.elevation);
  }
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 5000 };
  for (const key of ['timeHours', 'cloudCover', 'windSpeed']) {
    for (const value of [NaN, Infinity, -1, 101]) expect(() => validateBattleSetup({ ...setup, [key]: value }, ['bismarck'])).toThrow();
  }
});

test('numeric night time uses night fog and dawn cloud fill is not dimmed twice', () => {
  for (const map of OCEAN_MAPS) {
    const night = battleEnvironment(map, 'map', 'map', { timeHours: 0 });
    expect(night.fog.color).toBe(battleEnvironment(map, 'night').fog.color);
    const dawn = battleEnvironment(map, 'map', 'map', { timeHours: 6 });
    expect(dawn.fog.color).not.toBe(map.fog.color);
    expect(dawn.cloudAmbient).toBe(battleEnvironment(map).cloudAmbient);
  }
});

test('paused scene, water and smoke share moonlight and restore the current sun', () => {
  const sky = { sun: new Sun(), timeOfDay: new TimeOfDay(), atmosphere: new Atmosphere(), clouds: new Clouds() };
  const driver = new SunDriver({ sun: sky.sun, timeOfDay: sky.timeOfDay });
  const waterSun = { direction: { value: new Vector3() }, intensity: { value: 5.8 }, color: new Color() };
  const water = fakeWater({ sun: waterSun, sunLight: new DirectionalLight() }), effects = lightSink();
  const environment = new VisualEnvironment({ effects, funnelSmoke: windSink(), sunAnchor: new Group() });
  environment.attachWater(water as never); environment.attachSky(sky as never);
  for (const hour of [0, 5.5, 6, 7, 12, 24]) {
    environment.setBattle({ timeOfDay: 'map', weather: 'map', conditions: { timeHours: hour } });
    environment.setScene('north-atlantic', false); driver.update(0);
    environment.syncLighting(); // Deliberately no water simulation step.
    expect(waterSun.intensity.value).toBeCloseTo(effects.direct);
    expect(water.lighting!.sunLight.intensity).toBeCloseTo(effects.direct);
    expect(waterSun.direction.value.y).toBeGreaterThanOrEqual(0);
    if (hour === 0 || hour === 24) {
      expect(waterSun.intensity.value).toBeGreaterThan(.3);
      expect(waterSun.direction.value.distanceTo(sky.timeOfDay.moonDirection.value)).toBeLessThan(1e-8);
    }
    if (hour === 6) {
      expect(effects.direct).toBeLessThan(1);
      expect(waterSun.color.r).toBeGreaterThan(waterSun.color.b);
    }
    if (hour === 12) expect(waterSun.intensity.value).toBeCloseTo(sky.sun.intensity.value);
  }
});

test('distant shadow focus survives provider sync and restores the port and player anchors', () => {
  const sky = { sun: new Sun(), timeOfDay: new TimeOfDay(), atmosphere: new Atmosphere(), clouds: new Clouds() };
  const water = fakeWater({ sun: { direction: { value: new Vector3() }, intensity: { value: 1 }, color: new Color() }, sunLight: new DirectionalLight() });
  const anchor = new Group(); anchor.position.set(100, 3, 200);
  const environment = new VisualEnvironment({ effects: lightSink(), funnelSmoke: windSink(), sunAnchor: anchor });
  environment.attachWater(water as never); environment.attachSky(sky as never);
  environment.setScene('north-atlantic', false);
  const focus = new Vector3(20000, 0, 15000);
  environment.setShadowFocus(focus); environment.syncLighting(); environment.syncLighting();
  expect(water.lighting!.sunLight.target.position).toEqual(focus);
  environment.setScene('north-atlantic', true); environment.syncLighting();
  expect(water.lighting!.sunLight.target.position).toEqual(new Vector3(-60, 3, 200));
  environment.setShadowFocus(); environment.setScene('north-atlantic', false); environment.syncLighting();
  expect(water.lighting!.sunLight.target.position).toEqual(anchor.position);
});
