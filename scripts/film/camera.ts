/** Camera work for film shots: points in a subject's own frame, aiming with lens and roll, easing, smoothing and a hand-held
 * sway. Pure math on world metres (+X east, +Y up, −Z north; heading clockwise from −Z), so film modules load in Node too. */
import type { PerspectiveCamera } from 'three/webgpu';
import type { SubjectPose } from '../../src/game/Game';
import type { ShotDirector, Stage, V3 } from './types';

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V3): V3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Easing over 0 → 1. */
export const ease = {
  linear: (t: number) => clamp01(t),
  inOut: (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); },
  in: (t: number) => clamp01(t) ** 2,
  out: (t: number) => 1 - (1 - clamp01(t)) ** 2,
};
/** `t` remapped to 0 → 1 across [from, to]. */
export const span = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

/** A point in a subject's own frame: x starboard, y up, z ahead (metres), about where it is drawn. Ships turn with heading only;
 * `attitude` also pitches and banks with an aircraft. */
export function about(pose: SubjectPose, offset: V3, attitude = false): V3 {
  let [x, y, z] = offset;
  if (attitude) {
    // Bank about the nose, then pitch about the wingline.
    const b = -pose.roll, p = pose.pitch;
    [x, y] = [x * Math.cos(b) - y * Math.sin(b), x * Math.sin(b) + y * Math.cos(b)];
    [y, z] = [y * Math.cos(p) + z * Math.sin(p), -y * Math.sin(p) + z * Math.cos(p)];
  }
  const h = pose.heading, forward: V3 = [Math.sin(h), 0, -Math.cos(h)], right: V3 = [Math.cos(h), 0, Math.sin(h)];
  return [pose.position[0] + right[0] * x + forward[0] * z, pose.position[1] + y, pose.position[2] + right[2] * x + forward[2] * z];
}

/** Point the camera from `eye` at `target` with a lens of `fov` degrees (vertical) and `roll` degrees about the view, positive
 * clockwise as the viewer sees it. */
