/** The air as numbers: the planet, the density of each scatterer with altitude, the coefficients an
 * authored scene maps onto, optical depth along any ray and the light that reaches the sea. Renderer-
 * free: the GPU passes (`luts.ts`) evaluate the same profiles, the CPU derives the scene light from
 * them, and the tests check both ends of the day without a GPU.
 *
 * Lengths are kilometres and coefficients per kilometre (the shaders use the same units, which keep
 * float32 comfortable at the planet's radius). The model follows Hillaire (EGSR 2020): Rayleigh and Mie
 * scattering with exponential profiles, ozone absorption in a tent around 25 km, and the RGB channels
 * standing for 680, 550 and 440 nm. */
import { Color, MathUtils } from 'three/webgpu';
import type { SkyScene } from '../contracts';

export type Rgb = [number, number, number];

/** Sea-level radius of the planet and the top of its air (km). The top clears the ozone layer. */
export const PLANET_RADIUS = 6360, ATMOSPHERE_TOP = 6460;
/** Scale heights (km) of the molecules and of the maritime aerosol. */
export const RAYLEIGH_HEIGHT = 8, MIE_HEIGHT = 1.2;
/** Ozone's tent: absorption peaks at 25 km and falls to nothing 15 km above and below. */
export const OZONE_PEAK = 25, OZONE_HALF_WIDTH = 15;
/** Molecular scattering of Earth's air at sea level (per km): Hillaire's values. */
const EARTH_RAYLEIGH: Rgb = [5.802e-3, 13.558e-3, 33.1e-3];
/** Ozone's peak absorption (per km). Its Chappuis band takes orange and green light, which keeps the
 * twilight zenith blue. Hillaire's monochromatic 680 nm value (0.65e-3) sits beyond the band's 600 nm
 * peak, so an RGB sky lets red through the ozone at dusk and turns the blue hour magenta; a red channel
 * that spans the band, as a camera's or the eye's does, absorbs about as much as green. */
const OZONE_ABSORPTION: Rgb = [2.4e-3, 3e-3, .136e-3];
/** Aerosol scattering at sea level per unit of turbidity above pure air (per km at 550 nm): Preetham's
 * turbidity is the total optical depth over the molecular one, and the authored skies' 1.5–6 span
 * clear maritime air (aerosol depth ≈ 0.03) to thick haze (≈ 0.33). */
const AEROSOL_PER_TURBIDITY = .027;
/** Ångström exponent. Grey: a wavelength-dependent haze tints the long horizon path brown, where sea
 * haze reads white to blue-grey. */
const ANGSTROM = 0;
/** Aerosol single-scattering albedo: sea salt and sulphate absorb little. */
const AEROSOL_ALBEDO = .93;
/** Wavelengths (nm) the three channels stand for. */
const WAVELENGTHS: Rgb = [680, 550, 440];
/** Albedo of the sea under diffuse light: what it returns to the air and the cloud bases. */
export const SEA_ALBEDO = .06;

/** Gains from the authored scene (Sky Pro's scales, tuned by eye on the game's maps) onto the model.
 * `rayleigh` .4 is Earth's molecular air; `mie` .25 is the physical aureole; `multiple` is a gain on
 * the multiple-scattering fill; `mieG` is used as authored (Cornette–Shanks asymmetry). */
export const AUTHORED = { rayleighEarth: .4, mieUnit: .25, mieExponent: .7, mieGMax: .85 };

/** What the air is made of for one scene, in the shaders' units. */
export interface AirCoefficients {
  /** Molecular scattering at sea level (per km). Molecules do not absorb. */
  readonly rayleigh: Rgb;
  /** Aerosol scattering and extinction at sea level (per km). */
  readonly mieScattering: Rgb;
  readonly mieExtinction: Rgb;
  /** Ozone absorption at the layer's peak (per km). */
  readonly ozone: Rgb;
  /** Cornette–Shanks asymmetry of the aerosol. */
  readonly mieG: number;
  /** Gain on the aerosol's single scattering: the strength of the aureole around the sun and moon. */
  readonly mieGain: number;
  /** Gain on multiple scattering. */
  readonly multiple: number;
}

