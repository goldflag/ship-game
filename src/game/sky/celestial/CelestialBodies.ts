import { MathUtils, Matrix3, Vector2, Vector3, type Node, type PassNode, type TextureNode } from 'three/webgpu';
import { Fn, If, dot, max, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import type { CelestialPart, SkyFrame, SkyPartContext, SkyQuality, SkyUniforms } from '../contracts';
import { moonIllumination } from '../celestialModel';
import { SKY_TIERS } from '../quality';
import { MOON_DISC, MOON_HALO, moonDisc, moonGlow, sunDisc, type MoonInputs } from './discs';
import { galacticRotation } from './galactic';
import { MilkyWay } from './milkyWay';
import { StarField } from './starField';

const DEGREES = Math.PI / 180;
/** Radiance of the Milky Way's brightest parts (its texture holds about 1 there) on a dark night: a little above
 * a moonless sky, so the band shows on a dark night and a full moon's brighter sky mostly swallows it. */
const MILKY_WAY_RADIANCE = .05;
/** Sun elevations (degrees) between which the Milky Way fades in: from nautical toward astronomical twilight. */
const MILKY_WAY_TWILIGHT = [-16, -9] as const;
/** Faintest magnitude seen with the sun at −2°, and the magnitudes gained per degree it sinks: Sirius first, the
 * whole catalog by astronomical twilight. */
const STAR_LIMIT = { at: -2, magnitude: -1.5, perDegree: .55 };
/** Stars are drawn only while the sun is below this elevation (degrees): above it none survive the limit anyway. */
const STARS_BELOW = 1;
/** The camera's normal field of view (degrees), and the most binoculars brighten point sources: a star's light
 * lands on fewer pixels as the field narrows, so glasses show fainter stars than the naked eye. */
const NORMAL_FIELD = 52, ZOOM_GAIN = 3;
/** Earth radius (m), for the horizon's dip below a high camera: stars below the sea horizon are never seen. */
const EARTH_RADIUS = 6.36e6;
/** Earthshine on the moon's night side, relative to its sunlit surface at a new moon, and its blue-grey tint. */
const EARTHSHINE = .016, EARTHSHINE_TINT = new Vector3(.8, .87, 1);
/** The disc's own colour at unit luminance: the lunar soil's faint warmth, whatever tint the night's light takes. */
const MOON_TINT = new Vector3(1, .975, .93).multiplyScalar(1 / (.2126 + .7152 * .975 + .0722 * .93));
/** Lit surface brightness at a large phase angle relative to full: the opposition surge fades from full moon. */
const PHASE_FLOOR = .38;
/** How much a full moon well up takes from the Milky Way and from the faintest stars' magnitudes. Its brighter sky
 * (the atmosphere's) swallows faint light through the tone map; this adds the eye's adaptation to that sky, which
 * the display cannot. Scaled by the lit share, so a crescent night keeps the whole band. */
const MOONLIGHT_WASHOUT = { milkyWay: .45, magnitudes: 1.4 };

/** The celestial bodies: sun disc, moon, stars, Milky Way and the shafts they cast. See `README.md` (Celestial). */
export class CelestialBodies implements CelestialPart {
  private readonly stars: StarField;
  private readonly milkyWay = new MilkyWay();
  private readonly sky: SkyUniforms;
  private readonly size = new Vector2();
  private readonly pole = new Vector3();
  private readonly local = {
    /** Radians per pixel at the centre of the view, and the view's forward direction. */
    pixelAngle: uniform(1e-3), forward: uniform(new Vector3(0, 0, -1)),
    /** World → galactic frame (stars and Milky Way). */
    galactic: uniform(new Matrix3()),
    /** 1 while stars may show; the lowest direction (y) worth drawing them in. */
    night: uniform(0), horizon: uniform(-.02),
    starLimit: uniform(7), starGain: uniform(1), milkyWay: uniform(0),
    moonRight: uniform(new Vector3(1, 0, 0)), moonUp: uniform(new Vector3(0, 1, 0)), moonSun: uniform(new Vector3(0, 0, 1)),
    moonSurface: uniform(new Vector3()), moonPhase: uniform(1), earthshine: uniform(new Vector3()), moonGlow: uniform(0), moonLit: uniform(1),
    /** The environment bake's texel (radians) and the Milky Way mip that matches it. */
    bakeSpread: uniform(.02), bakeLevel: uniform(0),
  };
  private readonly moon: MoonInputs;

  constructor(context: SkyPartContext) {
    this.sky = context.uniforms;
    this.stars = new StarField(SKY_TIERS[context.quality].stars);
    const l = this.local;
    this.moon = { direction: this.sky.moonDirection, right: l.moonRight, up: l.moonUp, sun: l.moonSun, surface: l.moonSurface, phase: l.moonPhase,
      earthshine: l.earthshine, glow: l.moonGlow };
    this.setBake(context.quality);
  }

  /** Radians a pixel spans along `direction`: the centre's, shrinking off axis as a pinhole view's pixels do. */
  private pixel(direction: Node<'vec3'>): Node<'float'> {
    return this.local.pixelAngle.mul(pow(max(dot(direction, this.local.forward), .2), 1.5));
  }

  radiance(direction: Node<'vec3'>): Node<'vec3'> {
    const l = this.local, pixel = this.pixel(direction);
    return Fn(() => {
      const result = sunDisc(direction, { direction: this.sky.sunDirection, irradiance: this.sky.sunIrradiance }, pixel)
        .add(moonDisc(direction, this.moon, pixel)).toVar();
      If(l.night.greaterThan(0).and(direction.y.greaterThan(l.horizon)), () => {
        const galactic = l.galactic.mul(direction).toVar();
        result.addAssign(this.stars.radiance({ galactic, direction, pixelAngle: pixel, limit: l.starLimit, gain: l.starGain, time: this.sky.time }));
        result.addAssign(this.milkyWay.sample(galactic).mul(l.milkyWay));
      });
      return result;
    })();
  }

  diffuseRadiance(direction: Node<'vec3'>): Node<'vec3'> {
    const l = this.local;
    return Fn(() => {
      const result = moonGlow(direction, this.moon, l.moonLit, l.bakeSpread).toVar();
      If(l.milkyWay.greaterThan(0), () => { result.addAssign(this.milkyWay.sample(l.galactic.mul(direction), l.bakeLevel).mul(l.milkyWay)); });
      // Nothing beyond the air shows below the horizon: the sea is there.
      return result.mul(smoothstep(-.02, .02, direction.y));
    })();
  }

  shafts(_scenePass: PassNode, color: Node<'vec4'>, _skyVisibility: TextureNode | null): Node<'vec4'> {
    return color;
  }

  update(frame: SkyFrame): void {
    const { camera, renderer } = frame, sky = this.sky, l = this.local;
    this.milkyWay.bake(renderer);
    // The view: its pixel size and forward direction.
    camera.getWorldDirection(l.forward.value);
    const height = renderer.getDrawingBufferSize(this.size).y || 1;
    const halfField = Math.atan(Math.tan(camera.fov * DEGREES / 2) / camera.zoom);
    l.pixelAngle.value = 2 * Math.tan(halfField) / height;
    const magnification = Math.tan(NORMAL_FIELD * DEGREES / 2) / Math.tan(halfField);
    l.starGain.value = Math.min(Math.sqrt(Math.max(magnification, 1)), ZOOM_GAIN);
    l.horizon.value = -Math.sqrt(2 * Math.max(camera.position.y, 0) / EARTH_RADIUS) - .02;
    // Stars and the Milky Way in the galactic frame; how dark the sky is.
    galacticRotation(sky.starRotation.value, l.galactic.value);
    const sunElevation = Math.asin(Math.max(-1, Math.min(1, sky.sunDirection.value.y))) / DEGREES;
    l.night.value = sunElevation < STARS_BELOW ? 1 : 0;
    const moonlight = moonIllumination(sky.moonPhase.value) * MathUtils.smoothstep(sky.moonDirection.value.y, -.05, .2);
    l.starLimit.value = STAR_LIMIT.magnitude + STAR_LIMIT.perDegree * (STAR_LIMIT.at - sunElevation) - MOONLIGHT_WASHOUT.magnitudes * moonlight;
    l.milkyWay.value = MILKY_WAY_RADIANCE * (1 - MathUtils.smoothstep(sunElevation, ...MILKY_WAY_TWILIGHT)) * (1 - MOONLIGHT_WASHOUT.milkyWay * moonlight);
    this.updateMoon();
  }

  /** The moon's disc frame and lighting from the shared sun, moon and star frame. */
  private updateMoon(): void {
    const sky = this.sky, l = this.local, moon = sky.moonDirection.value, sun = sky.sunDirection.value;
    // Lunar north toward the celestial pole (the star frame's third row), or the zenith if the moon is at the pole.
    const e = sky.starRotation.value.elements, up = l.moonUp.value, right = l.moonRight.value;
    this.pole.set(e[2], e[5], e[8]);
    up.copy(this.pole).addScaledVector(moon, -moon.dot(this.pole));
    if (up.lengthSq() < 1e-8) up.set(0, 1, 0).addScaledVector(moon, -moon.y);
    up.normalize();
    right.crossVectors(moon, up).normalize();
    l.moonSun.value.set(sun.dot(right), sun.dot(up), -sun.dot(moon));
    const lit = moonIllumination(sky.moonPhase.value), irradiance = sky.moonIrradiance.value;
    const luminance = .2126 * irradiance.x + .7152 * irradiance.y + .0722 * irradiance.z;
    l.moonLit.value = lit;
    l.moonSurface.value.copy(MOON_TINT).multiplyScalar(lit > 1e-4 ? luminance * MOON_DISC / lit : 0);
    // Phase angle: 0 at full moon, where the opposition surge makes the lit face brightest.
    const opposition = ((1 - sun.dot(moon)) / 2) ** 1.5;
    l.moonPhase.value = PHASE_FLOOR + (1 - PHASE_FLOOR) * opposition;
    l.earthshine.value.copy(EARTHSHINE_TINT).multiplyScalar(EARTHSHINE * (1 - lit));
    l.moonGlow.value = MOON_HALO * Math.sqrt(lit);
  }

  private setBake(quality: SkyQuality): void {
    const texel = 2 * Math.PI / SKY_TIERS[quality].environmentWidth;
    this.local.bakeSpread.value = texel;
    this.local.bakeLevel.value = MilkyWay.level(texel);
  }

  setQuality(quality: SkyQuality): void {
    this.stars.setCount(SKY_TIERS[quality].stars);
    this.setBake(quality);
  }

  dispose(): void {
    this.stars.dispose();
    this.milkyWay.dispose();
  }
}
