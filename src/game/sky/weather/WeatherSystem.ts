import { MathUtils, Vector3, type Node, type Object3D, type PassNode } from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import type { AtmospherePart, SkyFrame, SkyPartContext, SkyQuality, SkyScene, WeatherPart } from '../contracts';
import { SKY_TIERS, type SkyTier } from '../quality';
import { buildBolt } from './bolt';
import { BOLT_RADIANCE, BoltMesh } from './boltMesh';
import { rainHaze } from './haze';
import { flashAt, LightningScheduler, placeChannel, planStrokes, seededRandom, Strike, thunderFor, type StrikeKind } from './lightning';
import { RainField, skyAround, type RainLighting } from './rain';
import { SplashField } from './splashes';

/** Frames after creation in which empty rain, splash and bolt meshes still draw (no instances), so their
 * pipelines compile under the game's loading screen rather than in the first storm. */
const WARMUP_FRAMES = 16;
/** Camera altitudes (m) over which near rain and its veil fade out: none from the chart's heights. */
const RAIN_CEILING = [1000, 1500] as const;
/** Camera altitudes (m) over which splashes fade out: they are specks from higher. */
const SPLASH_CEILING = [45, 120] as const;
/** The tier whose drop budget (`SKY_TIERS.medium.rainDrops`) draws streaks at their tuned boldness; others scale it by
 * the square root of the ratio, so a small budget still reads as rain and a large one as finer, denser rain. */
const REFERENCE_DROPS = SKY_TIERS.medium.rainDrops;
/** Splashes per rain drop of the tier's budget. */
const SPLASH_SHARE = .15;
/** Magnification beyond which splashes are not drawn: optics look far past them. */
const SPLASH_ZOOM = 3;
/** A camera this far below sea level (m) is under water: no rain. */
const SUBMERGED = -.3;
/** Distance (m) over which the air dims a bolt by e, dry and in a downpour. */
const BOLT_VISIBILITY = { dry: 40000, rain: 11000 };
/** Brightness of the rain-lit air relative to the sky behind it, and its share of the lightning at the camera. */
const AIR = .85, AIR_LIGHTNING = .04;
/** Where a ground bolt ends below sea level (m), so it meets the waves even in a trough. */
const BOLT_FOOT = -3;

export interface WeatherOptions {
  /** Height of the drawn sea (waves and wake) at world XZ, for splashes that sit on the water. */
  seaHeight?: (x: Node<'float'>, z: Node<'float'>) => Node<'float'>;
  /** True while the camera looks into a hull (the port's cutaways, the damage X-ray): rain stays outside. */
  sheltered?: () => boolean;
}

/** Rain near the camera, splashes on the sea, rain haze, lightning and the thunder cue. See `README.md`. */
export class WeatherSystem implements WeatherPart {
  readonly meshes: Object3D[];
  onThunder?: WeatherPart['onThunder'];
  private readonly rain: RainField;
  private readonly splashes: SplashField;
  private readonly bolt = new BoltMesh();
  private readonly scheduler = new LightningScheduler(1941);
  private readonly hazeStrength = uniform(0);
  /** Height of the cloud base above the camera (m, 0 once above it): where the rain along an upward ray begins. */
  private readonly hazeCeiling = uniform(0);
  /** Radiance of the rain-filled air along a view ray, which the haze pulls distance toward. */
  private readonly air: (ray: Node<'vec3'>) => Node<'vec3'>;
  private active: Strike | null = null;
  private boltVisible = false;
  private flashValue = 0;
  private precipitation = 0;
  private readonly clouds = { altitude: 650, thickness: 3000 };
  private tier: SkyTier;
  private warmup = WARMUP_FRAMES;
  private readonly toStrike = new Vector3();