/** Map a scene's authored atmosphere onto the model's coefficients. Each gain is monotonic in its input. */
export function airCoefficients(atmosphere: SkyScene['atmosphere']): AirCoefficients {
  const molecules = Math.max(0, atmosphere.rayleigh) / AUTHORED.rayleighEarth;
  const aerosol = AEROSOL_PER_TURBIDITY * Math.max(0, atmosphere.turbidity - 1);
  const mieScattering = WAVELENGTHS.map(nm => aerosol * (nm / 550) ** -ANGSTROM) as Rgb;
  return {
    rayleigh: EARTH_RAYLEIGH.map(value => value * molecules) as Rgb,
    mieScattering,
    mieExtinction: mieScattering.map(value => value / AEROSOL_ALBEDO) as Rgb,
    ozone: [...OZONE_ABSORPTION],
    mieG: MathUtils.clamp(atmosphere.mieG, 0, AUTHORED.mieGMax),
    mieGain: (Math.max(0, atmosphere.mie) / AUTHORED.mieUnit) ** AUTHORED.mieExponent,
    multiple: Math.max(0, atmosphere.multiple),
  };
}

/** Relative densities at an altitude (km): molecules, aerosol, ozone. */
export function densities(altitude: number): Rgb {
  const h = Math.max(0, altitude);
  return [Math.exp(-h / RAYLEIGH_HEIGHT), Math.exp(-h / MIE_HEIGHT), Math.max(0, 1 - Math.abs(h - OZONE_PEAK) / OZONE_HALF_WIDTH)];
}

/** Extinction (per km) at an altitude, into `out`. */
export function extinction(air: AirCoefficients, altitude: number, out: Rgb): Rgb {
  const [rayleigh, mie, ozone] = densities(altitude);
  for (let c = 0; c < 3; c++) out[c] = air.rayleigh[c] * rayleigh + air.mieExtinction[c] * mie + air.ozone[c] * ozone;
  return out;
}

/** Distance (km) from radius `r` along a ray with zenith cosine `mu` to the top of the air. */
export function distanceToTop(r: number, mu: number): number {
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + ATMOSPHERE_TOP * ATMOSPHERE_TOP)));
}

/** True when a ray from radius `r` with zenith cosine `mu` meets the sea. */
export function hitsGround(r: number, mu: number): boolean {
  return mu < 0 && r * r * (mu * mu - 1) + PLANET_RADIUS * PLANET_RADIUS >= 0;
}

/** Zenith cosine of the geometric horizon seen from radius `r`. */
export function horizonCosine(r: number): number {
  const ratio = PLANET_RADIUS / Math.max(r, PLANET_RADIUS);
  return -Math.sqrt(Math.max(0, 1 - ratio * ratio));
}

const step: Rgb = [0, 0, 0];
/** Optical depth from radius `r` along zenith cosine `mu` to the top of the air, into `out`; infinite
 * where the ray meets the sea. Samples crowd toward the start, where the air is densest. */
export function opticalDepth(air: AirCoefficients, r: number, mu: number, out: Rgb, samples = 96): Rgb {
  if (hitsGround(r, mu)) { out[0] = out[1] = out[2] = Infinity; return out; }
  out[0] = out[1] = out[2] = 0;
  const length = distanceToTop(r, mu);
  let previous = 0;
  for (let i = 1; i <= samples; i++) {
    const t = length * (i / samples) ** 2, middle = (t + previous) / 2, dt = t - previous;
    previous = t;
    const radius = Math.sqrt(r * r + middle * middle + 2 * r * middle * mu);
    extinction(air, radius - PLANET_RADIUS, step);
    for (let c = 0; c < 3; c++) out[c] += step[c] * dt;
  }
  return out;
}

/** Transmittance from sea level toward a body at `elevationDeg`, into `out`: zero below the horizon. */
export function seaTransmittance(air: AirCoefficients, elevationDeg: number, out: Rgb): Rgb {
  opticalDepth(air, PLANET_RADIUS, Math.sin(elevationDeg * MathUtils.DEG2RAD), out);
  for (let c = 0; c < 3; c++) out[c] = Number.isFinite(out[c]) ? Math.exp(-out[c]) : 0;
  return out;
}

/** The sky's own exposure as the sun sets: (sun elevation°, gain) pairs, interpolated in log. A camera or
 * the eye opens up at dusk; without this the afterglow and the blue hour would be a thousandth of daylight
 * and read as black. The gain holds past the last pair: the sun's scattering fades out beneath it on its
 * own, handing the sky to the moon and the night floor. Tuned against the physical zenith, which falls
 * about tenfold for each 2–3° of solar depression, so the displayed twilight dims steadily instead. */
