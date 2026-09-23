import { Matrix4, Vector4, type Camera, type Node, type Object3D, type PerspectiveCamera } from 'three/webgpu';
import { Fn, If, Loop, cameraPosition, exp, float, floor, max, mix, mx_noise_float, positionWorld, smoothstep, uniform, uniformArray, vec3, vec4 } from 'three/tsl';
import type { WakeShip } from './FleetWakeFoam';
import { hullWaterlineProfile, PROFILE_LEVELS, PROFILE_LEVEL_STEP, PROFILE_LOWEST, PROFILE_STATIONS, type WaterlineProfile } from './hullWaterlineProfile';

/** Hulls with a foam line at once; the nearest to the camera keep theirs. */
export const HULL_FOAM_SLOTS = 8;
/** Beyond this range the line is narrower than a pixel and fades out anyway. */
const REACH = 4000;
/** Empty stations read as this share of the half beam inside the centreline, so no foam reaches past the ends. */
const EMPTY = .25;
/** Per slot: a bounding circle, three rows of the world-to-hull matrix, the shape, the drive, then one vec4 per level and
 * station holding that station's and the next one's starboard and port half-breadths. One uniform
 * buffer, not a texture: the water's fragment stage is already at the sampled-texture limit. */
const PROFILE = 6, STRIDE = PROFILE + PROFILE_LEVELS * PROFILE_STATIONS;

/** Live-tunable look of the foam that hugs a hull where it meets the water. Visual only. */
export const HULL_FOAM_TUNING = {
  /** Coverage along a hull lying still in calm water, and what a rough sea adds per metre of significant height. */
  rest: .2, sea: .035,
  /** Coverage added at full speed along the side, and again toward the stem. */
  underway: .4, bow: .55,
  /** Metres of foam outboard of the hull at rest, per metre of significant height, and at full speed. */
  width: .9, seaWidth: .18, speedWidth: 1.4,
  /** Share of the hull length, from the stem, over which the bow's extra foam fades. */
  bowLength: .3,
};
export type HullFoamTuning = typeof HULL_FOAM_TUNING;

const profiles = new WeakMap<object, WaterlineProfile | null>();
/** Slowest single hull slice so far, in milliseconds. */
let slowestSlice = 0;
/** Hulls sliced during a frame because nothing primed them while loading. */
let lateSlices = 0;

/** Slice a hull once per definition, while its model loads: a detailed model takes tens to
 * hundreds of milliseconds, too long to spend inside a battle frame. Every clone draws the same hull. */
export function primeHullProfile(definition: object, model: Object3D): void {
  if (profiles.has(definition)) return;
  const start = performance.now();
  profiles.set(definition, hullWaterlineProfile(model) ?? null);
  slowestSlice = Math.max(slowestSlice, performance.now() - start);
}

/** Hulls that arrive without a primed slice, such as a report-only exterior, are sliced on first sight. */
function profileOf(ship: WakeShip): WaterlineProfile | undefined {
  if (!profiles.has(ship.definition)) lateSlices++;
  primeHullProfile(ship.definition, ship.root);
  return profiles.get(ship.definition) ?? undefined;
}

/** A narrow line of broken water around each hull at the water's surface, read from the hull's
 * own sliced waterline, so it hugs the drawn hull at any heave, pitch and roll. */
export class HullContactFoam {
  readonly tuning: HullFoamTuning = { ...HULL_FOAM_TUNING };
  enabled = true;
  /** Significant wave height of the sea on show, in metres. */
  seaHeight = 0;
  private readonly values = Array.from({ length: HULL_FOAM_SLOTS * STRIDE }, () => new Vector4());
  private readonly data = uniformArray<'vec4'>(this.values, 'vec4');
  private readonly count = uniform(0, 'int');
  private readonly time = uniform(0);
  private readonly pixelAngle = uniform(.001);
  private readonly bowLength = uniform(HULL_FOAM_TUNING.bowLength);
  private readonly speeds = new Map<WakeShip['root'], number>();
  private readonly slotProfiles: (WaterlineProfile | undefined)[] = [];
  private readonly matrix = new Matrix4();
  private node?: { x: object; z: object; foam: Node<'float'> };

  /** Foam coverage on the water. `x`/`z` anchor the noise; the hull test reads the fragment's drawn position. */
  foam(x: Node<'float'>, z: Node<'float'>): Node<'float'> {
    if (this.node?.x === x && this.node.z === z) return this.node.foam;
    const foam = this.evaluate(x, z);
    this.node = { x, z, foam };
    return foam;
  }

