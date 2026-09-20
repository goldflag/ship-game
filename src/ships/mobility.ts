import type { Handling } from './blueprint';

// Gameplay response multipliers; mirrored in crates/naval-sim/src/mobility.rs.
// Keep authored speed limits and the relative handling of different hulls.
export const MOBILITY = { acceleration: 1.25, braking: 1.25, rudderRate: 1.2, maxYawRate: 1.1 } as const;
/** World distance and heading per unit of physical ship motion; readouts stay physical. */
export const SHIP_PACE = 1.5;
/** Physical shell seconds per battle second: same arcs, earlier arrival. */
export const SHELL_PACE = 1.25;
export const torpedoSpeed = (authoredSpeed: number): number => authoredSpeed * 2;
export const effectiveHandling = (h: Handling, physical = false): Handling => ({
  ...h, acceleration: h.acceleration * (physical ? 1 : MOBILITY.acceleration),
  braking: h.braking * (physical ? 1 : MOBILITY.braking), rudderRate: h.rudderRate * MOBILITY.rudderRate,
  maxYawRate: h.maxYawRate * (physical ? 1 : MOBILITY.maxYawRate),
});
