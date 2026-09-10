import { DEFAULT_MAP, mapIslands, type Island } from '../../maps/catalog';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import type { Placement } from '../../multiplayer/generated/Placement';
import { shipPreset } from '../../ships/presets';
import { botSelection, setupSpawns, validateSpawns, type BattleSetup, type SpawnPose, type Team } from '../../simulation/battle';
import { deploymentIslands, placementError, unitName } from '../pveSetup';

/** One ship on the deployment chart. `spawn` matches the worker's Placement shape so formation helpers apply directly. */
export interface ChartUnit { id: string; presetId: string; name: string; side: Team; groupId: string; spawn: SpawnPose; }
export interface ChartGroup { id: string; name: string; side: Team; }
export type ChartBounds = { kind: 'circle'; radius: number } | { kind: 'square'; half: number };
export interface Deployment {
  units: ChartUnit[]; groups: ChartGroup[]; islands: Island[]; bounds: ChartBounds;
  /** The shaded friendly sector's northern edge (PvE). */
  friendlyMinZ?: number;
  /** Initial chart center. */
  focus: { x: number; z: number };
  labels: { north?: string; south?: string };
  error: string;
}

export const CUSTOM_GROUPS: readonly ChartGroup[] = [{ id: 'friendly', name: 'Friendly formation', side: 'friendly' }, { id: 'enemy', name: 'Enemy formation', side: 'enemy' }];
const customName = (setup: BattleSetup, team: Team, index: number) => {
  const id = team === 'friendly' && index === 0 ? setup.playerShipId : botSelection(team === 'friendly' ? setup.friendlyBots[index - 1] : setup.enemies[index]).shipId;
  return { presetId: id, name: `${shipPreset(id).name}${team === 'friendly' && index === 0 ? ' · You' : ''}` };
};
export function customIslands(setup: BattleSetup): Island[] {
  return mapIslands(setup.mapId ?? DEFAULT_MAP, setup.spawnDistance, Math.max(setup.friendlyBots.length + 1, setup.enemies.length));
}
/** Custom battle: both fleets on one chart, one formation frame per side. */
export function customDeployment(setup: BattleSetup): Deployment {
  const spawns = setupSpawns(setup), islands = customIslands(setup);
  const units = (['friendly', 'enemy'] as const).flatMap(team => spawns[team].map((spawn, index) => ({ id: `${team}:${index}`, side: team, groupId: team, spawn, ...customName(setup, team, index) })));
  let error = '';
  try { validateSpawns(spawns, setup.friendlyBots.length + 1, setup.enemies.length, islands); } catch (failure) { error = (failure as Error).message; }
  return { units, groups: [...CUSTOM_GROUPS], islands, bounds: { kind: 'square', half: 40000 }, focus: { x: 0, z: -setup.spawnDistance / 2 }, labels: {}, error };
}
export function applyCustomDeployment(setup: BattleSetup, units: readonly ChartUnit[]): BattleSetup {
  const round = (value: number) => Math.round(value / 10) * 10;
  const side = (team: Team) => units.filter(unit => unit.side === team).map(unit => ({ x: round(unit.spawn.x), z: round(unit.spawn.z), heading: unit.spawn.heading }));
  return { ...setup, spawns: { friendly: side('friendly'), enemy: side('enemy') } };
}

/** PvE: the player's task groups inside the circular battle area; the enemy stays unseen. */
export function pveDeployment(briefing: PveBriefing, placements: readonly Placement[]): Deployment {
  const groups = briefing.groups.filter(group => briefing.assignments.some(unit => unit.groupId === group.id)).map(group => ({ id: group.id, name: group.name, side: 'friendly' as const }));
  const units = placements.flatMap(placement => {
    const unit = briefing.assignments.find(ship => ship.id === placement.id);
    return unit ? [{ id: unit.id, presetId: unit.presetId, name: unitName(unit, briefing.assignments), side: 'friendly' as const, groupId: unit.groupId, spawn: placement.spawn }] : [];
  });
  return { units, groups, islands: deploymentIslands(briefing), bounds: { kind: 'circle', radius: briefing.setup.missionRules!.area.radiusM }, friendlyMinZ: briefing.deploymentMinZ, focus: { x: 0, z: 0 },
    labels: { north: 'NO CONTACTS REPORTED', south: 'FRIENDLY DEPLOYMENT' }, error: placementError(briefing, [...placements]) };
}
export const applyPveDeployment = (units: readonly ChartUnit[]): Placement[] => units.map(unit => ({ id: unit.id, spawn: unit.spawn }));

export function unitsBox(units: readonly ChartUnit[]) {
  const xs = units.map(unit => unit.spawn.x), zs = units.map(unit => unit.spawn.z);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
export function unitsCenter(units: readonly ChartUnit[]) {
  return { x: units.reduce((sum, unit) => sum + unit.spawn.x, 0) / (units.length || 1), z: units.reduce((sum, unit) => sum + unit.spawn.z, 0) / (units.length || 1) };
}
/** Radius that shows the whole battle area, or every ship of a custom battle with sea around it. */
export function fitRadius(deployment: Deployment): number {
  if (deployment.bounds.kind === 'circle') return deployment.bounds.radius * 1.12;
  const box = unitsBox(deployment.units), { x, z } = deployment.focus;
  return Math.max(4000, Math.abs(box.x0 - x), Math.abs(box.x1 - x), Math.abs(box.z0 - z), Math.abs(box.z1 - z)) * 1.25 + 1500;
}
export const headingDegrees = (heading: number) => ((Math.round(heading * 180 / Math.PI) % 360) + 360) % 360;
export const formatHeading = (heading: number) => `${String(headingDegrees(heading)).padStart(3, '0')}°`;
