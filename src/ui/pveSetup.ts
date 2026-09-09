import { shipPreset } from '../ships/presets';
import { islandRadius, mapIslands, type OceanMapId } from '../maps/catalog';
import type { FleetShip } from '../multiplayer/generated/FleetShip';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import type { Placement } from '../multiplayer/generated/Placement';
import type { FleetBudget } from '../multiplayer/generated/FleetBudget';

export const aircraftCount = (id: string) => shipPreset(id).airWing?.squadrons.reduce((n, s) => n + s.count, 0) ?? 0;
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
export const deploymentIslands = (briefing: PveBriefing) => mapIslands(briefing.setup.mapId as OceanMapId, 16000, briefing.setup.missionRules!.budget.maxShips).map(i => ({ ...i, z: i.z + 8000 }));
/** Immediate chart feedback; the worker validates the complete placement before launch. */
export function placementError(briefing: PveBriefing, placements: Placement[]): string {
  const islands = deploymentIslands(briefing), radius = briefing.setup.missionRules!.area.radiusM;
  for (const [index, placement] of placements.entries()) {
    const unit = briefing.assignments.find(s => s.id === placement.id)!;
    const { x, z, heading } = placement.spawn, name = unitName(unit, briefing.assignments);
    if (![x, z, heading].every(Number.isFinite)) return `${name}: enter a valid position and heading.`;
    if (z < briefing.deploymentMinZ) return `${name}: deploy in the shaded friendly sector.`;
    if (Math.hypot(x, z) > radius - shipPreset(unit.presetId).hull.length / 2) return `${name}: keep the hull inside the battle boundary.`;
    if (islands.some(i => islandRadius({ ...i, rx: i.rx + 250, rz: i.rz + 250 }, x, z) <= 1.05)) return `${name}: leave clearance from the coast.`;
    if (placements.slice(0, index).some(p => Math.hypot(p.spawn.x - x, p.spawn.z - z) < 350)) return `${name}: leave at least 350 m between ships.`;
  }
  return '';
}
export function moveFormation(placements: Placement[], selected: string[], x: number, z: number, rotate = 0): Placement[] {
  const moving = placements.filter(p => selected.includes(p.id));
  if (!moving.length) return placements;
  const cx = moving.reduce((n, p) => n + p.spawn.x, 0) / moving.length, cz = moving.reduce((n, p) => n + p.spawn.z, 0) / moving.length;
  const c = Math.cos(rotate), s = Math.sin(rotate);
  return placements.map(p => !selected.includes(p.id) ? p : { ...p, spawn: { x: x + (p.spawn.x - cx) * c - (p.spawn.z - cz) * s, z: z + (p.spawn.x - cx) * s + (p.spawn.z - cz) * c, heading: p.spawn.heading + rotate } });
}
