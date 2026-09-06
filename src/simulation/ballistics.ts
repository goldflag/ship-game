import type { Vec3 } from '../ships/blueprint';
import { add, normalize, scale } from './geometry';

export const GRAVITY = 9.81;
/** Linear drag is a calibrated point-mass approximation. Its closed solution
 * keeps aiming, inherited ship velocity and flight exactly consistent and cheap
 * for fleets. It does not model Mach-dependent drag, wind or underwater travel. */
export function travelFactor(seconds: number, dragPerSecond = 0): number {
  return dragPerSecond > 1e-8 ? -Math.expm1(-dragPerSecond * seconds) / dragPerSecond : seconds;
}
function gravityDrop(seconds: number, drag: number): number {
  if (drag * seconds < 1e-4) return GRAVITY * seconds ** 2 * (.5 - drag * seconds / 6 + (drag * seconds) ** 2 / 24);
  return GRAVITY * (seconds - travelFactor(seconds, drag)) / drag;
}
export function ballisticStep(position: Vec3, velocity: Vec3, seconds: number, dragPerSecond = 0) {
  const factor = travelFactor(seconds, dragPerSecond), decay = Math.exp(-dragPerSecond * seconds);
  return { position: add(add(position, scale(velocity, factor)), [0, -gravityDrop(seconds, dragPerSecond), 0]),
    velocity: add(scale(velocity, decay), [0, -GRAVITY * factor, 0]) };
}
/** Low arc under the same drag law as ballisticStep. Required launch speed is
 * unimodal in flight time; bracket its minimum, then bisect the earlier root. */
export function solveDragArc(from: Vec3, target: Vec3, speed: number, drag: number): { direction: Vec3; time: number } | null {
  const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2], range2 = dx * dx + dz * dz;
  if (Math.sqrt(range2) * drag >= speed) return null;
  const error = (time: number) => {
    const factor = travelFactor(time, drag), vertical = dy + gravityDrop(time, drag);
    return (range2 + vertical * vertical) / (factor * factor) - speed * speed;
  };
  let a = .0001, b = 180;
  for (let i = 0; i < 24; i++) {
    const left = (2 * a + b) / 3, right = (a + 2 * b) / 3;
    if (error(left) < error(right)) b = right; else a = left;
  }
  let low = .0001, high = (a + b) / 2;
  if (error(high) > 0) return null;
  for (let i = 0; i < 36; i++) { const mid = (low + high) / 2; if (error(mid) > 0) low = mid; else high = mid; }
  const time = (low + high) / 2, factor = travelFactor(time, drag);
  return { direction: normalize([dx / factor, (dy + gravityDrop(time, drag)) / factor, dz / factor]), time };
}
function random(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad); x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}
/** Independent seeded muzzle-velocity error adds range spread without moving the
 * gun's nominal firing solution. Calibration is a fractional standard deviation. */
export function dispersedSpeed(speed: number, sigmaFraction: number, seed: number, shot: number): number {
  if (sigmaFraction === 0) return speed;
  const first = seed ^ Math.imul(shot + 1, 0x9e3779b9) ^ 0x4cf5ad43;
  const normal = Math.sqrt(-2 * Math.log(Math.max(1e-12, random(first)))) * Math.cos(2 * Math.PI * random(first ^ 0x7f4a7c15));
  return speed * (1 + Math.max(-3, Math.min(3, normal)) * sigmaFraction);
}
/** Provisional velocity exponent on the carried penetration budget. Resistance
 * paid at a plate is not refunded later; the residual budget follows flight speed.
 * This is not a historical penetration equation or a shell-deformation model. */
export const velocityPenetration = (budgetMm: number, beforeSpeed: number, afterSpeed: number): number =>
  beforeSpeed > 1e-8 ? budgetMm * (afterSpeed / beforeSpeed) ** 1.4 : 0;
/** Per-shot seeded Gaussian angular error, bounded to three standard deviations.
 * Stateless: unrelated render frames, telemetry and sound cannot consume RNG. */
export function dispersedDirection(direction: Vec3, spreadRad: number, seed: number, shot: number): Vec3 {
  if (spreadRad === 0) return [...direction];
  const first = seed ^ Math.imul(shot + 1, 0x9e3779b9);
  const radius = Math.min(3, Math.sqrt(-2 * Math.log(Math.max(1e-12, random(first))))) * spreadRad;
  const angle = 2 * Math.PI * random(first ^ 0x68bc21eb);
  const side = normalize(Math.abs(direction[1]) < .99 ? [direction[2], 0, -direction[0]] : [0, direction[2], -direction[1]]);
  const up: Vec3 = [side[1] * direction[2] - side[2] * direction[1], side[2] * direction[0] - side[0] * direction[2], side[0] * direction[1] - side[1] * direction[0]];
  return normalize(add(add(direction, scale(side, radius * Math.cos(angle))), scale(up, radius * Math.sin(angle))));
}
