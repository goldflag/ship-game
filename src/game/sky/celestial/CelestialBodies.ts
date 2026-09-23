import { Matrix3, Vector2, Vector3, type Node, type PassNode, type TextureNode } from 'three/webgpu';
import { Fn, If, dot, max, smoothstep, uniform } from 'three/tsl';
import type { CelestialPart, SkyFrame, SkyPartContext, SkyQuality, SkyUniforms } from '../contracts';
import { SKY_TIERS } from '../quality';
import { horizonCut, milkyWayShare, moonLighting, moonlight, starLimit, viewScale, type MoonLighting } from './bodies';
import { MOON_DISC, MOON_HALO, moonCover, moonDisc, moonGlow, sunDisc, type MoonInputs } from './discs';
import { galacticRotation } from './galactic';
import { MilkyWay } from './milkyWay';
import { LightShafts } from './shafts';
import { StarField } from './starField';

const DEGREES = Math.PI / 180;
/** Radiance of the Milky Way's brightest parts (its texture holds about 1 there) on a dark night: a little above a
 * moonless sky, so the band shows on a dark night and a full moon's brighter sky mostly swallows it. */
const MILKY_WAY_RADIANCE = .04;
/** Stars are drawn only while the sun is below this elevation (degrees): above it none survive the limit anyway. */
const STARS_BELOW = 1;
/** Camera height (m) below which the view is under water, where the sea draws its own light and no shafts fall. */
const SUBMERGED = -1;

/** The celestial bodies: sun disc, moon, stars, Milky Way and the shafts they cast. See `README.md` (Celestial).
 *
 * Everything drawn is above the atmosphere; the dome multiplies it by the transmittance to space. The dome's
 * cost by day is two disc tests; stars and the Milky Way (a cell lookup and a texture read per pixel) run only
 * while the sun is down, above the sea horizon. */
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
  private readonly moonLighting: MoonLighting;
  private readonly lightShafts: LightShafts;
  private readonly reversedDepth: boolean;

  constructor(context: SkyPartContext) {
    this.sky = context.uniforms;
    this.reversedDepth = context.reversedDepth;
    this.stars = new StarField(SKY_TIERS[context.quality].stars);
    this.lightShafts = new LightShafts(SKY_TIERS[context.quality].shaftSamples);
    const l = this.local;
    this.moon = { direction: this.sky.moonDirection, right: l.moonRight, up: l.moonUp, sun: l.moonSun, surface: l.moonSurface, phase: l.moonPhase,
      earthshine: l.earthshine, glow: l.moonGlow };
    this.moonLighting = { right: l.moonRight.value, up: l.moonUp.value, sun: l.moonSun.value, surface: l.moonSurface.value, earthshine: l.earthshine.value };
    this.setBake(context.quality);
  }

  /** Radians a pixel spans along `direction`: the centre's, shrinking off axis as a pinhole view's pixels do. */
  private pixel(direction: Node<'vec3'>): Node<'float'> {
    const facing = max(dot(direction, this.local.forward), .2);
    return this.local.pixelAngle.mul(facing.mul(facing.sqrt()));
  }

  radiance(direction: Node<'vec3'>): Node<'vec3'> {
    const l = this.local, pixel = this.pixel(direction);
    return Fn(() => {
      const result = sunDisc(direction, { direction: this.sky.sunDirection, irradiance: this.sky.sunIrradiance }, pixel, this.sky.moonDirection)
        .add(moonDisc(direction, this.moon, pixel)).toVar();
      If(l.night.greaterThan(0).and(direction.y.greaterThan(l.horizon)), () => {
        const galactic = l.galactic.mul(direction).toVar();
        const stars = this.stars.radiance({ galactic, direction, pixelAngle: pixel, limit: l.starLimit, gain: l.starGain, time: this.sky.time });
        result.addAssign(stars.add(this.milkyWay.sample(galactic).mul(l.milkyWay)).mul(moonCover(direction, this.sky.moonDirection, pixel).oneMinus()));
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

  shafts(scenePass: PassNode, color: Node<'vec4'>, skyVisibility: TextureNode | null): Node<'vec4'> {
    return this.lightShafts.compose(scenePass, skyVisibility, color, this.sky.lightColor, this.reversedDepth);
  }

  update(frame: SkyFrame): void {
    const { camera, renderer } = frame, sky = this.sky, l = this.local;
    this.milkyWay.bake(renderer);
    // The view: its pixel size, zoom and forward direction.
    camera.getWorldDirection(l.forward.value);
    const view = viewScale(camera.fov, camera.zoom, renderer.getDrawingBufferSize(this.size).y);
    l.pixelAngle.value = view.pixelAngle;
    l.starGain.value = view.starGain;
    l.horizon.value = horizonCut(camera.position.y);
    // Stars and the Milky Way in the galactic frame, and how dark the sky is for them.
    galacticRotation(sky.starRotation.value, l.galactic.value);
    const sunElevation = Math.asin(Math.max(-1, Math.min(1, sky.sunDirection.value.y))) / DEGREES;
    const moonlit = moonlight(sky.moonPhase.value, sky.moonDirection.value);
    l.night.value = sunElevation < STARS_BELOW ? 1 : 0;
    l.starLimit.value = starLimit(sunElevation, moonlit);
    l.milkyWay.value = MILKY_WAY_RADIANCE * milkyWayShare(sunElevation, moonlit);
    // The moon's disc frame, lunar north toward the celestial pole (the star frame's third row), and its light.
    const e = sky.starRotation.value.elements;
    this.pole.set(e[2], e[5], e[8]);
    const moon = moonLighting(sky.sunDirection.value, sky.moonDirection.value, this.pole, sky.moonPhase.value, sky.moonIrradiance.value, MOON_DISC,
      this.moonLighting);
    l.moonLit.value = moon.lit;
    l.moonPhase.value = moon.opposition;
    l.moonGlow.value = MOON_HALO * Math.sqrt(moon.lit);
    // Shafts from the light the scene uses: the sun, or the moon once it outshines it. Submerged cameras see the sea's own.
    this.lightShafts.update(camera, sky.lightDirection.value, camera.position.y < SUBMERGED);
  }

  private setBake(quality: SkyQuality): void {
    const texel = 2 * Math.PI / SKY_TIERS[quality].environmentWidth;
    this.local.bakeSpread.value = texel;
    this.local.bakeLevel.value = MilkyWay.level(texel);
  }

  setQuality(quality: SkyQuality): void {
    this.stars.setCount(SKY_TIERS[quality].stars);
    this.lightShafts.setSamples(SKY_TIERS[quality].shaftSamples);
    this.setBake(quality);
  }

  dispose(): void {
    this.stars.dispose();
    this.milkyWay.dispose();
    this.lightShafts.dispose();
  }
}