  constructor(context: SkyPartContext, atmosphere: AtmospherePart, private readonly options: WeatherOptions = {}) {
    const { uniforms } = context;
    const ambient = atmosphere.ambient(uniforms.cameraPosition.y.max(0));
    const lighting: RainLighting = { sky: direction => atmosphere.sky(direction), above: ambient.above, below: ambient.below,
      lightDirection: uniforms.lightDirection, lightColor: uniforms.lightColor };
    const capacity = Math.max(...Object.values(SKY_TIERS).map(tier => tier.rainDrops));
    this.rain = new RainField(capacity, lighting);
    this.splashes = new SplashField(Math.ceil(capacity * SPLASH_SHARE), lighting, options.seaHeight);
    // Rain draws over smoke and fire (0–3); bolts and splashes lie behind it.
    this.splashes.mesh.renderOrder = 4; this.bolt.mesh.renderOrder = 4; this.rain.mesh.renderOrder = 5;
    this.meshes = [this.splashes.mesh, this.bolt.mesh, this.rain.mesh];
    this.tier = SKY_TIERS[context.quality];
    this.setQuality(context.quality);
    // The air takes the colour of the sky behind it, greyed under a deck, lit up by a flash.
    this.air = ray => skyAround(lighting, ray, this.rain.grey).mul(this.rain.flash.add(1)).mul(AIR)
      .add(vec3(.8, .87, 1).mul(this.rain.boltIrradiance.mul(AIR_LIGHTNING)));
  }

  get strike(): Strike | null { return this.active; }
  get flash(): number { return this.flashValue; }

  apply(scene: SkyScene): void {
    const { weather, clouds } = scene;
    this.precipitation = MathUtils.clamp(weather.precipitation, 0, 1);
    this.scheduler.rate = Math.max(0, weather.lightning);
    this.clouds.altitude = clouds.altitude; this.clouds.thickness = clouds.thickness;
    this.rain.setPrecipitation(this.precipitation);
    this.rain.setWind(clouds.windSpeed, clouds.windHeading);
    // The deck hides the sun from the drops and greys the light filling them.
    const direct = 1 - MathUtils.smoothstep(clouds.coverage, .55, .95), grey = MathUtils.smoothstep(clouds.coverage, .3, .9);
    this.rain.directShare.value = this.splashes.directShare.value = direct;
    this.rain.grey.value = this.splashes.grey.value = grey;
    this.splashes.size.value = .5 + .5 * Math.sqrt(this.precipitation);
  }

  update(frame: SkyFrame): void {
    const { camera, dt, cut } = frame, position = camera.position;
    this.updateLightning(position, dt);
    const altitude = position.y;
    const indoors = altitude < SUBMERGED || (this.options.sheltered?.() ?? false);
    const aloft = 1 - MathUtils.smoothstep(altitude, RAIN_CEILING[0], RAIN_CEILING[1]);
    const rain = indoors ? 0 : this.precipitation * aloft;
    const warming = this.warmup > 0;
    if (warming) this.warmup--;
    this.rain.update(camera, dt, cut);
    this.rain.opacity.value = aloft;
    this.rain.count = rain > 0 ? this.precipitation * this.tier.rainDrops : 0;
    this.rain.mesh.visible = this.rain.count > 0 || warming;
    const magnification = camera.projectionMatrix.elements[5] * Math.tan(26 * Math.PI / 180);
    const splash = indoors || magnification > SPLASH_ZOOM ? 0 : rain * (1 - MathUtils.smoothstep(altitude, SPLASH_CEILING[0], SPLASH_CEILING[1]));
    this.splashes.update(camera, dt);
    this.splashes.opacity.value = Math.min(1, splash / Math.max(this.precipitation, 1e-3));
    this.splashes.count = splash > 0 ? this.precipitation * this.tier.rainDrops * SPLASH_SHARE : 0;
    this.splashes.mesh.visible = this.splashes.count > 0 || warming;
    this.hazeStrength.value = rain;
    this.hazeCeiling.value = Math.max(0, this.clouds.altitude - altitude);
    this.bolt.mesh.visible = this.boltVisible || warming;
  }

