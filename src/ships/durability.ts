/** The gameplay hull durability every blueprint shares, a rule the Rust
 * authority applies (`naval_sim::damage::HULL_HP_SCALE`) and the port's
 * statistics quote for hulls that have no session. */
import type { ShipDefinition } from './blueprint';
/** Scales every hull's durability against the authored damage numbers. */
export const HULL_HP_SCALE = 35;
export function maxHullIntegrity(def: ShipDefinition): number {
  // Gentle small-hull bonus (mass^0.8), anchored to Bismarck’s existing 50,750 HP.
  return Math.round((def.hull.massKg / 43_978_000) ** .8 * 1450 * HULL_HP_SCALE);
}
