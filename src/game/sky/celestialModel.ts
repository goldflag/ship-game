import { Matrix3, Vector3 } from 'three/webgpu';

const RADIANS = Math.PI / 180;
/** Local sidereal angle the sky shows (radians): which stars stand overhead. Chosen for the night composition: the
 * Milky Way rises from the sea on the north side of a midnight sky and its bright core stands low beside an
 * evening full moon. */
export const SIDEREAL = 55 * RADIANS;

/** Unit vector for compass angles in degrees: elevation above the horizon, azimuth 0 toward +Z
 * and 90 toward +X (the game's compass: the sun rises at 90 and sets at 270). */
export function directionFromAngles(elevationDeg: number, azimuthDeg: number, target = new Vector3()): Vector3 {
  const e = elevationDeg * RADIANS, a = azimuthDeg * RADIANS;
  return target.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/** Elevation and azimuth in degrees of a unit vector; azimuth in (-180, 180]. */
export function anglesOf(direction: Vector3): { elevation: number; azimuth: number } {
  return { elevation: Math.asin(Math.max(-1, Math.min(1, direction.y))) / RADIANS, azimuth: Math.atan2(direction.x, direction.z) / RADIANS };
}

/** Lit share of the moon's disc for a phase (0 new, 0.5 full). */
export function moonIllumination(phase: number): number {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

/** Where the sun, moon and stars stand for an authored sun direction. The game authors the sun as
 * two angles and a moon phase, not a date and place, so the sky is built around them: the sun sits
 * at the top of an equinox arc (or at its bottom, by night) whose pole stands 90° − |elevation| over
 * the horizon opposite it. That arc places the sun exactly where the scene asked, keeps a full moon
 * opposite it, and gives the stars a pole to wheel about. The moon rides the same arc, 2π·phase
 * behind the sun in hour angle: a waxing crescent follows the sun down in the evening.
 *
 * Renderer-free: the CPU sky, the scene light and the tests share it. */
export class CelestialModel {
  /** Toward the sun. */
  readonly sun = new Vector3(0, 1, 0);
  /** Toward the moon. */
  readonly moon = new Vector3(0, -1, 0);
  /** Toward the north celestial pole. */
  readonly pole = new Vector3(0, 1, 0);
  /** World → celestial (equatorial) frame: a rotation whose third row is the pole. Star and
   * Milky Way directions are fixed in the celestial frame. */
  readonly starRotation = new Matrix3();
  phase = .5;
  /** Local sidereal angle (radians) turning the stars about the pole: which part of the celestial
   * sphere is overhead. The celestial bodies choose it (`SIDEREAL`); it has no bearing on the sun or moon. */
  sidereal = SIDEREAL;
  private readonly meridian = new Vector3();
  private readonly west = new Vector3();

  /** Place everything for a sun at `elevationDeg`/`azimuthDeg` and a moon phase. */
  set(elevationDeg: number, azimuthDeg: number, phase: number): this {
    this.phase = ((phase % 1) + 1) % 1;
    const night = elevationDeg < 0;
    // The equator's highest point: the sun itself by day, the point opposite it by night.
    directionFromAngles(Math.abs(elevationDeg), night ? azimuthDeg + 180 : azimuthDeg, this.meridian);
    directionFromAngles(90 - Math.abs(elevationDeg), night ? azimuthDeg : azimuthDeg + 180, this.pole);
    // Hour angle grows toward the setting sun: after noon the sun moves to azimuth 270.
    this.west.crossVectors(this.pole, this.meridian).normalize();
    const sunHour = night ? Math.PI : 0;
    this.onArc(sunHour, this.sun);
    this.onArc(sunHour - 2 * Math.PI * this.phase, this.moon);
    this.updateStars();
    return this;
  }

  /** The point of the celestial equator at hour angle `hour`. */
  onArc(hour: number, target = new Vector3()): Vector3 {
    return target.copy(this.meridian).multiplyScalar(Math.cos(hour)).addScaledVector(this.west, Math.sin(hour)).normalize();
  }

  /** Lit share of the moon's disc. */
  get illumination(): number { return moonIllumination(this.phase); }

  private updateStars(): void {
    // Celestial x: the equator point the sidereal angle has carried overhead; z: the pole.
    const c = Math.cos(this.sidereal), s = Math.sin(this.sidereal);
    const x = this.meridian.clone().multiplyScalar(c).addScaledVector(this.west, s);
    const z = this.pole;
    const y = new Vector3().crossVectors(z, x);
    // Rows are the celestial axes in world space, so the matrix takes world vectors to celestial ones.
    this.starRotation.set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
  }
}
