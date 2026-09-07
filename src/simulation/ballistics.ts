import type { Vec3 } from '../ships/blueprint';
import { add, normalize, scale } from './geometry';

export const GRAVITY = 9.81;
/** Linear drag is a calibrated point-mass approximation. Its closed solution
 * keeps aiming, inherited ship velocity and flight exactly consistent and cheap
 * for fleets. It does not model Mach-dependent drag, wind or underwater travel. */
export function travelFactor(seconds: number, dragPerSecond = 0): number {
  return dragPerSecond > 1e-8 ? -Math.expm1(-dragPerSecond * seconds) / dragPerSecond : seconds;
}
function gravityDrop(seconds: number, drag: number, factor?: number): number {
  if (drag * seconds < 1e-4) return GRAVITY * seconds ** 2 * (.5 - drag * seconds / 6 + (drag * seconds) ** 2 / 24);
  return GRAVITY * (seconds - (factor ?? travelFactor(seconds, drag))) / drag;
}
export function ballisticStep(position: Vec3, velocity: Vec3, seconds: number, dragPerSecond = 0) {
  const factor = travelFactor(seconds, dragPerSecond), decay = Math.exp(-dragPerSecond * seconds);
  const drop = gravityDrop(seconds, dragPerSecond, factor);
  // Preserve the original operation order, including its final additions of
  // zero, while avoiding the intermediate vectors for every flying shell.
  return { position: [position[0] + velocity[0] * factor + 0, position[1] + velocity[1] * factor + -drop, position[2] + velocity[2] * factor + 0] as Vec3,
    velocity: [velocity[0] * decay + 0, velocity[1] * decay + -GRAVITY * factor, velocity[2] * decay + 0] as Vec3 };
}

type ArcBracket = { left: number; right: number; leftFactor2: number; rightFactor2: number; leftDrop: number; rightDrop: number; lower?: ArcBracket; upper?: ArcBracket };
type ArcTree = { root: ArcBracket; count: number };
const arcTrees = new Map<number, ArcTree>();
function arcBracket(a: number, b: number, drag: number): ArcBracket {
  const left = (2 * a + b) / 3, right = (a + 2 * b) / 3;
  const leftFactor = travelFactor(left, drag), rightFactor = travelFactor(right, drag);
  return { left, right, leftFactor2: leftFactor * leftFactor, rightFactor2: rightFactor * rightFactor,
    leftDrop: gravityDrop(left, drag, leftFactor), rightDrop: gravityDrop(right, drag, rightFactor) };
}
function arcTree(drag: number): ArcTree {
  let tree = arcTrees.get(drag);
  if (!tree) {
    if (arcTrees.size >= 32) arcTrees.delete(arcTrees.keys().next().value!);
    tree = { root: arcBracket(.0001, 180, drag), count: 1 }; arcTrees.set(drag, tree);
  }
  return tree;
}
/** Low arc under the same drag law as ballisticStep. Required launch speed is
 * unimodal in flight time; bracket its minimum, then bisect the earlier root. */
export function solveDragArc(from: Vec3, target: Vec3, speed: number, drag: number): { direction: Vec3; time: number } | null {
  const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2], range2 = dx * dx + dz * dz;
  if (Math.sqrt(range2) * drag >= speed) return null;
  const error = (time: number) => {
    const factor = travelFactor(time, drag), vertical = dy + gravityDrop(time, drag, factor);
    return (range2 + vertical * vertical) / (factor * factor) - speed * speed;
  };
  let a = .0001, b = 180;
  // Fleets repeatedly visit the same ternary-search intervals. Cache only
  // their invariant drag coefficients, preserving every comparison, interval
  // and final bisection operation. Bound storage for arbitrary weapon inputs.
  const tree = arcTree(drag);
  let bracket: ArcBracket | undefined = tree.root;
  for (let i = 0; i < 24; i++) {
    const current: ArcBracket = bracket ?? arcBracket(a, b, drag);
    const leftVertical = dy + current.leftDrop, rightVertical = dy + current.rightDrop;
    const lower = (range2 + leftVertical * leftVertical) / current.leftFactor2 - speed * speed <
      (range2 + rightVertical * rightVertical) / current.rightFactor2 - speed * speed;
    if (lower) b = current.right; else a = current.left;
    const next = lower ? 'lower' : 'upper';
    if (bracket && i < 23 && !bracket[next] && tree.count < 2048) {
      bracket[next] = arcBracket(a, b, drag); tree.count++;
    }
    bracket = bracket?.[next];
  }
  let low = .0001, high = (a + b) / 2;
  if (error(high) > 0) return null;
  for (let i = 0; i < 36; i++) { const mid = (low + high) / 2; if (error(mid) > 0) low = mid; else high = mid; }
  const time = (low + high) / 2, factor = travelFactor(time, drag);
  return { direction: normalize([dx / factor, (dy + gravityDrop(time, drag, factor)) / factor, dz / factor]), time };
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