export const TWILIGHT: readonly (readonly [number, number])[] = [[3, 1], [0, 3.5], [-2, 7.5], [-4, 18], [-6, 70], [-8, 260], [-10, 600]];
export function twilightLift(sunElevationDeg: number): number {
  const first = TWILIGHT[0], last = TWILIGHT[TWILIGHT.length - 1];
  if (sunElevationDeg >= first[0]) return first[1];
  if (sunElevationDeg <= last[0]) return last[1];
  const upper = TWILIGHT.findIndex(([elevation]) => elevation < sunElevationDeg);
  const [e1, g1] = TWILIGHT[upper - 1], [e0, g0] = TWILIGHT[upper];
  return Math.exp(MathUtils.lerp(Math.log(g0), Math.log(g1), (sunElevationDeg - e0) / (e1 - e0)));
}

/** The dome's grade over the physical sky, shared by the shaders and the CPU:
 * - `gain`: overall exposure of scattered light (a camera's sky, a little brighter than the eye's);
 * - `saturation`: chroma of scattered light about its luminance, for a deep zenith and a warm aureole;
 * - `moon`: share of the (already lifted) moonlight the night air scatters, so the moonlit horizon sits at
 *   the battle night fog (#182839) that distant ships fade into;
 * - `floor`: the night's own glow (airglow and starlight, linear radiance at the zenith) and how much
 *   brighter it is at the horizon, so a moonless sky is dark navy, never black;
 * - `shoulder`: luminance above `knee` rolls off toward `ceiling`, so the glare around a low sun stays under
 *   the display's bloom threshold instead of hazing the ships seen against it. */
export const SKY_GRADE = { gain: 1.6, saturation: 1.3, moon: .25, floor: [.006, .0105, .02] as Rgb, floorHorizon: .5, shoulder: { knee: .45, ceiling: .95 } };

/** Radiance of the night floor along a direction's vertical component. */
export function nightFloor(y: number, out: Rgb): Rgb {
  const horizon = 1 + SKY_GRADE.floorHorizon * (1 - Math.abs(y)) ** 4;
  for (let c = 0; c < 3; c++) out[c] = SKY_GRADE.floor[c] * horizon;
  return out;
}

/** The aerosol's single-scattering phase: the authored Cornette–Shanks lobe with a share of its light in a
 * narrow forward core (Henyey–Greenstein), as real haze's diffraction peak concentrates it. The core keeps
 * a bright, tight aureole round the sun and moon while the wide lobe no longer bleaches the sky around them. */
export const AUREOLE = { core: .35, coreG: .92 };

export const rayleighPhase = (nu: number) => 3 / (16 * Math.PI) * (1 + nu * nu);
export const miePhase = (nu: number, g: number) => 3 / (8 * Math.PI) * (1 - g * g) * (1 + nu * nu) / ((2 + g * g) * Math.max(1e-4, 1 + g * g - 2 * g * nu) ** 1.5);
const henyeyGreenstein = (nu: number, g: number) => (1 - g * g) / (4 * Math.PI * Math.max(1e-4, 1 + g * g - 2 * g * nu) ** 1.5);
export const aureolePhase = (nu: number, g: number) => (1 - AUREOLE.core) * miePhase(nu, g) + AUREOLE.core * henyeyGreenstein(nu, AUREOLE.coreG);

const view: Rgb = [0, 0, 0], sunDepth: Rgb = [0, 0, 0], floorGlow: Rgb = [0, 0, 0];
/** Sky irradiance on the sea (a horizontal surface), colour × intensity: the dome's single scattering
 * integrated over the hemisphere with a coarse estimate of the higher orders, graded as the dome is.
 * Coarse on purpose (a few thousand samples); the GPU tables carry the detail. */