  update(ships: readonly WakeShip[], dt: number, camera?: Camera, drawingHeight = 1080): void {
    const tuning = this.tuning;
    if (dt > 0) this.time.value += dt;
    this.bowLength.value = tuning.bowLength;
    const perspective = camera as PerspectiveCamera | undefined;
    if (perspective?.isPerspectiveCamera) this.pixelAngle.value = 2 * Math.tan(perspective.fov * Math.PI / 360) / (perspective.zoom || 1) / Math.max(drawingHeight, 1);
    const present = new Set(ships.map(ship => ship.root));
    for (const root of this.speeds.keys()) if (!present.has(root)) this.speeds.delete(root);
    const candidates = this.enabled ? ships.map(ship => {
      // A submarine's hull leaves the surface as it dives; a laden surface hull may ride metres below its design waterline.
      const surface = Math.max(0, Math.min(1, 1 + (ship.motion.y + ship.definition.hull.draft * .6) / 3));
      const target = Math.min(1, Math.abs(ship.motion.speed) / Math.max(ship.definition.handling.forwardSpeed, 1)) * surface;
      const previous = this.speeds.get(ship.root) ?? target;
      const speed = dt > 0 ? previous + (target - previous) * (1 - Math.exp(-dt / 2.5)) : previous;
      this.speeds.set(ship.root, speed);
      const distance = camera ? Math.hypot(ship.motion.x - camera.position.x, ship.motion.z - camera.position.z) : 0;
      return { ship, speed, distance, surface };
    }).filter(entry => entry.distance < REACH && entry.surface > .2).sort((a, b) => a.distance - b.distance) : [];
    let slot = 0;
    for (const { ship, speed, surface } of candidates) {
      if (slot >= HULL_FOAM_SLOTS) break;
      const sea = Math.min(this.seaHeight, 8), scale = Math.max(.6, Math.min(1.3, ship.definition.hull.beam / 32));
      const width = (tuning.width + tuning.seaWidth * sea + tuning.speedWidth * speed) * scale;
      // Distant hulls are culled before their first slice, which costs tens of milliseconds for a detailed model.
      if (camera && this.subPixel(width, ship, camera)) continue;
      const profile = profileOf(ship);
      if (!profile) continue;
      // The drawn pose, not the simulation's: the line must stay on the hull the player sees.
      ship.root.updateMatrix();
      const e = this.matrix.copy(ship.root.matrix).invert().elements;
      const base = slot * STRIDE, length = profile.stern - profile.bow;
      for (let row = 0; row < 3; row++) this.values[base + 1 + row].set(e[row], e[row + 4], e[row + 8], e[row + 12]);
      if (this.slotProfiles[slot] !== profile) { this.writeProfile(slot, profile); this.slotProfiles[slot] = profile; }
      this.values[base + 4].set(profile.start, profile.spacing, profile.halfBeam, profile.bow);
      this.values[base + 5].set((tuning.rest + tuning.sea * sea + tuning.underway * speed) * surface, tuning.bow * speed * surface,
        width, Math.max(length, 1));
      // Every open-water pixel tests this circle alone; only water near a hull reads the rest.
      const mid = (profile.start + profile.spacing * (PROFILE_STATIONS - 1) / 2), reach = Math.hypot(profile.spacing * PROFILE_STATIONS / 2, profile.halfBeam) + 3 * width;
      const m = ship.root.matrix.elements;
      this.values[base].set(m[12] + m[8] * mid, m[14] + m[10] * mid, reach * reach, 0);
      slot++;
    }
    this.count.value = slot;
  }

  /** A line this far off spans a small share of the three pixels the fragment stage needs, and fades to nothing there anyway. */
  private subPixel(width: number, ship: WakeShip, camera: Camera): boolean {
    const range = Math.max(1, Math.hypot(ship.motion.x - camera.position.x, camera.position.y, ship.motion.z - camera.position.z));
    const finest = range * this.pixelAngle.value / Math.max(Math.abs(camera.position.y) / range, .04) * 3;
    return width / finest < .05;
  }

  reset(): void { this.speeds.clear(); this.count.value = 0; }
  dispose(): void { this.reset(); }
  diagnostics() { return { enabled: this.enabled, slots: this.count.value, slowestSliceMs: +slowestSlice.toFixed(1), lateSlices }; }