  /** Diagnostics: fire a flash of `kind` at `position` (for a ground bolt, where it meets the sea; y is ignored)
   * and show it `age` seconds after its first return stroke. The flicker and bolt come from `seed`, so a capture
   * is the same every time; no thunder is cued. Frames with `dt` 0 then hold it. */
  forceStrike(position: Vector3, age: number, kind: StrikeKind = 'ground', seed = 1): Strike {
    const random = seededRandom(seed);
    const strike = new Strike(kind, planStrokes(kind, random), Math.floor(random() * 2 ** 32));
    strike.ground.set(position.x, 0, position.z);
    placeChannel(strike, this.clouds, random);
    strike.age = Math.max(0, age);
    strike.expose(strike.age, strike.age);
    this.show(strike, false);
    return strike;
  }

  /** Diagnostics: end any flash now (a forced one never ends on paused frames). */
  clearStrike(): void { this.active = null; this.boltVisible = false; this.flashValue = 0; }

  postProcess(scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'> {
    return rainHaze(scenePass, color, { strength: this.hazeStrength, ceiling: this.hazeCeiling, air: this.air });
  }

  setQuality(quality: SkyQuality): void {
    this.tier = SKY_TIERS[quality];
    this.rain.density.value = Math.sqrt(REFERENCE_DROPS / this.tier.rainDrops);
  }

  dispose(): void {
    this.rain.dispose(); this.splashes.dispose(); this.bolt.dispose();
  }

  diagnostics() {
    const strike = this.active;
    return { precipitation: this.precipitation, lightning: this.scheduler.rate, drops: this.rain.count, splashes: this.splashes.count,
      flash: this.flashValue, strike: strike && { kind: strike.kind, age: strike.age, distance: strike.distance, intensity: strike.intensity } };
  }

  private updateLightning(camera: Vector3, dt: number): void {
    const due = this.scheduler.advance(dt);
    let fresh: Strike | null = null;
    for (let i = 0; i < due; i++) fresh = this.show(this.scheduler.next(camera, this.clouds), true);
    // A strike shows its first stroke's peak the frame it fires, then each frame's exposure.
    if (fresh) fresh.expose(0, 0);
    else this.active?.advance(dt);
    if (this.active?.done) this.active = null;
    const { rain } = this;
    this.boltVisible = false;
    if (!this.active) {
      this.flashValue = rain.flash.value = this.splashes.flash.value = rain.boltIrradiance.value = 0;
      this.bolt.main.value = this.bolt.branches.value = 0;
      return;
    }
    const active = this.active, toStrike = this.toStrike.subVectors(active.position, camera), distance = Math.max(1, toStrike.length());
    this.flashValue = rain.flash.value = this.splashes.flash.value = flashAt(active.kind, active.brightness, distance);
    rain.boltIrradiance.value = active.intensity * (1000 / distance) ** 2;
    rain.boltDirection.value.copy(toStrike).divideScalar(distance);
    if (active.kind === 'ground') {
      const air = BOLT_VISIBILITY.dry + (BOLT_VISIBILITY.rain - BOLT_VISIBILITY.dry) * this.precipitation;
      const clarity = Math.exp(-active.ground.distanceTo(camera) / air) * BOLT_RADIANCE;
      this.bolt.origin.value.subVectors(active.ground, camera);
      this.bolt.main.value = active.brightness * clarity;
      this.bolt.branches.value = active.firstBrightness * clarity;
      // From above the deck the cloud hides the bolt; its glow inside the cloud still shows.
      this.boltVisible = camera.y < this.clouds.altitude;
    }
  }

  /** Make `strike` the active flash: build its bolt, and cue thunder for a natural one. */
  private show(strike: Strike, thunder: boolean): Strike {
    this.active = strike;
    if (strike.kind === 'ground') {
      const { top, ground } = strike;
      buildBolt(this.bolt.channel, seededRandom(strike.seed), [top.x - ground.x, top.y, top.z - ground.z], [0, BOLT_FOOT, 0]);
      this.bolt.upload();
    }
    if (thunder) this.onThunder?.(thunderFor(strike.kind, strike.distance));
    return strike;
  }
}
