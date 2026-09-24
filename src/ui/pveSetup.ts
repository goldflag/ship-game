import { MIN_SHIP_SEPARATION_M } from '../game/session/battleSetup';
import { shipPreset } from '../ships/presets';
import { resolveShip } from '../ships/localShips';
import { DEPLOYMENT_CLEARANCE_M, MISSION_TERRAIN_OFFSET, isOceanMapId, placedMapTerrain } from '../maps/catalog';
import { terrainLandWithin, type PlacedTerrain } from '../maps/heightfield';
import type { FleetShip } from '../multiplayer/generated/FleetShip';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import type { Placement } from '../multiplayer/generated/Placement';
import type { FleetBudget } from '../multiplayer/generated/FleetBudget';

export const aircraftCount = (id: string) => resolveShip(id).airWing?.squadrons.reduce((n, s) => n + s.count, 0) ?? 0;
export const fleetTotals = (ships: FleetShip[]) => ships.reduce((sum, s) => ({ ships: sum.ships + 1, aircraft: sum.aircraft + aircraftCount(s.presetId), displacementKg: sum.displacementKg + shipPreset(s.presetId).hull.massKg }), { ships: 0, aircraft: 0, displacementKg: 0 });
export function budgetError(ships: FleetShip[], budget: FleetBudget): string {
  const total = fleetTotals(ships);
  if (!ships.length) return 'Add at least one ship.';
  if (total.displacementKg > budget.maxDisplacementKg) return 'Fleet exceeds the tonnage allowance.';
  if (total.aircraft > budget.maxAircraft) return 'Fleet exceeds the aircraft allowance.';
  if (total.ships > budget.maxShips) return 'Fleet exceeds the ship allowance.';
  return '';
}
export function unitName(ship: FleetShip, ships: FleetShip[]): string {
  const same = ships.filter(s => s.presetId === ship.presetId);
  return `${shipPreset(ship.presetId).name}${same.length > 1 ? ` ${same.findIndex(s => s.id === ship.id) + 1}` : ''}`;
}
/** The mission's land, charted on the mission area; undefined while its heightfield loads. */
export const missionTerrain = (briefing: PveBriefing): PlacedTerrain | undefined =>
  isOceanMapId(briefing.setup.mapId) ? placedMapTerrain(briefing.setup.mapId, MISSION_TERRAIN_OFFSET) : undefined;
/** Immediate chart feedback; the worker validates the complete placement before launch. Without `terrain` (the coast
 * is still being charted) every rule but the land clearance is checked. */
export function placementError(briefing: PveBriefing, placements: Placement[], terrain: PlacedTerrain | undefined): string {
  const radius = briefing.setup.missionRules!.area.radiusM;
  for (const [index, placement] of placements.entries()) {
    const unit = briefing.assignments.find(s => s.id === placement.id)!;
    const { x, z, heading } = placement.spawn, name = unitName(unit, briefing.assignments);
    if (![x, z, heading].every(Number.isFinite)) return `${name}: enter a valid position and heading.`;
    if (z < briefing.deploymentMinZ) return `${name}: deploy in the shaded friendly sector.`;
    if (Math.hypot(x, z) > radius - shipPreset(unit.presetId).hull.length / 2) return `${name}: keep the hull inside the battle boundary.`;
    if (terrainLandWithin(terrain, x, z, DEPLOYMENT_CLEARANCE_M)) return `${name}: leave clearance from the coast.`;
    if (placements.slice(0, index).some(p => Math.hypot(p.spawn.x - x, p.spawn.z - z) < MIN_SHIP_SEPARATION_M)) return `${name}: leave at least ${MIN_SHIP_SEPARATION_M} m between ships.`;
  }
  return '';
}
export function moveFormation<T extends Placement>(placements: T[], selected: readonly string[], x: number, z: number, rotate = 0): T[] {
  const moving = placements.filter(p => selected.includes(p.id));
  if (!moving.length) return placements;
  const cx = moving.reduce((n, p) => n + p.spawn.x, 0) / moving.length, cz = moving.reduce((n, p) => n + p.spawn.z, 0) / moving.length;
  const c = Math.cos(rotate), s = Math.sin(rotate);
  return placements.map(p => !selected.includes(p.id) ? p : { ...p, spawn: { x: x + (p.spawn.x - cx) * c - (p.spawn.z - cz) * s, z: z + (p.spawn.x - cx) * s + (p.spawn.z - cz) * c, heading: p.spawn.heading + rotate } });
}
