
/** Shared, renderer-free gameplay state. Distances: meters. Time: seconds.
 * Heading is clockwise from north (-Z); X points east. */
export const FIXED_DT = 1 / 60;
export const KNOTS_PER_MPS = 1.94384449;
export const ENGINE_ORDERS = [-1, 0, 0.25, 0.5, 0.75, 1] as const;
export const ENGINE_LABELS = ['ASTERN', 'STOP', 'SLOW', 'HALF', 'THREE-QUARTER', 'FULL'];

/** Declared with the frame, in Rust (`naval_sim::motion`). */
export type { HelmCommand } from '../../multiplayer/generated/HelmCommand';
export type { ShipState } from '../../multiplayer/generated/ShipState';

export const BISMARCK = {
  length: 250.5,
  beam: 36,
  forwardSpeed: 15.43,
  reverseSpeed: 4.12,
  acceleration: 0.32,
  braking: 0.24,
  rudderRate: 0.42,
  maxYawRate: 0.019,
} as const;

export function createShipState(id = 'player'): ShipState {
  return { id, tick: 0, x: 0, y: 0, z: 0, roll: 0, pitch: 0, heading: 0, speed: 0, swaySpeed: 0, rudder: 0, yawRate: 0, distance: 0, verticalSpeed: 0, waveHeave: 0, driftX: 0, driftZ: 0 };
}

import type { ShipState } from '../../multiplayer/generated/ShipState';
export const meanHullY = (state: { y: number; waveHeave?: number }): number => state.y - (state.waveHeave ?? 0);
export const hullDepth = (state: { y: number; waveHeave?: number }): number => Math.max(0, -meanHullY(state));

export function motionVelocity(state: ShipState): import('../../ships/blueprint').Vec3 {
  const sin = Math.sin(state.heading), cos = Math.cos(state.heading);
  return [sin * state.speed + cos * state.swaySpeed + (state.driftX ?? 0), state.verticalSpeed ?? 0, -cos * state.speed + sin * state.swaySpeed + (state.driftZ ?? 0)];
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
/** One depth order step for a submarine's helm. */
export const DEPTH_STEP_M = 2;
export const shipVelocity = (actor: { motion: ShipState }): import('../../ships/blueprint').Vec3 => motionVelocity(actor.motion);
