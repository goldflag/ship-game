import { expect, test } from 'bun:test';
import { Color } from 'three/webgpu';
import type { SkyScene } from '../contracts';
import { DEFAULT_SKY_SCENE, SkyState } from '../state';
import { Atmosphere } from './Atmosphere';
import { ATMOSPHERE_TOP, MIE_HEIGHT, PLANET_RADIUS, RAYLEIGH_HEIGHT, SKY_GRADE, SUN_GRADE, airCoefficients, aureolePhase, opticalDepth, phaseTerms,
  seaLevelLight, skyIrradiance, twilightLift, type Rgb } from './model';

const scene = (elevation: number, overrides: Partial<SkyScene['atmosphere']> = {}): SkyScene =>
  ({ ...structuredClone(DEFAULT_SKY_SCENE), sun: { elevation, azimuth: 270, intensity: 6 }, atmosphere: { ...DEFAULT_SKY_SCENE.atmosphere, ...overrides } });
const peak = (color: Color) => Math.max(color.r, color.g, color.b);
const ramp = (elevation: number) => SUN_GRADE.floor + (1 - SUN_GRADE.floor) * Math.min(1, Math.max(0, elevation / SUN_GRADE.full)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, elevation / SUN_GRADE.full)));

function sunAt(elevation: number, overrides?: Partial<SkyScene['atmosphere']>): Color {
  const out = { sun: new Color(), moon: new Color() }, applied = scene(elevation, overrides);
  seaLevelLight(applied, airCoefficients(applied.atmosphere), { irradiance: [0, 0, 0], elevationDeg: -30 }, out);
  return out.sun;
}

test('a high sun lights the sea white at the scene intensity, with the tint the scene light always had', () => {
  for (const elevation of [35, 60, 90]) {
    const sun = sunAt(elevation);
    expect(peak(sun)).toBeCloseTo(6, 5);
    expect(sun.g / sun.r).toBeGreaterThan(.88);
    expect(sun.b / sun.r).toBeGreaterThan(.72);
  }
  const overhead = sunAt(90);
  expect(overhead.g / overhead.r).toBeCloseTo(SUN_GRADE.tint.g, 5);
  expect(overhead.b / overhead.r).toBeCloseTo(SUN_GRADE.tint.b, 5);
});

test('a low sun is warmer and dimmer, never darker than the readability ramp, and gone below the horizon', () => {
  let previous = sunAt(60);
  for (const elevation of [20, 10, 5, 2]) {
    const sun = sunAt(elevation);
    expect(sun.r).toBeGreaterThan(sun.g);
    expect(sun.g).toBeGreaterThan(sun.b);
    // Warmer and no brighter than a higher sun.
    expect(sun.b / sun.r).toBeLessThan(previous.b / previous.r);
    expect(peak(sun)).toBeLessThanOrEqual(peak(previous) + 1e-9);
    // Readable: the game's old ramp is the floor while the disc is up.
    expect(peak(sun)).toBeGreaterThanOrEqual(6 * ramp(elevation) - 1e-9);
    previous = sun;
  }
  const golden = sunAt(5);
  expect(golden.b / golden.r).toBeLessThan(.5);
  for (const elevation of [-1.5, -5, -30]) expect(peak(sunAt(elevation))).toBe(0);
});

test('moonlight reaches the sea once the moon is up and fades out as it sets', () => {
  const out = { sun: new Color(), moon: new Color() }, applied = scene(-30), air = airCoefficients(applied.atmosphere);
  const irradiance: Rgb = [.36, .47, .7];
  seaLevelLight(applied, air, { irradiance, elevationDeg: 30 }, out);
  expect(out.moon.r).toBeCloseTo(.36 * .8, 6);
  expect(out.moon.b).toBeCloseTo(.7 * .8, 6);
  seaLevelLight(applied, air, { irradiance, elevationDeg: 2 }, out);
  expect(peak(out.moon)).toBeGreaterThan(0);
  expect(peak(out.moon)).toBeLessThan(.7 * .8);
  seaLevelLight(applied, air, { irradiance, elevationDeg: -3 }, out);
  expect(peak(out.moon)).toBe(0);
});

test('the authored atmosphere maps monotonically onto the coefficients', () => {
  const base = DEFAULT_SKY_SCENE.atmosphere;
  const at = (overrides: Partial<SkyScene['atmosphere']>) => airCoefficients({ ...base, ...overrides });
  const increasing = (values: number[]) => values.every((value, i) => i === 0 || value > values[i - 1]);
  expect(increasing([.25, .4, .55].map(rayleigh => at({ rayleigh }).rayleigh[2]))).toBe(true);
  expect(increasing([1.5, 2.2, 3.2, 4.8, 6].map(turbidity => at({ turbidity }).mieScattering[1]))).toBe(true);
  expect(increasing([1.5, 2.2, 3.2, 4.8, 6].map(turbidity => at({ turbidity }).mieExtinction[1]))).toBe(true);
  expect(increasing([.08, .2, .36].map(mie => at({ mie }).mieGain))).toBe(true);
  expect(increasing([.8, 1, 1.5].map(multiple => at({ multiple }).multiple))).toBe(true);
  expect(at({ mieG: .72 }).mieG).toBe(.72);
  expect(at({ mieG: .99 }).mieG).toBeLessThan(.9);
  // Earth's air at the authored unit, and haze that grows with turbidity above pure air.
  expect(at({ rayleigh: .4 }).rayleigh[2]).toBeCloseTo(33.1e-3, 9);
  expect(at({ turbidity: 1 }).mieScattering[1]).toBe(0);
  // Molecules scatter blue most; aerosol scatters as grey and absorbs a little.
  const air = at({});
  expect(air.rayleigh[2] / air.rayleigh[0]).toBeGreaterThan(5);
  expect(air.mieExtinction[1]).toBeGreaterThan(air.mieScattering[1]);
});

