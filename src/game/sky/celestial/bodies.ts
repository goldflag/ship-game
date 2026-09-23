import { MathUtils, Vector3 } from 'three/webgpu';
import { moonIllumination } from '../celestialModel';

/** Renderer-free values the celestial part derives each frame from the shared sky uniforms and the camera: how
 * dark the sky is for stars and the Milky Way, how a view's pixels and zoom treat point sources, and the moon's
 * disc frame and lighting. `CelestialBodies` writes them into its uniforms; the tests read them directly. */

const DEGREES = Math.PI / 180;
/** Faintest magnitude seen with the sun at −2°, and the magnitudes gained per degree it sinks: Sirius first, the
 * whole catalog by astronomical twilight. */
const STAR_LIMIT = { at: -2, magnitude: -1.5, perDegree: .55 };
/** Sun elevations (degrees) over which the Milky Way fades in: from nautical toward astronomical twilight. */
const MILKY_WAY_TWILIGHT = [-16, -9] as const;
/** How much a full moon well up takes from the Milky Way and from the faintest stars' magnitudes. Its brighter sky
 * (the atmosphere's) swallows faint light through the tone map; this adds the eye's adaptation to that sky, which
 * the display cannot. Scaled by the lit share, so a crescent night keeps the whole band. */
const MOONLIGHT_WASHOUT = { milkyWay: .45, magnitudes: 1.4 };
/** The camera's normal field of view (degrees), and the most binoculars brighten point sources: a star's light
 * lands on fewer pixels as the field narrows, so glasses show fainter stars than the naked eye. */
const NORMAL_FIELD = 52, ZOOM_GAIN = 3;
/** Earth radius (m), for the horizon's dip below a high camera. */
const EARTH_RADIUS = 6.36e6;
/** Earthshine on the moon's night side, relative to its sunlit surface at a new moon, and its blue-grey tint. */
const EARTHSHINE = .016, EARTHSHINE_TINT = new Vector3(.8, .87, 1);
/** The disc's own colour at unit luminance: the lunar soil's faint warmth, whatever tint the night's light takes. */
const MOON_TINT = new Vector3(1, .975, .93).multiplyScalar(1 / (.2126 + .7152 * .975 + .0722 * .93));
/** Lit surface brightness at a large phase angle relative to full: the opposition surge fades from full moon. */
const PHASE_FLOOR = .38;

/** Share of a full moon's light on the sky: its lit share, fading as it sets. */
export function moonlight(phase: number, moon: Vector3): number {
  return moonIllumination(phase) * MathUtils.smoothstep(moon.y, -.05, .2);
}

/** Faintest star magnitude visible with the sun at `sunElevation` degrees under a sky lit by `moonlight`. */
export function starLimit(sunElevation: number, moonlight: number): number {
  return STAR_LIMIT.magnitude + STAR_LIMIT.perDegree * (STAR_LIMIT.at - sunElevation) - MOONLIGHT_WASHOUT.magnitudes * moonlight;
}

/** Share of the Milky Way's radiance shown with the sun at `sunElevation` degrees under a sky lit by `moonlight`. */
export function milkyWayShare(sunElevation: number, moonlight: number): number {
  return (1 - MathUtils.smoothstep(sunElevation, ...MILKY_WAY_TWILIGHT)) * (1 - MOONLIGHT_WASHOUT.milkyWay * moonlight);
}

/** Radians a pixel spans at the centre of a view `height` pixels tall, and the gain on point sources its zoom gives. */
export function viewScale(fovDegrees: number, zoom: number, height: number): { pixelAngle: number; starGain: number } {
  const halfField = Math.atan(Math.tan(fovDegrees * DEGREES / 2) / zoom);
  const magnification = Math.tan(NORMAL_FIELD * DEGREES / 2) / Math.tan(halfField);
  return { pixelAngle: 2 * Math.tan(halfField) / Math.max(height, 1), starGain: Math.min(Math.sqrt(Math.max(magnification, 1)), ZOOM_GAIN) };
}

/** Lowest direction (its y) worth drawing stars in from a camera at `altitude` metres: the sea horizon dips below the
 * level as the camera climbs, and nothing beyond the air shows below it. */
export function horizonCut(altitude: number): number {
  return -Math.sqrt(2 * Math.max(altitude, 0) / EARTH_RADIUS) - .02;
}

export interface MoonLighting {
  /** The disc's axes in world space: toward the viewer's right, and toward the celestial pole (lunar north). */
  readonly right: Vector3;
  readonly up: Vector3;
  /** Toward the sun in the disc's frame (right, up, toward the viewer). */
  readonly sun: Vector3;
  /** Radiance of a fully lit highland facing the sun (the moonlight over its lit share, times `disc`), and earthshine. */
  readonly surface: Vector3;
  readonly earthshine: Vector3;
}

/** The moon's disc frame and lighting from the sun, the moon, the celestial pole and the moonlight above the air
 * (`SkyUniforms.moonIrradiance`, lit share included). Returns the lit share, the surface brightness at this phase
 * angle relative to full (the opposition surge), and writes the rest into `target`. */
export function moonLighting(sun: Vector3, moon: Vector3, pole: Vector3, phase: number, irradiance: Vector3, disc: number, target: MoonLighting):
  { lit: number; opposition: number } {
  const { right, up } = target;
  up.copy(pole).addScaledVector(moon, -moon.dot(pole));
  if (up.lengthSq() < 1e-8) up.set(0, 1, 0).addScaledVector(moon, -moon.y);
  if (up.lengthSq() < 1e-8) up.set(1, 0, 0);
  up.normalize();
  right.crossVectors(moon, up).normalize();
  target.sun.set(sun.dot(right), sun.dot(up), -sun.dot(moon));
  const lit = moonIllumination(phase), luminance = .2126 * irradiance.x + .7152 * irradiance.y + .0722 * irradiance.z;
  target.surface.copy(MOON_TINT).multiplyScalar(lit > 1e-4 ? luminance * disc / lit : 0);
  target.earthshine.copy(EARTHSHINE_TINT).multiplyScalar(EARTHSHINE * (1 - lit));
  const opposition = ((1 - sun.dot(moon)) / 2) ** 1.5;
  return { lit, opposition: PHASE_FLOOR + (1 - PHASE_FLOOR) * opposition };
}