export function aim(camera: PerspectiveCamera, eye: V3, target: V3, fov: number, roll = 0): void {
  camera.position.set(...eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(...target);
  if (roll) camera.rotateZ(-roll * Math.PI / 180);
  camera.fov = fov;
}

/** Hold `eye` at least `margin` metres over the long-wave sea. */
export function aboveSea(stage: Stage, eye: V3, margin = 2): V3 {
  const floor = stage.sea(eye[0], eye[2]) + margin;
  return eye[1] < floor ? [eye[0], floor, eye[2]] : eye;
}

/** A slow hand-held sway: smooth noise in metres (or degrees, for roll), `amplitude` at `rate` hertz, the same for the same seed. */
export function sway(seconds: number, amplitude: number, rate = .35, seed = 1): V3 {
  const wave = (k: number) => Math.sin(seconds * rate * 2 * Math.PI * (1 + .37 * k) + seed * (1.7 + k)) * .6
    + Math.sin(seconds * rate * 2 * Math.PI * (2.13 + .21 * k) + seed * (4.1 + k * 2.3)) * .4;
  return [wave(0) * amplitude, wave(1) * amplitude, wave(2) * amplitude];
}

/** Exponential smoothing of a point or offset over `halfLife` seconds: what a steadied camera does to jolts and jitter. */
export class Follow {
  private value?: V3;
  constructor(private readonly halfLife: number) {}
  update(target: V3, dt: number): V3 {
    if (!this.value || dt <= 0) return this.value ??= [...target];
    return this.value = lerp(this.value, target, 1 - 0.5 ** (dt / this.halfLife));
  }
}

/** A camera operator tracking a moving subject: it leads with the subject's smoothed velocity and eases out the rest, so a subject
 * at steady speed is held however fast it goes while its jolts and jitter are smoothed over `halfLife` seconds. */
export class Track {
  private value?: V3;
  private last?: V3;
  private velocity: V3 = [0, 0, 0];
  constructor(private readonly halfLife: number) {}
  update(target: V3, dt: number): V3 {
    if (!this.value || !this.last) { this.last = [...target]; return this.value = [...target]; }
    if (dt <= 0) return this.value;
    const k = 1 - 0.5 ** (dt / this.halfLife);
    this.velocity = lerp(this.velocity, scale(sub(target, this.last), 1 / dt), Math.min(1, k * 2));
    this.last = [...target];
    return this.value = lerp(add(this.value, scale(this.velocity, dt)), target, k);
  }
}

/** The centre of a group of subjects, and how far the farthest is from it. */
export function centroid(points: readonly V3[]): { center: V3; radius: number } {
  if (!points.length) return { center: [0, 0, 0], radius: 0 };
  const center = scale(points.reduce(add, [0, 0, 0] as V3), 1 / points.length);
  return { center, radius: Math.max(...points.map(point => length(sub(point, center)))) };
}

/** A value that may change over the shot: a constant, or a function of `t` (0 → 1 across the shot). */
export type Over<T> = T | ((t: number) => T);
const at = <T>(value: Over<T>, t: number): T => typeof value === 'function' ? (value as (t: number) => T)(t) : value;

/** Where a camera looks: a subject's centre (by id), a point in its own frame, a world point, or a function of the shot's `t`. */
export type Mark = string | { id: string; offset: V3; attitude?: boolean } | V3 | ((t: number) => V3 | undefined);
function mark(stage: Stage, value: Mark, t: number): V3 | undefined {
  if (typeof value === 'function') return value(t);
  if (Array.isArray(value)) return value;
  const pose = stage.pose(typeof value === 'string' ? value : value.id);
  return pose && (typeof value === 'string' ? pose.position : about(pose, value.offset, value.attitude));
}

interface Lens { fov: Over<number>; roll?: Over<number>; /** Hand-held sway in metres. */ sway?: number; /** Seconds of follow lag. */ lag?: number }

/** A camera riding with a subject: `offset` from it and `look` at a point, both in its own frame (x starboard, y up, z ahead).
 * `attitude` pitches and banks the frame with an aircraft. Once the subject is gone the camera holds where it was. */
export function ride(stage: Stage, id: string, options: Lens & { offset: Over<V3>; look: Over<V3>; attitude?: boolean; clearSea?: number }): ShotDirector {
  // Smoothing the offsets, not the points, steadies the camera through turns and jolts without trailing a fast subject.
  const eyes = new Follow(options.lag ?? .001), looks = new Follow(options.lag ?? .001);
  let eye: V3 | undefined, target: V3 | undefined;
  return (camera, { t, seconds, dt }) => {
    const pose = stage.pose(id);
    if (pose) {
      eye = add(pose.position, eyes.update(sub(add(about(pose, at(options.offset, t), options.attitude), sway(seconds, options.sway ?? 0)), pose.position), dt));
      target = add(pose.position, looks.update(sub(about(pose, at(options.look, t), options.attitude), pose.position), dt));
      if (options.clearSea !== undefined) eye = aboveSea(stage, eye, options.clearSea);
    }
    if (eye && target) aim(camera, eye, target, at(options.fov, t), at(options.roll ?? 0, t));
  };
}

/** A camera at `eye` (in a subject's frame when `from` is given, fixed where it stood at the shot's first frame, or world metres)
 * turning to keep `target` in view. */
export function watch(stage: Stage, options: Lens & { eye: Over<V3>; from?: string; target: Mark; clearSea?: number }): ShotDirector {
  const looks = new Track(options.lag ?? .001);
  let origin: SubjectPose | undefined, target: V3 | undefined;
  return (camera, { t, seconds, dt }) => {
    if (options.from) origin ??= stage.pose(options.from);
    const local = at(options.eye, t);
    let eye = add(origin ? about(origin, local) : local, sway(seconds, options.sway ?? 0));
    if (options.clearSea !== undefined) eye = aboveSea(stage, eye, options.clearSea);
    const seen = mark(stage, options.target, t);
    if (seen) target = looks.update(seen, dt);
    if (target) aim(camera, eye, target, at(options.fov, t), at(options.roll ?? 0, t));
  };
}

/** A camera circling a subject: from `from` to `to` degrees (0 dead ahead of it, 90 its starboard beam) at `radius` metres and
 * `height` above its waterline, looking at `look` in its frame. */
export function orbit(stage: Stage, id: string, options: Lens & { radius: Over<number>; height: Over<number>; from: number; to: number; look?: V3; ease?: (t: number) => number }): ShotDirector {
  const turn = options.ease ?? ease.inOut;
  return watch(stage, { ...options, from: undefined, target: { id, offset: options.look ?? [0, 20, 0] },
    eye: t => {
      const pose = stage.pose(id);
      if (!pose) return [0, 0, 0];
      const angle = mix(options.from, options.to, turn(t)) * Math.PI / 180, radius = at(options.radius, t);
      return about({ ...pose, position: [pose.position[0], 0, pose.position[2]] }, [Math.sin(angle) * radius, at(options.height, t), Math.cos(angle) * radius]);
    } });
}