export function skyIrradiance(air: AirCoefficients, sun: { x: number; y: number; z: number }, irradiance: number, lift: number, out: Color): Color {
  const rings = 4, sectors = 8, steps = 16, sum: Rgb = [0, 0, 0];
  for (let ring = 0; ring < rings; ring++) for (let sector = 0; sector < sectors; sector++) {
    // Cosine-weighted directions: their plain mean is the irradiance over π.
    const a = (ring + .5) / rings, phi = 2 * Math.PI * (sector + .5) / sectors;
    const sine = Math.sqrt(a), cosine = Math.sqrt(1 - a);
    const dx = sine * Math.cos(phi), dy = cosine, dz = sine * Math.sin(phi);
    const nu = dx * sun.x + dy * sun.y + dz * sun.z;
    const phaseR = rayleighPhase(nu), phaseM = aureolePhase(nu, air.mieG) * air.mieGain;
    const length = distanceToTop(PLANET_RADIUS, dy);
    let previous = 0;
    view[0] = view[1] = view[2] = 0;
    for (let i = 1; i <= steps; i++) {
      const t = length * (i / steps) ** 2, middle = (t + previous) / 2, dt = t - previous;
      previous = t;
      const px = dx * middle, py = PLANET_RADIUS + dy * middle, pz = dz * middle, r = Math.hypot(px, py, pz);
      opticalDepth(air, r, (px * sun.x + py * sun.y + pz * sun.z) / r, sunDepth, 16);
      const [rayleigh, mie, ozone] = densities(r - PLANET_RADIUS);
      for (let c = 0; c < 3; c++) {
        const lit = Number.isFinite(sunDepth[c]) ? Math.exp(-sunDepth[c]) : 0;
        const source = (air.rayleigh[c] * rayleigh * phaseR + air.mieScattering[c] * mie * phaseM) * lit * (1 + .5 * air.multiple);
        const extinctionStep = (air.rayleigh[c] * rayleigh + air.mieExtinction[c] * mie + air.ozone[c] * ozone) * dt;
        sum[c] += source * Math.exp(-view[c] - extinctionStep / 2) * dt / (rings * sectors);
        view[c] += extinctionStep;
      }
    }
  }
  nightFloor(.5, floorGlow);
  const scale = Math.PI * irradiance * lift * SKY_GRADE.gain;
  return out.setRGB(sum[0] * scale + Math.PI * floorGlow[0], sum[1] * scale + Math.PI * floorGlow[1], sum[2] * scale + Math.PI * floorGlow[2]);
}

/** The scene light's grade. `tint` is the high sun's colour at the sea, which the scene light has
 * always used. `saturation` < 1 softens the physical reddening of a low sun, so golden hour warms the
 * ships without drowning them in orange. `floor` keeps a low sun readable: its light never falls
 * below the ramp the game has always used, `(floor + (1 − floor)·smoothstep(elevation, 0, 18°))` of
 * full, until the disc sinks; physics decides only its colour there. */
export const SUN_GRADE = { tint: new Color(1, .95, .85), saturation: .6, floor: .12, full: 18, setting: [-1, 2] as const };
/** Share of the moonlight above the air that reaches the sea once the moon is well up, and the
 * elevation (degrees) by which it is. */
export const MOON_GRADE = { transmittance: .8, risen: 6 };

const sunAtSea: Rgb = [0, 0, 0], zenith: Rgb = [0, 0, 0];
/** Sunlight and moonlight at the sea, colour × intensity in the sea's units: what `CelestialLight`
 * carries to the sea, the ships and smoke. The brightest channel is the light's intensity. */
export function seaLevelLight(scene: SkyScene, air: AirCoefficients, moon: { irradiance: Rgb; elevationDeg: number }, out: { sun: Color; moon: Color }): void {
  const { elevation, intensity } = scene.sun;
  // Colour: the physical transmittance relative to a sun overhead, softened, on the high sun's tint.
  seaTransmittance(air, Math.max(elevation, .5), sunAtSea);
  seaTransmittance(air, 90, zenith);
  const relative = sunAtSea.map((value, c) => (value / zenith[c]) ** SUN_GRADE.saturation);
  const peak = Math.max(...relative, 1e-6);
  const { tint } = SUN_GRADE;
  out.sun.setRGB(tint.r * relative[0] / peak, tint.g * relative[1] / peak, tint.b * relative[2] / peak);
  const colourPeak = Math.max(out.sun.r, out.sun.g, out.sun.b);
  // Brightness: physics (relative to the high sun), never below the game's readability ramp.
  const physical = Math.max(...sunAtSea.map((value, c) => value / zenith[c]));
  const ramp = SUN_GRADE.floor + (1 - SUN_GRADE.floor) * MathUtils.smoothstep(elevation, 0, SUN_GRADE.full);
  const level = intensity * Math.min(1, Math.max(physical, ramp)) * MathUtils.smoothstep(elevation, ...SUN_GRADE.setting);
  out.sun.multiplyScalar(level / colourPeak);
  const [r, g, b] = moon.irradiance;
  out.moon.setRGB(r, g, b).multiplyScalar(MOON_GRADE.transmittance * MathUtils.smoothstep(moon.elevationDeg, 0, MOON_GRADE.risen));
}
