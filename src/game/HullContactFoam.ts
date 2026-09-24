import { Matrix4, Vector4, type Camera, type Node, type Object3D, type PerspectiveCamera } from 'three/webgpu';
import { Fn, If, Loop, atan, cameraPosition, exp, float, floor, max, mix, mx_noise_float, normalize, positionWorld, select, smoothstep, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { WakeShip } from './FleetWakeFoam';
import { hullWaterlineProfile, PROFILE_LEVELS, PROFILE_LEVEL_STEP, PROFILE_LOWEST, PROFILE_STATIONS, type WaterlineProfile } from './hullWaterlineProfile';

/** Hulls with a foam line at once; the nearest to the camera keep theirs. */
export const HULL_FOAM_SLOTS = 8;
/** Beyond this range the line is narrower than a pixel and fades out anyway. */
const REACH = 4000;
/** Empty stations read as this share of the half beam inside the centreline, so no foam reaches past the ends. */
const EMPTY = .25;
/** Per slot: a bounding circle (centre, then the squared reach of the foam and of the shelter), three rows of the
 * world-to-hull matrix, the shape, the drive, the shelter, then one vec4 per level and station holding that station's
 * and the next one's starboard and port half-breadths, then one per station holding its and the next one's starboard
 * and port side heights. One uniform buffer, not a texture: the water's fragment stage is near the sampler limit. */
const PROFILE = 7, SIDES = PROFILE + PROFILE_LEVELS * PROFILE_STATIONS, STRIDE = SIDES + PROFILE_STATIONS;
/** Distances from a hull's side, in heights of the side above the water, over which its shelter fades out: a wall
 * hides 2.6% of the sky's light from water three heights off and 1% five heights off (its view factor). */
const SHELTER_FADE = 3, SHELTER_REACH = 5;
/** Share of the foam's reach (`REACH`) beyond which the shelter fades out with the camera's range, so a hull leaving
 * the slots takes it smoothly. */
const SHELTER_RANGE_FADE = .75;
/** Softest edge (radians) of the side's top in a mirrored lobe: a flat sea's reflection of a deck edge still blurs over
 * a few pixels. */
const MIRROR_EDGE = .02;

/** Live-tunable look of the foam that hugs a hull where it meets the water. Visual only. The surface
 * shades wake foam energy from 0.05 (first flecks) to 0.6 (solid), so these coverages stay below that. */
export const HULL_FOAM_TUNING = {
  /** Coverage along a hull lying still in calm water, and what a rough sea adds per metre of significant height. */
  rest: .12, sea: .025,
  /** Coverage added at full speed along the side, and again toward the stem. */
  underway: .3, bow: .4,
  /** Metres of foam outboard of the hull at rest, per metre of significant height, and at full speed. */
  width: .9, seaWidth: .1, speedWidth: 1.2,
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

/** Three's smoothstep on the CPU. */
const smoothstepCpu = (low: number, high: number, x: number) => { const t = Math.min(1, Math.max(0, (x - low) / (high - low))); return t * t * (3 - 2 * t); };
/** The tallest side of a profile, in metres above the design waterline. */
const tallestSide = (profile: WaterlineProfile) => Math.max(...profile.starboardSide, ...profile.portSide);

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
  /** Scale of every hull's shelter of the water beside it (1 as seen, 0 none), read each update: for comparisons. */
  shelterStrength = 1;
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
  private shelterNode?: { x: object; z: object; direction: object; spread: object; shelter: Node<'vec4'> };

  /** Foam coverage on the water. `x`/`z` anchor the noise; the hull test reads the fragment's drawn position. */
  foam(x: Node<'float'>, z: Node<'float'>): Node<'float'> {
    if (this.node?.x === x && this.node.z === z) return this.node.foam;
    const foam = this.evaluate(x, z);
    this.node = { x, z, foam };
    return foam;
  }

  /** How the hulls near a point stand over the water there (see `WakeSampler.shelter`): the share of the sky's light
   * their sides hide, the share of the mirrored lobe along `direction` (spread `spread` radians) that meets a side
   * instead of the sky, and that side's horizontal outward normal. */
  shelter(x: Node<'float'>, z: Node<'float'>, direction: Node<'vec3'>, spread: Node<'float'>): Node<'vec4'> {
    const cached = this.shelterNode;
    if (cached?.x === x && cached.z === z && cached.direction === direction && cached.spread === spread) return cached.shelter;
    const shelter = this.evaluateShelter(direction, spread);
    this.shelterNode = { x, z, direction, spread, shelter };
    return shelter;
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
      // Distant hulls are culled before their first slice, which costs tens of milliseconds for a detailed model. The
      // shelter spans about the side's height, a third of the beam, off each side.
      if (camera && this.subPixel(Math.max(width, ship.definition.hull.beam * .3), ship, camera)) continue;
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
      const range = camera ? Math.hypot(ship.motion.x - camera.position.x, ship.motion.z - camera.position.z) : 0, shelterReach = SHELTER_REACH * Math.max(tallestSide(profile), 1);
      this.values[base + 6].set(this.shelterStrength * surface * (1 - smoothstepCpu(REACH * SHELTER_RANGE_FADE, REACH, range)), shelterReach, 0, 0);
      // Every open-water pixel tests these circles alone; only water near a hull reads the rest.
      const mid = (profile.start + profile.spacing * (PROFILE_STATIONS - 1) / 2), hull = Math.hypot(profile.spacing * PROFILE_STATIONS / 2, profile.halfBeam);
      const reach = hull + 3 * width, shelter = hull + shelterReach;
      const m = ship.root.matrix.elements;
      this.values[base].set(m[12] + m[8] * mid, m[14] + m[10] * mid, reach * reach, shelter * shelter);
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
    for (let station = 0; station < PROFILE_STATIONS; station++) {
      const next = Math.min(station + 1, PROFILE_STATIONS - 1);
      this.values[slot * STRIDE + SIDES + station].set(profile.starboardSide[station], profile.portSide[station], profile.starboardSide[next], profile.portSide[next]);
    }
  }

  /** Each hull side is taken as a vertical wall standing on its waterline, from the stem to the stern, as tall as the
   * side's height above the water at the pixel. Its view factor from the water (a horizontal element beside a vertical
   * rectangle: (atan X − atan(X/√(1+Y²))/√(1+Y²))/2π for each end, X the end's distance along the side and Y the
   * wall's height, both over the distance out from it) is the share of the sky's diffuse light it hides: half beside
   * an endless tall wall, 14% a height off, 2.6% three heights off, and nothing past the ends. The mirrored ray meets
   * the wall where it reaches it below its top and between its ends; the lobe's spread softens its top. Every hull's
   * sky hides independently; the mirror keeps the side that fills most of the lobe, and the normal is the side's that
   * shelters the water most. Both fade out between three and
   * five heights from the side, and with the camera's range, so neither leaves a line in open water. */
  private evaluateShelter(direction: Node<'vec3'>, spread: Node<'float'>): Node<'vec4'> {
    return Fn(() => {
      const open = float(1).toVar(), mirror = float(0).toVar(), outward = vec2(0).toVar(), dominant = float(0).toVar();
      const point = vec4(positionWorld, 1), ray = vec4(direction, 0), edgeSoftness = spread.max(MIRROR_EDGE);
      Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
        const base = i.mul(STRIDE).toVar(), bound = this.data.element(base);
        const dx = positionWorld.x.sub(bound.x), dz = positionWorld.z.sub(bound.y);
        If(dx.mul(dx).add(dz.mul(dz)).lessThan(bound.w), () => {
          const across = this.data.element(base.add(1)), rows = [across, this.data.element(base.add(2)), this.data.element(base.add(3))];
          const shape = this.data.element(base.add(4)), drive = this.data.element(base.add(5)), shelter = this.data.element(base.add(6));
          const lx = rows[0].dot(point).toVar(), ly = rows[1].dot(point).toVar(), lz = rows[2].dot(point).toVar();
          const bow = shape.w, stern = shape.w.add(drive.w), starboard = lx.greaterThanEqual(0), strength = shelter.x, reach = shelter.y;
          // Water farther out than the tallest side's reach takes no shelter from this hull.
          If(lx.abs().lessThan(shape.z.add(reach)).and(lz.greaterThan(bow.sub(reach))).and(lz.lessThan(stern.add(reach))), () => {
            const stationOf = (z: Node<'float'>) => z.sub(shape.x).div(shape.y).clamp(bow.sub(shape.x).div(shape.y), stern.sub(shape.x).div(shape.y));
            const cellOf = (station: Node<'float'>) => { const first = floor(station).min(PROFILE_STATIONS - 2); return { first, along: station.sub(first) }; };
            // The side's height where a station stands: the side on this side of the centreline, above this water.
            const sideAt = (station: Node<'float'>) => {
              const { first, along } = cellOf(station), cell = this.data.element(base.add(SIDES).add(first.toInt()));
              const height = mix(cell.xy, cell.zw, along);
              return select(starboard, height.x, height.y).sub(ly).max(0);
            };
            // Breadth at the water's level, as the foam reads it, at the nearest station of the hull.
            const station = stationOf(lz).toVar(), { first, along } = cellOf(station);
            const level = ly.sub(PROFILE_LOWEST).div(PROFILE_LEVEL_STEP).clamp(0, PROFILE_LEVELS - 1);
            const lower = floor(level).min(PROFILE_LEVELS - 2), rise = level.sub(lower);
            const cell = base.add(PROFILE).add(lower.toInt().mul(PROFILE_STATIONS)).add(first.toInt());
            const below = this.data.element(cell), above = this.data.element(cell.add(PROFILE_STATIONS));
            const breadth = mix(mix(below.xy, below.zw, along), mix(above.xy, above.zw, along), rise);
            const out = lx.abs().sub(select(starboard, breadth.x, breadth.y)).max(.05).toVar();
            const wall = sideAt(station).toVar();
            const fade = float(1).sub(smoothstep(wall.mul(SHELTER_FADE), wall.mul(SHELTER_REACH).add(1e-3), out)).mul(strength).toVar();
            // The view factor of the wall, both ends.
            const k = float(1).div(wall.div(out).pow(2).add(1).sqrt());
            const end = (x: Node<'float'>) => atan(x).sub(atan(x.mul(k)).mul(k));
            const hidden = end(lz.sub(bow).div(out)).add(end(stern.sub(lz).div(out))).div(2 * Math.PI).clamp(0, .5);
            const hides = hidden.mul(fade).toVar();
            open.mulAssign(float(1).sub(hides));
            // The mirrored ray: where it reaches the wall's plane, and whether it passes below the wall's top there.
            const local = vec3(rows[0].dot(ray), rows[1].dot(ray), rows[2].dot(ray)).toVar();
            const toward = select(starboard, local.x.negate(), local.x), flat = local.xz.length().max(1e-4);
            const travel = out.div(toward.max(1e-3)).min(4000), hit = lz.add(local.z.mul(travel));
            const top = atan(sideAt(stationOf(hit)), travel.mul(flat)).sub(atan(local.y.max(0), flat));
            const ends = smoothstep(bow.sub(shape.y), bow.add(shape.y), hit).mul(smoothstep(stern.add(shape.y), stern.sub(shape.y), hit));
            const met = smoothstep(edgeSoftness.negate(), edgeSoftness, top).mul(smoothstep(0, .05, toward)).mul(ends).mul(fade);
            mirror.assign(max(mirror, met));
            // The side that shelters this water most names the light the water sees on it.
            If(max(met, hides).greaterThan(dominant), () => {
              dominant.assign(max(met, hides));
              outward.assign(normalize(across.xz.mul(select(starboard, float(1), float(-1))).add(vec2(1e-6, 0))));
            });
          });
        });
      });
      return vec4(float(1).sub(open), mirror, outward);
    })();
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
              foam.assign(max(foam, smoothstep(.1, .7, white.add(noise.mul(.6))).mul(white.min(.55))));
            });
          });
        });
      });
      return foam;
    })();
  }
}
