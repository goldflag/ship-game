import type { Handling } from '../ships/blueprint';

// Gameplay response multipliers; mirrored in crates/naval-sim/src/mobility.rs.
// Keep authored speed limits and the relative handling of different hulls.
export const MOBILITY = { acceleration: 1.25, braking: 1.25, rudderRate: 1.2, maxYawRate: 1.1, yawResponse: 1.2 } as const;
export const torpedoSpeed = (authoredSpeed: number): number => authoredSpeed * 1.1;
export const effectiveHandling = (h: Handling): Handling => ({
  ...h, acceleration: h.acceleration * MOBILITY.acceleration,
  braking: h.braking * MOBILITY.braking, rudderRate: h.rudderRate * MOBILITY.rudderRate,
  maxYawRate: h.maxYawRate * MOBILITY.maxYawRate,
});