  private writeProfile(slot: number, profile: WaterlineProfile): void {
    const empty = -EMPTY * profile.halfBeam, read = (values: Float32Array, i: number) => Number.isNaN(values[i]) ? empty : values[i];
    for (let level = 0; level < PROFILE_LEVELS; level++) for (let station = 0; station < PROFILE_STATIONS; station++) {
      const i = level * PROFILE_STATIONS + station, next = level * PROFILE_STATIONS + Math.min(station + 1, PROFILE_STATIONS - 1);
      this.values[slot * STRIDE + PROFILE + i].set(read(profile.starboard, i), read(profile.port, i), read(profile.starboard, next), read(profile.port, next));
    }
  }

  private evaluate(x: Node<'float'>, z: Node<'float'>): Node<'float'> {
    return Fn(() => {
      const foam = float(0).toVar();
      // The surface passes its undisplaced grid point; the hull meets the water where the surface is drawn.
      const point = vec4(positionWorld, 1), wx = positionWorld.x, wz = positionWorld.z;
      const range = vec3(cameraPosition.x.sub(x), cameraPosition.y, cameraPosition.z.sub(z)).length().max(1);
      // Three pixels stretched by the grazing view: a line narrower than that fades instead of shimmering.
      const finest = range.mul(this.pixelAngle).div(cameraPosition.y.abs().div(range).max(.04)).mul(3).toVar();
      Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
        const base = i.mul(STRIDE).toVar(), bound = this.data.element(base);
        const dx = wx.sub(bound.x), dz = wz.sub(bound.y);
        If(dx.mul(dx).add(dz.mul(dz)).lessThan(bound.z), () => {
          const shape = this.data.element(base.add(4)), drive = this.data.element(base.add(5));
          const lx = this.data.element(base.add(1)).dot(point).toVar();
          const lz = this.data.element(base.add(3)).dot(point).toVar();
          const width = drive.z, length = drive.w, half = shape.z;
          If(lx.abs().lessThan(half.add(width.mul(3))).and(lz.greaterThan(shape.w.sub(width.mul(3)).sub(shape.y)))
            .and(lz.lessThan(shape.w.add(length).add(width.mul(3)).add(shape.y))), () => {
            // Bilinear in station and level: the hull's breadth where the water actually stands against it.
            const ly = this.data.element(base.add(2)).dot(point);
            const level = ly.sub(PROFILE_LOWEST).div(PROFILE_LEVEL_STEP).clamp(0, PROFILE_LEVELS - 1);
            const lower = floor(level).min(PROFILE_LEVELS - 2), rise = level.sub(lower);
            const station = lz.sub(shape.x).div(shape.y).clamp(0, PROFILE_STATIONS - 1);
            const first = floor(station).min(PROFILE_STATIONS - 2), along = station.sub(first);
            const cell = base.add(PROFILE).add(lower.toInt().mul(PROFILE_STATIONS)).add(first.toInt());
            const below = this.data.element(cell), above = this.data.element(cell.add(PROFILE_STATIONS));
            const breadth = mix(mix(below.xy, below.zw, along), mix(above.xy, above.zw, along), rise);
            // Metres outboard of the hull's side on this side of the centreline.
            const edge = lx.greaterThanEqual(0).select(lx.sub(breadth.x), lx.negate().sub(breadth.y)).toVar();
            const blurred = max(width, finest).toVar();
            const across = edge.sub(blurred.mul(.3)).div(blurred);
            const line = exp(across.mul(across).negate()).mul(smoothstep(-.6, 0, edge)).mul(width.div(blurred));
            const fromBow = lz.sub(shape.w).div(length).max(0);
            const strength = drive.x.add(drive.y.mul(float(1).sub(smoothstep(0, this.bowLength, fromBow))));
            const white = line.mul(strength).toVar();
            If(white.greaterThan(.01), () => {
              // World-anchored eddies: the water streams aft past a moving hull and churns slowly at rest.
              const strands = mx_noise_float(vec3(x.mul(.21), z.mul(.21), this.time.mul(.35)));
              const flecks = mx_noise_float(vec3(x.mul(.63).add(5), z.mul(.63), this.time.mul(.8)));
              // Distant water keeps the mean coverage instead of sub-pixel noise.
              const detail = float(1).sub(smoothstep(1.5, 6, finest));
              const noise = strands.mul(.6).add(flecks.mul(.4)).mul(detail);
              foam.assign(max(foam, smoothstep(.1, .7, white.add(noise.mul(.6))).mul(white.min(.8))));
            });
          });
        });
      });
      return foam;
    })();
  }
}
