import type { Vec3 } from '../ships/blueprint';
import { add, clamp, length, scale, sub } from './geometry';

/** Gameplay calibration: these are burst outcomes, not historical per-bullet rates. */
export const AIR_GUNNERY = {
  aaSpread: (distance: number) => .03 + distance / 40000,
  aaDamage: (caliber: number) => caliber > .08 ? 100 : caliber > .025 ? 40 : 20,
  fighterSpread: (bank: number) => .07 + Math.abs(bank) * .04,
  fighterDamage: 80,
};

export interface FireDiscipline {
  remaining: number; sequence: number; panic: boolean; yaw: number; pitch: number;
}
export const initialFireDiscipline = (): FireDiscipline => ({ remaining: 0, sequence: 0, panic: false, yaw: 0, pitch: 0 });

export function gunnerySeed(id: string, seed: number): number {
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return seed >>> 0;
}
function sample(seed: number, sequence: number, channel: number) {
  let x = seed ^ Math.imul(sequence + 1, 0x9e3779b9) ^ channel;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad); x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/** Persistent, independently seeded episodes; panic always gives way to recovery.
 * Only an active air engagement can start one. No renderer/global RNG dependency. */
export function stepFireDiscipline(state: FireDiscipline, dt: number, pressure: number, seed: number, engaged = true) {
  state.remaining = Math.max(0, state.remaining - dt);
  if (!engaged) { state.panic = false; return; }
  if (state.remaining > 0) return;
  const sequence = state.sequence++;
  state.panic = !state.panic && sample(seed, sequence, 0) < .18 + .42 * clamp(pressure, 0, 1);
  state.remaining = state.panic ? 2 + 2 * sample(seed, sequence, 1) : 4 + 3 * sample(seed, sequence, 1);
  state.yaw = (sample(seed, sequence, 2) < .5 ? -1 : 1) * (.18 + .42 * sample(seed, sequence, 3));
  state.pitch = -.08 + .45 * sample(seed, sequence, 4);
}

/** A frightened AA crew follows an erroneous patch of sky, with actual mount
 * training/obstruction still governing where its barrels can fire. */
export function panicAim(origin: Vec3, target: Vec3, state: FireDiscipline): Vec3 {
  const delta = sub(target, origin), distance = length(delta);
  const yaw = Math.atan2(delta[0], -delta[2]) + state.yaw;
  const pitch = clamp(Math.atan2(delta[1], Math.hypot(delta[0], delta[2])) + state.pitch, .12, 1.35);
  return add(origin, scale([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)], distance));
}
