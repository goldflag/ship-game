import { MathUtils, type Node, type NodeBuilder, type Object3D } from 'three/webgpu';
import {
  Fn, If, Loop, abs, attribute, cameraViewMatrix, float, max, min, mix, mx_noise_float, normalGeometry, normalViewGeometry, positionGeometry, positionWorld, pow,
  smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { HullWetBand } from './HullWetBand';
import { PackedVec4Arrays } from './packedUniforms';
import type { PaintWeathering, WetResponse } from './ShipMaterialPalette';
import { runoffStreaks, STREAK } from './ShipSurfaceDetail';
import type { WakeShip } from './FleetWakeFoam';
import { wakeHull } from './wakeHull';

/** Rain on paint. Wet paint loses albedo by how porous it is (Lekner & Dorf 1988, Lagarde 2013): smooth enamel hardly darkens,
 * matte deck paint some, bare teak by about half; the water film glosses each toward its own roughness, about as far as Lagarde's
 * wet surfaces (gloss × 2.5): a film on matte paint is satin, not a mirror, and a mirror wall glares white in any sun. */
export const RAIN = {
  /** Albedo a soaked surface loses: paint from its smoothest to its roughest (`porous`, source roughness), and timber. */
  darkening: [.05, .24], timberDarkening: .42, porous: [.35, .9],
  /** Roughness under a film of water: on a deck or roof, on timber, and running down a wall. */
  film: .38, timberFilm: .5, wall: .48,
  /** Where heavy rain stands on a flat deck: its roughness, the extra albedo it takes, and the share of a deck it covers. */
  pool: .07, poolDarkening: .06, pooled: .3,
  /** Share of a deck's wetness a wall takes, before the water streaming down it along the runoff paths adds the rest. */
  wallFilm: .55,
  /** Runoff paths drawn this many times longer than the wear tile's streaks: water runs further than grime does. */
  run: 2.5,
} as const;
/** Seconds for a surface to wet through at the lightest rain and in a downpour, and to dry once it stops. Running water and
 * pools follow the rain's weight: they build as a downpour sets in and drain within a minute or so. */
export const RAIN_TIMES = { wetting: [45, 10], drying: 180, flowing: 12, draining: 70 } as const;

/** Spray and green water over a bow driven into a seaway. Visual only; not a sea-keeping model. The sea over the bow is
 * significant wave height, turned by how squarely she meets the waves and how fast, over her freeboard. */
export const SPRAY = {
  /** Sea over freeboard at which spray starts to wet the forecastle and at which it is soaked. */
  sea: [.15, .7],
  /** Speed (m/s) at which pitching into the sea starts to throw water aboard and at which it is at its worst. */
  speed: [2, 14],
  /** Share of her length the wet reaches aft of the stem when soaked, and metres above her deck edge it climbs. */
  aft: .3, climb: 14,
  /** Seconds for the bow to wet with a plunge and to drain and dry after it. */
  wetting: 1.2, drying: 40,
  /** Pitch rate (rad/s) of a bow dropping into a sea: from none to a full plunge. */
  plunge: [.005, .04],
} as const;
/** Hulls whose bows wet at once: the nearest to the camera. */
export const SPRAY_SLOTS = 8;
/** Sections of the per-slot values: pose (stem x/z, sin and cos of heading) and bow (length, half beam, level, top height). */
const POSE = 0, BOW = 1;

const smooth = (value: number, [low, high]: readonly [number, number]) => MathUtils.smoothstep(value, low, high);
/** Eases `value` toward `target` over `rising` seconds when it climbs and `falling` seconds when it sinks. */
const ease = (value: number, target: number, dt: number, rising: number, falling: number) =>
  value + (target - value) * (1 - Math.exp(-dt / (target > value ? rising : falling)));

/** What the frame loop reads each frame. */
export interface ShipWeatherFrame {
  /** Rain on the scene, 0 dry … 1 a downpour (the sky's `weather.precipitation`). */
  precipitation: number;
  /** Significant wave height (m) and the direction the waves travel (the ocean's wind direction, radians from +X toward +Z). */
  seaHeight: number; waveDirection: number;
  /** Hulls with their pitch (rad, bow up), where the view has it: a plunging bow ships the most water. */
  ships: readonly (WakeShip & { motion: { pitch?: number } })[];
  camera: { position: { x: number; z: number } };
}

/** Weather on every ship's paint, which the palette layers over surface detail (`PaintWeathering`): the sea's wet band at the
 * waterline, spray and green water over a bow driven into a seaway, and rain. Rain wets exposed paint over tens of seconds and
 * dries over minutes: decks and roofs take it all and hold a sheen, with standing water where they lie flat in a downpour; walls
 * take a thinner film that streams down the runoff paths; undersides stay dry, and so does what the ship occlusion finds deep in
 * shelter. One node graph per response (paint, timber) serves every shared ship paint; dry weather leaves them exactly as they
 * were. Visual only. */
export class ShipWeather implements PaintWeathering {
  readonly band = new HullWetBand();
  /** Wetness of fully exposed paint (0 dry … 1 soaked), and how heavily water runs off it and stands on flat decks (0 … 1). */
  readonly rain = uniform(0);
  readonly flow = uniform(0);
  readonly paint: WetResponse;
  readonly timber: WetResponse;
  private readonly packed = new PackedVec4Arrays([SPRAY_SLOTS, SPRAY_SLOTS]);
  private readonly count = uniform(0, 'int');
  /** Tallest spray (m above the sea): paint above it never reads the slots. */
  private readonly ceiling = uniform(0);
  private readonly levels = new Map<Object3D, { level: number; pitch: number }>();
  private readonly hulls = new WeakMap<Object3D, ReturnType<typeof wakeHull> & { freeboard: number }>();
  private settled = true;
  /** −1 wets each bow by her own sea and motion; 0 or more wets every bow in the view by that much instead (review). */
  sprayOverride = -1;

  constructor() {
    const sea = max(this.band.wetness, this.spray());
    // The band's own response, as it has always drawn; spray is seawater on the same steel.
    const seaDry = float(1).sub(this.band.darkening.mul(sea)), seaGloss = float(1).sub(this.band.glossing.mul(sea));
    const paint = this.rained(false), timber = this.rained(true);
    this.paint = { dry: min(seaDry, paint.x), gloss: min(seaGloss, paint.y) };
    this.timber = { dry: min(seaDry, timber.x), gloss: min(seaGloss, timber.y) };
  }

  get dry() { return this.paint.dry; }
  get gloss() { return this.paint.gloss; }

  /** The next update jumps to the weather's steady state: a scene that opens in rain opens on wet ships. */
  settle(): void { this.settled = true; }

  /** Per frame: ease the rain's wetness and each bow's spray toward what the weather and her motion call for. */
  update(dt: number, frame: ShipWeatherFrame): void {
    const rain = MathUtils.clamp(frame.precipitation, 0, 1), jump = this.settled;
    this.settled = false;
    // Any real rain soaks exposed paint given time; running water and pools need a heavier fall.
    const wet = MathUtils.smoothstep(rain, 0, .25), flow = MathUtils.smoothstep(rain, .2, .9);
    const wetting = MathUtils.lerp(RAIN_TIMES.wetting[0], RAIN_TIMES.wetting[1], rain);
    this.rain.value = jump ? wet : dt > 0 ? ease(this.rain.value, wet, dt, wetting, RAIN_TIMES.drying) : this.rain.value;
    this.flow.value = jump ? flow : dt > 0 ? ease(this.flow.value, flow, dt, RAIN_TIMES.flowing, RAIN_TIMES.draining) : this.flow.value;
    this.updateSpray(dt, frame, jump);
  }

  diagnostics() {
    return { rain: +this.rain.value.toFixed(3), flow: +this.flow.value.toFixed(3), sprayCeiling: +this.ceiling.value.toFixed(1),
      spray: [...this.levels.values()].map(entry => +entry.level.toFixed(3)) };
  }

  private updateSpray(dt: number, { seaHeight, waveDirection, ships, camera }: ShipWeatherFrame, jump: boolean): void {
    const present = new Set(ships.map(ship => ship.root));
    for (const root of this.levels.keys()) if (!present.has(root)) this.levels.delete(root);
    const waveX = Math.cos(waveDirection), waveZ = Math.sin(waveDirection);
    const wetted = ships.map(ship => {
      const { motion } = ship, hull = this.hull(ship);
      const sin = Math.sin(motion.heading), cos = Math.cos(motion.heading);
      // Meeting the sea: 1 steaming straight into the waves, 0 running before them.
      const head = Math.max(0, -(sin * waveX - cos * waveZ));
      const speed = smooth(Math.max(0, motion.speed), SPRAY.speed);
      const pitch = motion.pitch ?? 0, entry = this.levels.get(ship.root) ?? { level: 0, pitch };
      // A bow dropping into a sea ships the most water; the pitch rate picks out each plunge.
      const plunge = dt > 0 ? smooth((entry.pitch - pitch) / dt, SPRAY.plunge) : 0;
      entry.pitch = pitch;
      const over = seaHeight * (.5 + .5 * head) * (.5 + speed) / hull.freeboard;
      const target = motion.speed > 1 ? smooth(over, SPRAY.sea) * (.65 + .35 * plunge) : 0;
      entry.level = this.sprayOverride >= 0 ? this.sprayOverride
        : jump ? target : dt > 0 ? ease(entry.level, target, dt, SPRAY.wetting, SPRAY.drying) : entry.level;
      this.levels.set(ship.root, entry);
      return { ship, hull, sin, cos, level: entry.level, distance: Math.hypot(motion.x - camera.position.x, motion.z - camera.position.z) };
    }).filter(entry => entry.level > .01).sort((a, b) => a.distance - b.distance).slice(0, SPRAY_SLOTS);
    let ceiling = 0;
    wetted.forEach(({ ship: { motion }, hull, sin, cos, level }, slot) => {
      // The authoring origin need not be amidships: place the stem from the hull's own extents, as the bow waves do.
      const ahead = hull.length * .49 - hull.centerZ;
      const top = hull.freeboard + 2 + SPRAY.climb * level;
      this.packed.sections[POSE][slot].set(motion.x + cos * hull.centerX + sin * ahead, motion.z + sin * hull.centerX - cos * ahead, sin, cos);
      this.packed.sections[BOW][slot].set(hull.length, hull.beam / 2, level, top);
      ceiling = Math.max(ceiling, top);
    });
    this.count.value = wetted.length;
    this.ceiling.value = ceiling;
  }

  private hull(ship: WakeShip) {
    let hull = this.hulls.get(ship.root);
    if (!hull) {
      const { draft, depth, length } = ship.definition.hull, extents = wakeHull(ship.definition.hull);
      // Freeboard amidships; a hull without a sensible depth takes a typical one for her length.
      const freeboard = depth > draft && depth - draft < 30 ? depth - draft : 1.5 + .045 * length;
      this.hulls.set(ship.root, hull = { ...extents, freeboard: Math.max(3, freeboard) });
    }
    return hull;
  }

  /** Spray wetness (0 … 1) of the fragment from whichever bow in reach throws it: strongest at the stem, thinning aft and
   * upward, and broken into patches that stay on the ship. */
  private spray(): Node<'float'> {
    return Fn(() => {
      const p = positionWorld, wet = float(0).toVar();
      If(this.count.greaterThan(0).and(p.y.lessThan(this.ceiling)), () => {
        Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
          const pose = this.packed.element(POSE, i), bow = this.packed.element(BOW, i);
          const dx = p.x.sub(pose.x), dz = p.z.sub(pose.y);
          // Ship frame: `a` metres astern of the stem, `y` to starboard.
          const a = dz.mul(pose.w).sub(dx.mul(pose.z)).toVar(), y = dx.mul(pose.w).add(dz.mul(pose.z)).toVar();
          const reach = bow.x.mul(SPRAY.aft).mul(bow.z).max(1).toVar();
          If(a.greaterThan(-3).and(a.lessThan(reach)).and(abs(y).lessThan(bow.y.add(2))), () => {
            const along = a.max(0).div(reach), top = bow.w.mul(float(1).sub(along.mul(.55)));
            const body = float(1).sub(smoothstep(.3, 1, along)).mul(float(1).sub(smoothstep(top.mul(.55), top, p.y)));
            const patches = mx_noise_float(vec3(a.mul(.3), p.y.mul(.45), y.mul(.3))).mul(.5).add(mx_noise_float(vec3(a.mul(1.1), p.y.mul(1.4), y.mul(1.1).add(5))).mul(.25));
            wet.assign(max(wet, smoothstep(.15, .55, body.add(patches.mul(.45)).mul(body.min(1).sqrt())).mul(bow.z.min(1))));
          });
        });
      });
      return wet;
    })();
  }

  /** Rain's albedo (x) and roughness (y) multipliers, exactly 1 while the ships are dry. */
  private rained(timber: boolean): Node<'vec2'> {
    return Fn((builder: NodeBuilder) => {
      const factor = vec2(1).toVar();
      // Where the ship occlusion runs, it finds what lies deep in shelter (under a gallery or a bridge wing): that stays drier.
      const ao = (builder.material as { aoNode?: Node<'float'> | null } | null)?.aoNode ?? null;
      // The geometric normal's height in the world. Taken outside the branch: three declares its shared normal where first built,
      // and the lighting reads it after.
      const up = vec4(normalViewGeometry, 0).mul(cameraViewMatrix).y.toVar();
      If(this.rain.greaterThan(0), () => {
        const q = positionGeometry, source = attribute<'vec4'>('shipSurface', 'vec4').x.max(.02).toVar();
        const deck = smoothstep(.3, .75, up), wall = float(1).sub(deck).mul(smoothstep(-.35, -.05, up));
        const shelter = ao ? smoothstep(.2, .6, ao) : float(1);
        // Standing water only where a deck lies flat, in patches that stay on the ship.
        const pooled = float(0).toVar();
        If(up.greaterThan(.95).and(this.flow.greaterThan(0)), () => {
          const patch = mx_noise_float(vec3(q.x.div(3.5), q.z.div(3.5), 11)).mul(.6).add(mx_noise_float(vec3(q.x.div(1.2), q.z.div(1.2), 17)).mul(.3));
          pooled.assign(smoothstep(.45 - RAIN.pooled, .55, patch.mul(.5).add(.5)).mul(smoothstep(.95, .99, up)).mul(this.flow).mul(this.rain));
        });
        let stream: Node<'float'> = float(0);
        if (!timber) {
          // Water streams down a wall along the paths the wear's runoff streaks take, from each wall's top edge.
          const worn = attribute<'vec4'>('shipWear', 'vec4'), m = normalGeometry.normalize();
          const ax = pow(abs(m.x), 4), az = pow(abs(m.z), 4), beam = ax.div(ax.add(az).add(1e-4));
          const v = worn.y.div(STREAK.down * RAIN.run);
          const paths = mix(runoffStreaks(q.x.div(STREAK.along), v).w, runoffStreaks(q.z.div(STREAK.along), v).w, beam);
          stream = worn.x.greaterThan(0).select(paths, 0).mul(this.flow);
        }
        const exposure = deck.add(wall.mul(float(RAIN.wallFilm).add(stream.mul(1 - RAIN.wallFilm)))).min(1).mul(shelter);
        const wet = this.rain.mul(exposure).toVar();
        const darkening = timber ? float(RAIN.timberDarkening) : mix(float(RAIN.darkening[0]), float(RAIN.darkening[1]), smoothstep(RAIN.porous[0], RAIN.porous[1], source));
        const film = timber ? float(RAIN.timberFilm) : mix(float(RAIN.wall), float(RAIN.film), deck);
        const glossed = mix(float(1), min(film.div(source), 1), wet);
        factor.assign(vec2(float(1).sub(wet.mul(darkening)).sub(pooled.mul(RAIN.poolDarkening)), mix(glossed, min(float(RAIN.pool).div(source), 1), pooled)));
      });
      return factor;
    })();
  }
}
