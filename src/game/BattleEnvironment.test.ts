import { expect, test } from 'bun:test';
import { Color, DirectionalLight, Group, Vector3 } from 'three/webgpu';
import { RecordingSky } from './sky/testing';
import { OCEAN_MAPS, oceanMap } from '../maps/catalog';
import { battleEnvironment, TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '../maps/conditions';
import { PORT_WIND, VisualEnvironment } from './VisualEnvironment';
import { validateBattleSetup } from './session/battleSetup';

/** The ocean parameters the environment writes to. */
function fakeOcean() {
  return {
    waves: { significantHeight: 0, windSpeed: 0, windDirection: 0, peakWavelength: 0, choppiness: 0, gamma: 0, directionalSharpness: .8, seed: 1, dirty: false },
    colors: { waterColor: new Color(), transmissionColor: new Color(), absorptionColor: new Color() },
    foam: { crest: { crestStrength: 0, windwardStrength: 0, decayTime: 0, color: new Color(), opacity: 0, windStretch: 0 },
      surface: { color: new Color(), opacity: 0, coverage: 0 }, shoreline: { color: new Color(), opacity: 0 } },
    fog: { color: new Color(), start: 0, end: 0, power: 0, skyBlendDistance: 0 },
    sun: { direction: new Vector3(), intensity: 0, color: new Color() },
    environmentIntensity: 1,
  };
}
function windSink() { return { wind: [] as number[], setWind(speed: number, direction: number) { this.wind = [speed, direction]; } }; }
/** The game hands the environment its scene sun; each test gets a fresh one. */
function attachOcean(environment: VisualEnvironment, ocean: ReturnType<typeof fakeOcean>): DirectionalLight {
  const sunLight = new DirectionalLight();
  environment.attachOcean(ocean as never, sunLight);
  return sunLight;
}

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
      expect(environment.waves.significantHeightM).toBeGreaterThan(0);
      expect(environment.waves.windSpeed).toBe(weather.waves.windSpeed * map.water.windScale);
      expect(environment.waves).toEqual(battleEnvironment(map, time.id, weather.id, { windSpeed: environment.waves.windSpeed }).waves);
    }
  }
  expect(JSON.stringify(OCEAN_MAPS)).toBe(original);
  for (const value of ['missing', '', null, 7]) {
    expect(() => validateBattleSetup({ ...setup, timeOfDay: value as never }, ['bismarck'])).toThrow('time of day');
    expect(() => validateBattleSetup({ ...setup, weather: value as never }, ['bismarck'])).toThrow('weather preset');
  }
});

test('weather drives live waves across maps, overrides obsolete settings, and restores the port\'s standing wind', () => {
  const ocean = fakeOcean();
  const effects = { ...windSink(), setSun() {}, setIllumination() {} }, funnelSmoke = windSink();
  const environment = new VisualEnvironment({ effects, funnelSmoke, sunAnchor: new Group() });
  attachOcean(environment, ocean);
  let mapId = OCEAN_MAPS[0].id;
  for (const map of OCEAN_MAPS) {
    mapId = map.id;
    let previous = 0;
    for (const weather of ['clear', 'partly-cloudy', 'overcast', 'storm-clouds'] as const) {
      environment.setBattle({ timeOfDay: 'map', weather, conditions: {} });
      environment.setScene(map.id, false);
      const expected = battleEnvironment(map, 'map', weather).waves;
      expect(ocean.waves.significantHeight).toBe(expected.significantHeightM);
      expect(ocean.waves.windSpeed).toBe(expected.windSpeed);
      expect(ocean.waves.peakWavelength).toBe(expected.peakWavelength);
      expect(expected.significantHeightM).toBeGreaterThan(previous);
      expect(ocean.waves.windDirection).toBe(map.water.windDirection * Math.PI / 180);
      expect(effects.wind).toEqual([expected.windSpeed, ocean.waves.windDirection]);
      expect(funnelSmoke.wind).toEqual(effects.wind);
      expect(ocean.waves.dirty).toBe(true);
      previous = expected.significantHeightM;
    }
    environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: {} }); environment.setScene(map.id, false);
    expect(ocean.waves.significantHeight).toBe(battleEnvironment(map, 'map', 'clear').waves.significantHeightM);
  }
  environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: { timeHours: 0 } }); environment.setScene(mapId, false);
  const nightWater = ocean.colors.waterColor.clone(), nightFoam = ocean.foam.crest.color.clone();
  environment.setScene(mapId, false);
  expect(ocean.colors.waterColor).toEqual(nightWater);
  expect(ocean.foam.crest.color).toEqual(nightFoam);
  environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: { timeHours: 12 } }); environment.setScene(mapId, false);
  const dayPalette = oceanMap(mapId).water;
  expect(ocean.colors.waterColor).toEqual(new Color(dayPalette.waterColor));
  expect(ocean.colors.absorptionColor).toEqual(new Color(dayPalette.absorptionColor));
  expect(ocean.foam.crest.color).toEqual(new Color(1, 1, 1));
  environment.setBattle({ timeOfDay: 'map', weather: 'fog', conditions: { timeHours: 0 } }); environment.setScene(mapId, false);
  environment.setScene(mapId, true);
  expect(ocean.colors.waterColor).toEqual(new Color(oceanMap('north-atlantic').water.waterColor));
  // The port's 9 m/s is the calibrated sea a battle resolves for that wind, on the berth's map.
  const port = battleEnvironment(oceanMap(mapId), 'map', 'map', { windSpeed: PORT_WIND.speed }).waves;
  expect(port.significantHeightM).toBeCloseTo(1.8 * oceanMap(mapId).water.amplitudeScale);
  expect(ocean.waves.significantHeight).toBe(port.significantHeightM);
  expect(ocean.waves.windSpeed).toBe(9);
  expect(ocean.waves.peakWavelength).toBe(port.peakWavelength);
  expect(ocean.waves.choppiness).toBe(port.choppiness);
  expect(ocean.waves.gamma).toBe(2.6);
  expect(ocean.foam.crest.crestStrength).toBe(port.crestFoam);
  expect(ocean.foam.crest.windwardStrength).toBe(port.windwardFoam);
  expect(ocean.foam.crest.decayTime).toBe(2.8);
  expect(effects.wind).toEqual([9, 35 * Math.PI / 180]);
  expect(funnelSmoke.wind).toEqual(effects.wind);
});

