/** The sea hulls ride, drawn where they ride it. Combat poses every hull on its own long-wave sea (a few long-crested
 * sines, renderer-free); the wave field draws an unrelated spectrum with the same height statistics. Near each hull
 * this blends the field's long waves (the first cascade low-passed by its mip chain) into the combat sea at the
 * simulation's clock, keeping the field's shorter waves, foam, wake and bow waves on top, and fades back to the field
 * further out. Presentation only: nothing here reaches combat.
 *
 * Only the realistic sea state couples. The art-directed sea (the switch off) peaks at a quarter of combat's wavelength
 * at the breaking limit, so the water beside a hull is ruled by waves no hull in combat follows: in a live 30 m/s battle
 * blending combat's swell into it left the gap to a hull's still-water line at 3.7–3.9 m rms, where on the realistic sea
 * it falls from 2.5–3.5 m to 1.4–2.0 m. That switch keeps the look it was tuned to, for comparison.
 *
 * The pure functions below are what the nodes evaluate, for tests and CPU callers. */
import { Vector2, Vector4, type Node } from 'three/webgpu';
import { Fn, Loop, clamp, cos, dot, exp, float, inverseSqrt, renderGroup, sin, smoothstep, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { HullFootprint, HullSeaWave } from '../contracts';
import { GRAVITY } from './spectrum';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;

/** Hulls coupled at once: the nearest to the camera (the wake field and bow waves take eight). */
export const HULL_SEA_SLOTS = 16;
/** Components of the combat sea (two long sines). */
export const HULL_SEA_WAVES = 2;
/** Full coupling out to this share of the hull length from its centre line (bow wave and waterline included), and
 * at least this share of the longest wave: the crest and trough beside the hull are then the ones it rides. */
export const HULL_REACH = .3, WAVE_REACH = .25;
/** The coupling fades over at least a hull length and the longest wavelength. The blend tilts the sea by the
 * difference between the two seas over the fade, so over a wavelength it tilts it no more than the waves themselves do. */
export const FADE_HULLS = 1, FADE_WAVES = 1;
/** Drawn waves at least this share of the longest combat wave long count as long: they lift and drop the water around
 * a hull on the combat sea's own scale (its shorter component is 0.57 of it), where shorter ones are chop the hull's
 * length averages away. */
export const LONG_WAVES = .5;
/** Long waves left beside a hull count this many times the shorter waves taken from around it: the coupling exists for
 * the hull's agreement, and the authority's own easing already leaves it 1.5–2 m rms in a storm. */
export const SPLIT_LEAK_WEIGHT = 2;
/** Split levels tried, in mip levels. */
const SPLIT_STEP = .25;

/** One hull's reach, packed as the nodes read it: centre, bow axis, half length, full and zero coupling radii from
 * the centre line, and contact (0 for a hull nothing of which reaches the surface). */
export interface HullSeaSlot { x: number; z: number; axisX: number; axisZ: number; half: number; inner: number; outer: number; contact: number }

/** Longest wavelength (m) of the combat sea; 0 without components. */
export function hullSeaWavelength(waves: readonly HullSeaWave[]): number {
  return waves.reduce((longest, wave) => Math.max(longest, wave.wavelength), 0);
}

export function hullSeaSlot(hull: HullFootprint, wavelength: number): HullSeaSlot {
  const inner = Math.max(HULL_REACH * hull.length, .75 * hull.beam, WAVE_REACH * wavelength);
  return { x: hull.x, z: hull.z, axisX: Math.cos(hull.bearing), axisZ: Math.sin(hull.bearing), half: hull.length / 2,
    inner, outer: inner + Math.max(FADE_HULLS * hull.length, FADE_WAVES * wavelength, 1), contact: Math.max(0, Math.min(1, hull.contact)) };
}

/** Coupling weight at (x, z), 0–1, and its gradient: each hull's smoothstep of the distance from its centre line, joined
 * as 1 − Π(1 − wᵢ), which is smooth where two hulls' reaches overlap (a max would crease the lighting there). */
export function hullSeaWeight(slots: readonly HullSeaSlot[], x: number, z: number): { weight: number; dx: number; dz: number } {
  let keep = 1, gx = 0, gz = 0;
  for (const slot of slots) {
    const rx = x - slot.x, rz = z - slot.z;
    const t = Math.max(-slot.half, Math.min(slot.half, rx * slot.axisX + rz * slot.axisZ));
    const qx = rx - slot.axisX * t, qz = rz - slot.axisZ * t, d = Math.hypot(qx, qz);
    const span = Math.max(slot.outer - slot.inner, 1e-3), s = Math.max(0, Math.min(1, (d - slot.inner) / span));
    const w = slot.contact * (1 - s * s * (3 - 2 * s));
    const rate = -slot.contact * 6 * s * (1 - s) / span / Math.max(d, 1e-3);
    gx = gx * (1 - w) - rate * qx * keep; gz = gz * (1 - w) - rate * qz * keep;
    keep *= 1 - w;
  }
  return { weight: 1 - keep, dx: -gx, dz: -gz };
}

/** Coefficients of the blend at weight w: height = field + lowpass·(field's long waves) + sea·(combat sea). The two are
 * uncorrelated, so a plain cross-fade would calm the ring between them (0.71 of the swell at w = ½); both scale by
 * 1/√((1 − w)² + w²), which keeps the variance of seas of equal height. `dLowpass` and `dSea` are d/dw. */
export function hullSeaBlend(w: number): { lowpass: number; sea: number; dLowpass: number; dSea: number } {
  const n = 1 / Math.sqrt(1 - 2 * w + 2 * w * w), dn = (1 - 2 * w) * n * n * n;
  return { lowpass: n * (1 - w) - 1, sea: n * w, dLowpass: dn * (1 - w) - n, dSea: dn * w + n };
}

/** Height (m) of the combat sea at (x, z) and `time` (s): Σ a·sin(k·(x cos θ + z sin θ) − ω·t + φ), ω = √(g·k). */
export function hullSeaHeight(waves: readonly HullSeaWave[], time: number, x: number, z: number): number {
  let height = 0;
  for (const wave of waves) {
    const k = 2 * Math.PI / wave.wavelength;
    height += wave.amplitude * Math.sin(k * (x * Math.cos(wave.direction) + z * Math.sin(wave.direction)) - Math.sqrt(GRAVITY * k) * time + wave.phase);
  }
  return height;
}

/** A component as the nodes read it: wave vector, amplitude and phase at `time` about `origin`, reduced to one turn
 * in double precision so float32 keeps the phase at any battle time and range. */
export function packHullSeaWave(wave: HullSeaWave, time: number, originX: number, originZ: number): [number, number, number, number] {
  if (!(wave.wavelength > 0) || !Number.isFinite(wave.wavelength)) return [0, 0, 0, 0];
  const k = 2 * Math.PI / wave.wavelength, kx = k * Math.cos(wave.direction), kz = k * Math.sin(wave.direction);
  const turn = 2 * Math.PI, phase = kx * originX + kz * originZ - Math.sqrt(GRAVITY * k) * time + wave.phase;
  return [kx, kz, wave.amplitude, (phase % turn + turn) % turn];
}

/** Lattice cells per edge `cascadeModes` gathers a cascade's variance into: enough to place the split within a quarter
 * level, few enough to weigh every level in a millisecond or two at any tier. */
const MODE_BINS = 64;

/** (kx, kz, variance) triples of a cascade's spectrum gathered onto at most MODE_BINS² cells (each at its
 * variance-weighted wave vector): what `splitLevel` weighs. `amplitudes` is the cascade's packed spectrum (re, im,
 * frequency multiple, ·) on an n×n lattice of a `size` m tile. */
export function cascadeModes(amplitudes: Float32Array, n: number, size: number): Float32Array {
  const bin = Math.max(1, Math.ceil(n / MODE_BINS)), cells = Math.ceil(n / bin), dk = 2 * Math.PI / size;
  const sums = new Float64Array(cells * cells * 3);
  for (let i = 0; i < amplitudes.length; i += 4) {
    if (!amplitudes[i + 2]) continue;
    const texel = i / 4, x = texel % n, z = (texel - x) / n, variance = amplitudes[i] ** 2 + amplitudes[i + 1] ** 2;
    const nx = x < n / 2 ? x : x - n, nz = z < n / 2 ? z : z - n;
    const cell = ((Math.floor((nz + n / 2) / bin)) * cells + Math.floor((nx + n / 2) / bin)) * 3;
    sums[cell] += nx * dk * variance; sums[cell + 1] += nz * dk * variance; sums[cell + 2] += variance;
  }
  const modes: number[] = [];
  for (let i = 0; i < sums.length; i += 3) if (sums[i + 2] > 0) modes.push(sums[i] / sums[i + 2], sums[i + 1] / sums[i + 2], sums[i + 2]);
  return new Float32Array(modes);
}

/** Transfer of a mip box `width` metres wide, read bilinearly, at wave vector (kx, kz): per axis sinc³(k·width/2). */
export function boxTransfer(kx: number, kz: number, width: number): number {
  const sinc = (x: number) => Math.abs(x) < 1e-6 ? 1 : Math.sin(x) / x;
  return (sinc(kx * width / 2) * sinc(kz * width / 2)) ** 3;
}

/** The mip level of the first cascade whose box low-pass best splits its waves into the long ones the coupling replaces
 * and the rest, or null when leaving every drawn wave in place does better (a sea whose waves are all far shorter than
 * the combat sea's). A box filter's response falls from 0.9 to 0.1 over a factor of about five in wavelength, so no
 * level splits cleanly; this weighs the long-wave variance a level leaves beside the hull (SPLIT_LEAK_WEIGHT times)
 * against the shorter variance it removes, over the cascade's own modes. `modes` holds (kx, kz, variance) triples,
 * `texel` the cascade's texel in metres, `top` its coarsest mip level. */
export function splitLevel(modes: Float32Array, texel: number, top: number, wavelength: number): number | null {
  const long = 2 * Math.PI / (LONG_WAVES * wavelength);
  let longVariance = 0;
  for (let i = 0; i < modes.length; i += 3) if (Math.hypot(modes[i], modes[i + 1]) <= long) longVariance += modes[i + 2];
  let best: number | null = null, cost = SPLIT_LEAK_WEIGHT * longVariance;
  for (let level = 0; level <= top + 1e-9; level += SPLIT_STEP) {
    const width = texel * 2 ** level;
    let total = 0;
    for (let i = 0; i < modes.length && total < cost; i += 3) {
      const t = boxTransfer(modes[i], modes[i + 1], width);
      total += Math.hypot(modes[i], modes[i + 1]) <= long ? SPLIT_LEAK_WEIGHT * modes[i + 2] * (1 - t) ** 2 : modes[i + 2] * t * t;
    }
    if (total < cost) { cost = total; best = level; }
  }
  return best;
}

/** The drawn height near hulls: `field` (all cascades) with its long waves `lowpass` blended into the combat sea. */
export function coupledHeight(field: number, lowpass: number, slots: readonly HullSeaSlot[], waves: readonly HullSeaWave[], time: number, x: number, z: number): number {
  const blend = hullSeaBlend(hullSeaWeight(slots, x, z).weight);
  return field + blend.lowpass * lowpass + blend.sea * hullSeaHeight(waves, time, x, z);
}

/** Uniforms and nodes of the coupling. The wave field owns one and applies it in displacement, surface and heightAt.
 * Every value is the frame's, whatever draws it, so all live in the shared render group: `heightAt` reaches every hull
 * paint through its wet band, and per-object uniforms would be checked again for each of thousands of ship draws. */
export class HullSea {
  /** Mip level of the first cascade that holds the long waves the coupling replaces (the field sets it with `splitLevel`)
   * and whether any are replaced (0: the drawn waves all stay, the combat sea adds to them). */
  readonly split = uniform(0).setGroup(renderGroup);
  readonly replace = uniform(1).setGroup(renderGroup);
  private readonly slotValues = Array.from({ length: HULL_SEA_SLOTS * 2 }, () => new Vector4());
  /** Per hull: (centre x, z, bow axis x, z), (half length, inner, outer, contact). */
  private readonly slots = uniformArray<'vec4'>(this.slotValues, 'vec4').setGroup(renderGroup);
  private readonly count = uniform(0, 'int').setGroup(renderGroup);
  private readonly waveValues = Array.from({ length: HULL_SEA_WAVES }, () => new Vector4());
  /** Per component: (kx, kz, amplitude, phase about `origin`). */
  private readonly waves = uniformArray<'vec4'>(this.waveValues, 'vec4').setGroup(renderGroup);
  private readonly origin = uniform(new Vector2()).setGroup(renderGroup);

  /** Couple `hulls` (at most HULL_SEA_SLOTS) to the sea `waves` at `time`. No components or no hulls: no coupling. */
  set(waves: readonly HullSeaWave[], time: number, hulls: readonly HullFootprint[], origin: { x: number; z: number }): void {
    if (waves.length > HULL_SEA_WAVES) throw new Error(`At most ${HULL_SEA_WAVES} hull sea components`);
    const wavelength = hullSeaWavelength(waves);
    const count = wavelength > 0 ? Math.min(hulls.length, HULL_SEA_SLOTS) : 0;
    this.origin.value.set(origin.x, origin.z);
    this.waveValues.forEach((value, i) => {
      const [kx, kz, amplitude, phase] = waves[i] ? packHullSeaWave(waves[i], time, origin.x, origin.z) : [0, 0, 0, 0];
      value.set(kx, kz, amplitude, phase);
    });
    for (let i = 0; i < count; i++) {
      const slot = hullSeaSlot(hulls[i], wavelength);
      this.slotValues[i * 2].set(slot.x, slot.z, slot.axisX, slot.axisZ);
      this.slotValues[i * 2 + 1].set(slot.half, slot.inner, slot.outer, slot.contact);
    }
    this.count.value = count;
  }

  /** Coupling weight at a world position (any stage). */
  weight(xz: Vec2): Float {
    return Fn(() => {
      const keep = float(1).toVar();
      Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
        const a = this.slots.element(i.mul(2)), b = this.slots.element(i.mul(2).add(1));
        const relative = xz.sub(a.xy), t = clamp(dot(relative, a.zw), b.x.negate(), b.x);
        const distance = relative.sub(a.zw.mul(t)).length();
        keep.mulAssign(float(1).sub(b.w.mul(float(1).sub(smoothstep(b.y, b.z, distance)))));
      });
      return float(1).sub(keep);
    })() as unknown as Float;
  }

  /** (weight, ∂w/∂x, ∂w/∂z) at a world position (any stage). */
  weightGradient(xz: Vec2): Node<'vec3'> {
    return Fn(() => {
      const keep = float(1).toVar(), gradient = vec2(0).toVar();
      Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
        const a = this.slots.element(i.mul(2)), b = this.slots.element(i.mul(2).add(1));
        const relative = xz.sub(a.xy), t = clamp(dot(relative, a.zw), b.x.negate(), b.x);
        const offset = relative.sub(a.zw.mul(t)), distance = offset.length();
        const span = b.z.sub(b.y).max(1e-3), s = clamp(distance.sub(b.y).div(span), 0, 1);
        const w = b.w.mul(float(1).sub(s.mul(s).mul(float(3).sub(s.mul(2)))));
        const rate = b.w.mul(s).mul(float(1).sub(s)).mul(-6).div(span).div(distance.max(1e-3));
        gradient.assign(gradient.mul(float(1).sub(w)).sub(offset.mul(rate).mul(keep)));
        keep.mulAssign(float(1).sub(w));
      });
      return vec3(float(1).sub(keep), gradient.negate());
    })() as unknown as Node<'vec3'>;
  }

  /** `hullSeaBlend` as nodes; with the weight's gradient, the gradients of both coefficients too. */
  blend(w: Float, gradient: Vec2 = vec2(0)): { lowpass: Float; sea: Float; lowpassGradient: Vec2; seaGradient: Vec2 } {
    const n = inverseSqrt(float(1).sub(w.mul(2)).add(w.mul(w).mul(2))), dn = float(1).sub(w.mul(2)).mul(n).mul(n).mul(n);
    const lowpass = n.mul(float(1).sub(w)).sub(1), sea = n.mul(w);
    return { lowpass, sea, lowpassGradient: gradient.mul(dn.mul(float(1).sub(w)).sub(n)), seaGradient: gradient.mul(dn.mul(w).add(n)) };
  }

  /** Combat sea height at a world position for a vertex `spacing` metres from its neighbours: a component fades out
   * between four and two vertices per wave, as the cascades do. */
  height(at: Vec2, spacing?: Float): Float {
    const relative = at.sub(this.origin);
    let height: Float = float(0);
    for (let j = 0; j < HULL_SEA_WAVES; j++) {
      const wave = this.waves.element(j), k = wave.xy.length();
      const fade = spacing ? float(1).sub(smoothstep(Math.PI / 2, Math.PI, spacing.mul(k))) : float(1);
      height = height.add(wave.z.mul(fade).mul(sin(dot(wave.xy, relative).add(wave.w))));
    }
    return height;
  }

  /** (height, ∂h/∂x, ∂h/∂z, slope variance filtered away) of the combat sea at a world position seen by a pixel
   * `footprint` metres wide: each slope is attenuated as the mip chain's box filter would, exp(−(k·footprint)²/8), and
   * the variance it loses becomes roughness. */
  surface(at: Vec2, footprint: Float): Node<'vec4'> {
    const relative = at.sub(this.origin);
    let result: Node<'vec4'> = vec4(0);
    for (let j = 0; j < HULL_SEA_WAVES; j++) {
      const wave = this.waves.element(j), k = wave.xy.length(), phase = dot(wave.xy, relative).add(wave.w);
      const resolved = exp(footprint.mul(k).pow(2).div(-8));
      const swing = wave.z.mul(cos(phase)).mul(resolved), steepness = wave.z.mul(k);
      result = result.add(vec4(wave.z.mul(sin(phase)), wave.xy.mul(swing), steepness.mul(steepness).mul(.5).mul(float(1).sub(resolved.mul(resolved)))));
    }
    return result;
  }

  /** Whether any hull is coupled, for callers that can skip the work. */
  get active(): Node<'bool'> { return this.count.greaterThan(0); }

  /** Drop every hull. */
  clear(): void { this.count.value = 0; }

  /** Vertex displacement near hulls: `field` (every cascade at `xz`) with its long waves `long` (the first cascade's
   * low-passed displacement) blended into the combat sea, evaluated where the vertex lands. */
  displace(field: Node<'vec3'>, long: Node<'vec3'>, xz: Vec2, spacing?: Float): Node<'vec3'> {
    const blend = this.blend(this.weight(xz));
    const moved = field.add(long.mul(blend.lowpass));
    return vec3(moved.x, moved.y.add(blend.sea.mul(this.height(xz.add(moved.xz), spacing))), moved.z);
  }
}