test('the phase terms the shaders take reproduce the aerosol lobe and its gain', () => {
  for (const [g, gain] of [[.55, .8], [.65, 1.3], [.72, 2]]) {
    const { lobe, core } = phaseTerms(g, gain);
    for (const nu of [-1, -.3, 0, .5, .9, .99, 1]) {
      const folded = lobe[0] * (1 + nu * nu) * Math.max(1e-4, lobe[1] - lobe[2] * nu) ** -1.5 + core[0] * Math.max(1e-4, core[1] - core[2] * nu) ** -1.5;
      expect(folded / (aureolePhase(nu, g) * gain)).toBeCloseTo(1, 9);
    }
  }
});

test('optical depth integrates the exponential profiles and grows toward the horizon', () => {
  const air = airCoefficients({ rayleigh: .4, turbidity: 1, mie: .25, mieG: .7, multiple: 1 });
  const out: Rgb = [0, 0, 0];
  opticalDepth({ ...air, ozone: [0, 0, 0] }, PLANET_RADIUS, 1, out);
  const column = (1 - Math.exp(-(ATMOSPHERE_TOP - PLANET_RADIUS) / RAYLEIGH_HEIGHT)) * RAYLEIGH_HEIGHT;
  for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(air.rayleigh[c] * column, 3);
  const zenith = out[2];
  opticalDepth(air, PLANET_RADIUS, Math.sin(5 * Math.PI / 180), out);
  expect(out[2]).toBeGreaterThan(8 * zenith);
  opticalDepth(air, PLANET_RADIUS + 1, -.5, out);
  expect(out[0]).toBe(Infinity);
  // Aerosol lives low: its column is its sea-level coefficient times its scale height.
  const hazy = airCoefficients({ rayleigh: 0, turbidity: 3, mie: .25, mieG: .7, multiple: 1 });
  opticalDepth({ ...hazy, ozone: [0, 0, 0] }, PLANET_RADIUS, 1, out);
  expect(out[1]).toBeCloseTo(hazy.mieExtinction[1] * MIE_HEIGHT, 3);
});

test('the sky opens up through twilight and holds once the sun is well down', () => {
  expect(twilightLift(40)).toBe(1);
  expect(twilightLift(3)).toBe(1);
  let previous = 1;
  for (let elevation = 2; elevation >= -10; elevation -= .5) {
    const lift = twilightLift(elevation);
    expect(lift).toBeGreaterThan(previous);
    previous = lift;
  }
  expect(twilightLift(-40)).toBe(twilightLift(-10));
});

test('the sky lights the sea blue by day and leaves only the night glow once the sun is gone', () => {
  const air = airCoefficients(DEFAULT_SKY_SCENE.atmosphere), state = new SkyState();
  const irradianceAt = (elevation: number) => {
    state.model.set(elevation, 270, .5);
    return skyIrradiance(air, state.model.sun, 6, twilightLift(elevation), new Color());
  };
  const noon = irradianceAt(60);
  expect(noon.b).toBeGreaterThan(noon.g);
  expect(noon.g).toBeGreaterThan(noon.r);
  // Around a sixth of the direct sun on a clear day.
  expect(noon.g).toBeGreaterThan(.4);
  expect(noon.g).toBeLessThan(2);
  expect(irradianceAt(10).g).toBeLessThan(noon.g);
  const night = irradianceAt(-40), glow = Math.PI * SKY_GRADE.floor[2] * (1 + SKY_GRADE.floorHorizon * .5 ** 4);
  expect(night.b).toBeCloseTo(glow, 6);
});

test('the atmosphere part shares its sea-level light with the celestial light the scene uses', () => {
  const state = new SkyState(), atmosphere = new Atmosphere(state.uniforms);
  const choose = (applied: SkyScene) => { state.apply(applied); atmosphere.apply(applied); state.chooseLight(atmosphere.seaLevel, 0); return state.light; };
  const noon = choose(scene(60));
  expect(noon.night).toBe(false);
  expect(noon.intensity).toBeCloseTo(6, 5);
  expect(noon.color.r).toBeCloseTo(1, 6);
  const dusk = choose(scene(4));
  expect(dusk.night).toBe(false);
  expect(dusk.intensity).toBeLessThan(6);
  expect(dusk.color.b).toBeLessThan(dusk.color.g);
  const night = choose({ ...scene(-28), moon: { phase: .5 } });
  expect(night.night).toBe(true);
  expect(night.direction.y).toBeGreaterThan(0);
  expect(night.color.b).toBeGreaterThan(night.color.r);
  atmosphere.dispose();
});