test('night, fog and storm lighting reach the live uniforms; the sky stays fixed and port restores daylight', () => {
  const sky = new RecordingSky();
  const ocean = fakeOcean(), effects = lightSink();
  const environment = new VisualEnvironment({ effects, funnelSmoke: windSink(), sunAnchor: new Group() });
  attachOcean(environment, ocean); environment.attachSky(sky);
  for (const time of TIME_OF_DAY_PRESETS) for (const weather of WEATHER_PRESETS) {
    environment.setBattle({ timeOfDay: time.id, weather: weather.id, conditions: {} });
    environment.setScene('pacific-islands', false);
    sky.update(0);
    // No ocean update occurs on a paused frame; the sky must still reach smoke.
    environment.syncLighting();
    const expected = battleEnvironment(oceanMap('pacific-islands'), time.id, weather.id);
    expect(sky.sun.elevationDeg).toBeCloseTo(expected.sky.elevation, 8);
    expect((sky.sun.azimuthDeg + 360) % 360).toBeCloseTo(expected.sky.azimuth, 8);
    // Battle time stands still: sky time passing moves neither body.
    const direction = sky.sun.direction.clone();
    sky.update(600);
    expect(sky.sun.direction.distanceTo(direction)).toBeLessThan(1e-10);
    expect(sky.coverage).toBe(expected.sky.coverage);
    expect(sky.scene.weather.precipitation).toBe(expected.precipitation);
    expect(sky.scene.weather.lightning).toBe(expected.lightning);
    expect(ocean.fog.end).toBe(expected.fog.end);
    // The authored ambient reaches smoke whole; meshes take its daylight share (checked below).
    expect(environment.diagnostics().environment!.ambient).toBe(expected.sky.ambient);
    expect(effects.ambient).toBe(expected.sky.ambient);
    if (time.id === 'night') {
      expect(sky.light.night).toBe(true);
      expect(sky.moon.direction.y).toBeGreaterThan(0);
      // Night keeps a dim authored ambient; moonlit meshes take 1.6 times it so hulls stay readable.
      expect(environment.diagnostics().environment!.ambient).toBeLessThan(.5);
      expect(environment.ambientLight.intensity).toBeCloseTo(expected.sky.ambient * 1.6, 10);
      expect(ocean.fog.color.getHexString()).toBe('182839');
      expect(effects.direct).toBeLessThan(1);
      expect(effects.direct).toBeGreaterThan(0);
    } else if (sky.sun.elevationDeg >= 18) expect(effects.direct).toBeCloseTo(sky.scene.sun.intensity);
    else expect(effects.direct).toBeLessThan(sky.scene.sun.intensity);
  }
  environment.setScene('pacific-islands', true); sky.update(0);
  expect(sky.sun.elevationDeg).toBeCloseTo(36);
  expect(sky.sun.azimuthDeg).toBeCloseTo(58);
  expect(sky.scene.sun.intensity).toBe(5.8);
  expect(environment.diagnostics().environment!.ambient).toBe(1.75);
  expect(sky.coverage).toBe(.38);
  expect(sky.scene.clouds.windSpeed).toBe(12);
  expect(sky.scene.clouds.ambient).toBe(1.1);
  expect(sky.scene.clouds.baseShadow).toBe(.2);
  expect(sky.scene.weather).toEqual({ precipitation: 0, lightning: 0 });
  expect(ocean.fog.color.getHexString()).toBe('819aa5');
  expect(ocean.fog.end).toBe(5600);
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
    expect(calmNight.waves.significantHeightM).toBe(0);
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
  const sky = new RecordingSky();
  const ocean = fakeOcean(), effects = lightSink();
  const environment = new VisualEnvironment({ effects, funnelSmoke: windSink(), sunAnchor: new Group() });
  const sunLight = attachOcean(environment, ocean); environment.attachSky(sky);
  for (const hour of [0, 5.5, 6, 7, 12, 24]) {
    environment.setBattle({ timeOfDay: 'map', weather: 'map', conditions: { timeHours: hour } });
    environment.setScene('north-atlantic', false); sky.update(0);
    environment.syncLighting(); // Deliberately no ocean update.
    expect(ocean.sun.intensity).toBeCloseTo(effects.direct);
    // By day meshes take about half the raw sun the sea shades with and a daylight share of the
    // unoccluded fill. Moonlit meshes take 1.5 times the moon and 1.6 times the fill; the sea keeps the raw moon.
    const moonlit = ocean.sun.direction.equals(sky.moon.direction);
    if (hour === 0 || hour === 24 || hour === 12) expect(moonlit).toBe(hour !== 12);
    expect(sunLight.intensity).toBeCloseTo(effects.direct * (moonlit ? 1.5 : .55));
    const fill = environment.ambientLight.intensity / environment.diagnostics().environment!.ambient;
    if (moonlit) { expect(fill).toBeCloseTo(1.6, 10); expect(ocean.environmentIntensity).toBe(1); }
    else {
      if (effects.direct >= 4) { expect(fill).toBeCloseTo(.33, 10); expect(ocean.environmentIntensity).toBeCloseTo(.66, 10); }
      if (effects.direct <= 1) { expect(fill).toBe(1); expect(ocean.environmentIntensity).toBe(1); }
      expect(fill).toBeGreaterThanOrEqual(.33 - 1e-9);
      expect(fill).toBeLessThanOrEqual(1);
    }
    expect(ocean.sun.direction.y).toBeGreaterThanOrEqual(0);
    if (hour === 0 || hour === 24) {
      expect(ocean.sun.intensity).toBeGreaterThan(.3);
      expect(ocean.sun.direction.distanceTo(sky.moon.direction)).toBeLessThan(1e-8);
    }
    if (hour === 6) {
      expect(effects.direct).toBeLessThan(1);
      expect(ocean.sun.color.r).toBeGreaterThan(ocean.sun.color.b);
    }
    if (hour === 12) expect(ocean.sun.intensity).toBeCloseTo(sky.scene.sun.intensity);
  }
});

