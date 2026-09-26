import type { BattleDebrief, BattleResult, DebriefShip } from '../../game/session/BattleSession';
import type { BattleOutcome } from '../../game/session/battleRules';
import type { HitReport } from '../../multiplayer/generated/HitReport';
import { FIXED_DT } from '../../game/session/motion';
import { shipTitle } from '../../ships/localShips';
import { scenarioInfo, scenarioShipTitle } from '../battle/scenarios';

/** How a hit is drawn: what did the damage, or that the armor held. */
export type HitTone = 'penetrated' | 'explosive' | 'torpedo' | 'blocked';
export interface HitRow {
  /** Order received, from 1. */
  n: number;
  hit: HitReport;
  time: string;
  from: string;
  tone: HitTone;
  outcome: string;
  /** "310 mm Main belt at 24° · 339 mm effective" */
  plate?: string;
  effects: { name: string; effect: string }[];
  /** Mark size, by this hit's share of all damage the ship took: 3% makes a hit heavy, 8% large. */
  size: 's' | 'm' | 'l';
}
export interface FleetRow {
  ship: DebriefShip;
  title: string;
  state: string;
  lost: boolean;
  byWeapon: { label: string; damage: number }[];
  hits: string;
  sank: string;
}
export interface SinkMark { tick: number; label: string; friendly: boolean }
/** One ship of the other fleet and how its damage was shared out. */
export interface TargetShare {
  target: DebriefShip;
  title: string;
  /** "Sunk 7:09", "Afloat · 74%". */
  state: string;
  /** Everything the target took, from anyone. */
  total: number;
  /** This ship's part of it. */
  mine: number;
  /** Who dealt it, this ship first. */
  by: { id: string; title: string; damage: number }[];
  finalBlow?: string;
}
/** What hurt a ship most: one gun of one enemy. */
export interface Hurt { from: string; weapon: string; hits: number; damage: number; share: number }
/** Damage between every pair of ships of two fleets: `cells[row][column]`. */
export interface PairDamage { rows: { id: string; title: string }[]; columns: { id: string; title: string }[]; cells: number[][]; max: number }
export interface HitLane { ship: DebriefShip; title: string; state: string; rows: HitRow[]; lostTick?: number }

