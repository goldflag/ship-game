import type { Vec3 } from './blueprint';

/** Visual equipment, authored in the same frame as weapons and hulls. */
export const ENSIGN_DESIGNS = ['us-48', 'white-ensign', 'ijn', 'kriegsmarine'] as const;
export type EnsignDesign = typeof ENSIGN_DESIGNS[number];
export interface ShipRig {
  version: 1;
  ensigns: { id: string; design: EnsignDesign; position: Vec3; width: number; staffHeight: number }[];
  radars: { id: string; nodeId: string; rpm: number; sweepDeg?: number; phaseDeg?: number }[];
}