test('distant shadow focus persists across lighting syncs and restores the port and player anchors', () => {
  const sky = new RecordingSky();
  const ocean = fakeOcean();
  const anchor = new Group(); anchor.position.set(100, 3, 200);
  const environment = new VisualEnvironment({ effects: lightSink(), funnelSmoke: windSink(), sunAnchor: anchor });
  const sunLight = attachOcean(environment, ocean); environment.attachSky(sky);
  environment.setScene('north-atlantic', false);
  const focus = new Vector3(20000, 0, 15000);
  environment.setShadowFocus(focus); environment.syncLighting(); environment.syncLighting();
  expect(sunLight.target.position).toEqual(focus);
  environment.setScene('north-atlantic', true); environment.syncLighting();
  expect(sunLight.target.position).toEqual(anchor.position);
  environment.setShadowFocus(); environment.setScene('north-atlantic', false); environment.syncLighting();
  expect(sunLight.target.position).toEqual(anchor.position);
});

test('developer overrides replace only what they name, in port and at sea, until the next scene', () => {
  const sky = new RecordingSky();
  const ocean = fakeOcean(), effects = { ...windSink(), setSun() {}, setIllumination() {} };
  const environment = new VisualEnvironment({ effects, funnelSmoke: windSink(), sunAnchor: new Group() });
  attachOcean(environment, ocean); environment.attachSky(sky);
  const map = oceanMap('north-atlantic');

  // Port: wind alone raises the sea; the sheltered light, clouds and fog stay.
  environment.setScene(map.id, true);
  const standing = battleEnvironment(map, 'map', 'map', { windSpeed: PORT_WIND.speed });
  expect(ocean.waves.significantHeight).toBe(standing.waves.significantHeightM);
  expect(sky.scene.clouds.windSpeed).toBe(standing.cloudWind);
  // Naming the standing wind changes nothing: the reading already was the sea.
  environment.setOverrides({ windSpeed: PORT_WIND.speed });
  expect(ocean.waves.significantHeight).toBe(standing.waves.significantHeightM);
  expect(ocean.waves.peakWavelength).toBe(standing.waves.peakWavelength);
  environment.setOverrides({ windSpeed: 20 });
  const windy = battleEnvironment(map, 'map', 'map', { windSpeed: 20 }).waves;
  expect(ocean.waves.significantHeight).toBe(windy.significantHeightM);
  expect(ocean.waves.windSpeed).toBe(20);
  expect(ocean.waves.windDirection).toBe(35 * Math.PI / 180);
  expect(sky.sun.elevationDeg).toBeCloseTo(36);
  expect(sky.coverage).toBe(.38);
  expect(sky.scene.clouds.windSpeed).toBe(battleEnvironment(map, 'map', 'map', { windSpeed: 20 }).cloudWind);
  expect(ocean.fog.end).toBe(5600);
  expect(environment.reading()).toMatchObject({ timeHours: undefined, windSpeed: 20, windDirection: 35, visibilityKm: 5.6, moonPhase: .5, precipitation: 0 });
  // Clouds drift the way the port's wind blows: toward 35° from +X, a compass heading of 55°.
  expect(sky.scene.clouds.windHeading).toBeCloseTo(55);

  // Port: time, clouds, direction and visibility each reach their uniforms.
  environment.setOverrides({ timeHours: 18, cloudCover: 80, windDirection: 270, visibilityKm: 2.8 });
  expect(ocean.waves.significantHeight).toBe(standing.waves.significantHeightM);
  expect(sky.sun.elevationDeg).toBeCloseTo(battleEnvironment(map, 'map', 'map', { timeHours: 18 }).sky.elevation, 6);
  expect(sky.coverage).toBe(.8);
  expect(ocean.waves.windDirection).toBeCloseTo(270 * Math.PI / 180);
  expect(ocean.fog.end).toBeCloseTo(2800);
  expect(ocean.fog.start).toBeCloseTo(325);
  expect(environment.reading()).toMatchObject({ timeHours: 18, cloudCover: 80, windDirection: 270 });

  // Battle: overrides sit on the chosen conditions, the air map's far fog
  // still wins, and a new scene drops them.
  environment.setBattle({ timeOfDay: 'map', weather: 'map', conditions: { timeHours: 12, cloudCover: 38, windSpeed: 9 } });
  environment.setScene(map.id, false);
  expect(environment.getOverrides()).toEqual({});
  environment.setOverrides({ cloudCover: 95, windSpeed: 22, visibilityKm: 12 });
  const storm = battleEnvironment(map, 'map', 'map', { timeHours: 12, cloudCover: 95, windSpeed: 22 });
  expect(ocean.waves.significantHeight).toBe(storm.waves.significantHeightM);
  expect(sky.coverage).toBe(.95);
  expect(sky.sun.elevationDeg).toBeCloseTo(70);
  expect(ocean.fog.end).toBeCloseTo(12000);
  environment.setChartFog(true); expect(ocean.fog.end).toBe(900000);
  environment.setChartFog(false); expect(ocean.fog.end).toBeCloseTo(12000);
  // Rain, lightning and the moon's phase are developer overrides too; rain reads in percent.
  environment.setOverrides({ cloudCover: 95, windSpeed: 22, visibilityKm: 12, precipitation: 40, lightning: 6, moonPhase: .25 });
  expect(sky.scene.weather).toEqual({ precipitation: .4, lightning: 6 });
  expect(sky.moon.phase).toBe(.25);
  expect(environment.reading()).toMatchObject({ precipitation: 40, lightning: 6, moonPhase: .25 });
  environment.setOverrides({ cloudCover: 95, windSpeed: undefined });
  expect(environment.getOverrides()).toEqual({ cloudCover: 95 });
  expect(ocean.waves.windSpeed).toBe(9);
  environment.setScene(map.id, true);
  expect(environment.getOverrides()).toEqual({});
  expect(ocean.waves.significantHeight).toBe(standing.waves.significantHeightM);
  expect(sky.coverage).toBe(.38);
});