export const battleTime = (tick: number) => {
  const seconds = Math.floor(tick * FIXED_DT);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
export const whole = (value: number) => Math.round(value).toLocaleString('en-US');
export const percent = (part: number, total: number) => `${Math.round(part / Math.max(total, 1) * 100)}%`;

type Decided = Exclude<BattleResult, 'active'>;
export const resultTitle = (result: Decided) => result === 'victory' ? 'Victory' : result === 'defeat' ? 'Defeat' : 'Draw';
export const reasonText = (result: Decided, outcome: BattleOutcome) => outcome.reason === 'time-limit' ? 'The time limit was reached'
  : outcome.reason === 'forfeit' ? (result === 'victory' ? 'The enemy struck their colors' : 'Your fleet struck its colors')
  : result === 'victory' ? 'The enemy fleet can no longer fight' : result === 'defeat' ? 'Your fleet can no longer fight' : 'Neither fleet can fight on';

/** Roster names, numbered where a fleet has several of one ship. */
export function shipTitles(debrief: BattleDebrief): Map<string, string> {
  const titles = new Map<string, string>();
  const scenario = scenarioInfo(debrief.scenario?.id);
  for (const ship of debrief.ships) {
    const named = scenarioShipTitle(scenario, ship.id);
    if (named) { titles.set(ship.id, named); continue; }
    const same = debrief.ships.filter(other => other.team === ship.team && other.presetId === ship.presetId);
    const title = shipTitle({ id: ship.presetId, name: ship.name });
    titles.set(ship.id, same.length > 1 ? `${title} ${same.indexOf(ship) + 1}` : title);
  }
  return titles;
}

/** "Sunk 7:09", "Out of action", "Afloat · 74%". */
export const shortState = (ship: DebriefShip) => ship.status === 'sunk'
  ? `Sunk${ship.report.lostTick === undefined ? '' : ` ${battleTime(ship.report.lostTick)}`}`
  : ship.status === 'incapacitated' ? 'Out of action' : `Afloat · ${Math.round(ship.integrity * 100)}%`;

export function fleetRows(debrief: BattleDebrief, team: DebriefShip['team']): FleetRow[] {
  const titles = shipTitles(debrief);
  return debrief.ships.filter(ship => ship.team === team).map(ship => {
    const { lostTick, sunkBy } = ship.report;
    const lost = ship.status !== 'operational';
    const state = ship.status === 'sunk'
      ? `Sunk${lostTick === undefined ? '' : ` ${battleTime(lostTick)}`}${sunkBy && titles.has(sunkBy) ? ` by ${titles.get(sunkBy)}` : ''}`
      : ship.status === 'incapacitated' ? 'Out of action' : `Afloat · ${Math.round(ship.integrity * 100)}%`;
    const weapons = Object.entries(ship.report.dealtByWeapon).map(([label, damage]) => ({ label, damage })).sort((a, b) => b.damage - a.damage);
    const other = weapons.slice(2).reduce((sum, weapon) => sum + weapon.damage, 0);
    return {
      ship, title: titles.get(ship.id)!, state, lost,
      byWeapon: other > 0 ? [...weapons.slice(0, 2), { label: 'Other', damage: other }] : weapons,
      hits: `${ship.report.hitsLanded.toLocaleString('en-US')} / ${ship.report.shotsFired.toLocaleString('en-US')}`,
      sank: debrief.ships.filter(other => other.report.sunkBy === ship.id && other.status === 'sunk').map(other => titles.get(other.id)!).join(', ') || '—',
    };
  });
}

function tone(hit: HitReport): HitTone {
  if (hit.outcome === 'stopped' || hit.outcome === 'ricochet' || hit.outcome === 'dud') return 'blocked';
  if (hit.kind !== 'shell') return 'torpedo';
  return hit.outcome === 'burst' || hit.ammunition === 'he' ? 'explosive' : 'penetrated';
}
/** Construction plates are named by their piece and face ("navigation-gallery:slope"); say that in words. */
export const plainName = (name: string) => /^[a-z0-9]+([-_:.][a-z0-9]+)+$/.test(name)
  ? name.replace(/[:.]/g, ', ').replace(/[-_]/g, ' ').replace(/^./, first => first.toUpperCase()) : name;
/** Rooms the compiler laid out itself carry "· estimated" or "(estimated)"; a reader does not need to know. */
export const roomName = (name: string) => plainName(name.replace(/\s*(·\s*estimated|\(estimated\))\s*$/i, ''));
const OUTCOMES: Record<HitReport['outcome'], string> = {
  penetrated: 'Penetrated', burst: 'Burst outside', stopped: 'Stopped', ricochet: 'Ricochet', detonated: 'Detonated', dud: 'Dud',
};

export function hitRows(debrief: BattleDebrief, shipId: string): HitRow[] {
  const ship = debrief.ships.find(candidate => candidate.id === shipId);
  if (!ship) return [];
  const titles = shipTitles(debrief);
  const taken = Math.max(ship.report.damageTaken, 1);
  return ship.report.hits.map((hit, index) => {
    const plate = hit.plate && `${Math.round(hit.plate.thicknessMm)} mm ${plainName(hit.plate.name)}${hit.plate.obliquityDeg === undefined ? '' : ` at ${Math.round(hit.plate.obliquityDeg)}°`}${
      hit.plate.resistanceMm === undefined || Math.round(hit.plate.resistanceMm) === Math.round(hit.plate.thicknessMm) ? '' : ` · ${Math.round(hit.plate.resistanceMm)} mm effective`}`;
    const share = hit.damage / taken;
    return {
      n: index + 1, hit, time: battleTime(hit.tick), from: titles.get(hit.sourceId) ?? 'Unknown ship', tone: tone(hit),
      outcome: tone(hit) === 'penetrated' || hit.outcome !== 'penetrated' ? OUTCOMES[hit.outcome] : 'Burst inside', plate,
      effects: [
        ...hit.modules.map(module => ({ name: plainName(module.name), effect: module.destroyed ? 'Destroyed' : 'Damaged' })),
        ...hit.flooded.map(room => ({ name: roomName(room), effect: hit.kind === 'shell' && hit.position[1] > 1 ? 'Holed above the waterline' : 'Flooding' })),
      ],
      size: share >= .08 ? 'l' : share >= .03 ? 'm' : 's',
    };
  });
}

/** Both fleets' damage over the battle as chart points, closed at the final tick. */
export function damageRace(debrief: BattleDebrief) {
  const total = (team: DebriefShip['team']) => debrief.ships.filter(ship => ship.team === team).reduce((sum, ship) => sum + ship.damageDealt, 0);
  const own = total('friendly'), enemy = total('enemy');
  const samples = [{ tick: 0, own: 0, enemy: 0 }, ...debrief.timeline.filter(sample => sample.tick > 0 && sample.tick < debrief.tick), { tick: debrief.tick, own, enemy }];
  const titles = shipTitles(debrief);
  const marks: SinkMark[] = debrief.ships.filter(ship => ship.status === 'sunk' && ship.report.lostTick !== undefined)
    .map(ship => ({ tick: ship.report.lostTick!, label: `${titles.get(ship.id)} ${ship.team === 'friendly' ? 'lost' : 'sunk'}`, friendly: ship.team === 'friendly' }))
    .sort((a, b) => a.tick - b.tick);
  return { samples, own, enemy, marks, max: Math.max(own, enemy, 1), ticks: Math.max(debrief.tick, 1) };
}

/** Every ship of the other fleet, and how much of the damage it took was this ship's. */
export function targetShares(debrief: BattleDebrief, shipId: string): TargetShare[] {
  const ship = debrief.ships.find(candidate => candidate.id === shipId);
  if (!ship) return [];
  const titles = shipTitles(debrief);
  const own = debrief.ships.filter(other => other.team === ship.team);
  return debrief.ships.filter(target => target.team !== ship.team).map(target => {
    const by = own.map(other => ({ id: other.id, title: titles.get(other.id)!, damage: other.report.dealtTo[target.id] ?? 0 }))
      .filter(part => part.damage >= .5).sort((a, b) => Number(b.id === shipId) - Number(a.id === shipId) || b.damage - a.damage);
    const sunkBy = target.status === 'sunk' ? target.report.sunkBy : undefined;
    return {
      target, title: titles.get(target.id)!, state: shortState(target), mine: ship.report.dealtTo[target.id] ?? 0, by,
      total: Math.max(target.report.damageTaken, by.reduce((sum, part) => sum + part.damage, 0)),
      finalBlow: sunkBy && titles.get(sunkBy),
    };
  });
}

/** What did the most damage to a ship, by enemy and gun. */
export function hurtBy(debrief: BattleDebrief, shipId: string, limit = 3): Hurt[] {
  const ship = debrief.ships.find(candidate => candidate.id === shipId);
  if (!ship) return [];
  const titles = shipTitles(debrief), taken = Math.max(ship.report.damageTaken, 1);
  const groups = new Map<string, Hurt>();
  for (const hit of ship.report.hits) {
    const key = `${hit.sourceId}\u0000${hit.weapon}`;
    const group = groups.get(key) ?? { from: titles.get(hit.sourceId) ?? 'Unknown ship', weapon: hit.weapon, hits: 0, damage: 0, share: 0 };
    group.hits++; group.damage += hit.damage; group.share = group.damage / taken;
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.damage >= .5).sort((a, b) => b.damage - a.damage).slice(0, limit);
}

/** Damage each ship of one fleet did to each ship of the other. */
export function pairDamage(debrief: BattleDebrief, from: DebriefShip['team']): PairDamage {
  const titles = shipTitles(debrief);
  const side = (team: DebriefShip['team']) => debrief.ships.filter(ship => ship.team === team);
  const rows = side(from), columns = side(from === 'friendly' ? 'enemy' : 'friendly');
  const cells = rows.map(row => columns.map(column => row.report.dealtTo[column.id] ?? 0));
  const name = (ship: DebriefShip) => ({ id: ship.id, title: titles.get(ship.id)! });
  return { rows: rows.map(name), columns: columns.map(name), cells, max: Math.max(1, ...cells.flat()) };
}

/** The first flooding of each magazine, in order: the hits a captain remembers. */
export function magazineFloods(ship: DebriefShip): { room: string; tick: number }[] {
  const first = new Map<string, number>();
  for (const hit of ship.report.hits)
    for (const room of hit.flooded) if (/magazine/i.test(room) && !first.has(room)) first.set(room, hit.tick);
  return [...first].map(([room, tick]) => ({ room: roomName(room), tick })).sort((a, b) => a.tick - b.tick);
}

/** One lane per ship for the battle plot: every hit it took, and when it was lost. */
export function hitLanes(debrief: BattleDebrief): HitLane[] {
  const titles = shipTitles(debrief);
  return debrief.ships.map(ship => ({ ship, title: titles.get(ship.id)!, state: shortState(ship), rows: hitRows(debrief, ship.id),
    lostTick: ship.status === 'sunk' ? ship.report.lostTick : undefined }));
}

/** Labels hung over a time axis, stacked into rows so none overlaps another. `at` runs 0 to 1 across the axis; label
 * widths are estimated at `perCharacter` of the axis each. A label that would run off the end is flipped to the left. */
export function stackLabels<T extends { at: number; label: string }>(labels: readonly T[], perCharacter = .0068): (T & { row: number; flip: boolean })[] {
  const ends: number[] = [];
  return [...labels].sort((a, b) => a.at - b.at).map(label => {
    const width = label.label.length * perCharacter + .012, flip = label.at + width > 1;
    const left = flip ? label.at - width : label.at, right = flip ? label.at : label.at + width;
    let row = ends.findIndex(end => left > end + .006);
    if (row < 0) { row = ends.length; ends.push(right); } else ends[row] = right;
    return { ...label, row, flip };
  });
}
