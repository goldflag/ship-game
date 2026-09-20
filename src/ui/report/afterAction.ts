import type { BattleDebrief, DebriefShip } from '../../game/session/BattleSession';
import type { HitReport } from '../../multiplayer/generated/HitReport';
import { FIXED_DT } from '../../game/session/motion';
import { shipTitle } from '../../ships/localShips';

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
  /** Mark size, by this hit's share of all damage the ship took. */
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

export const battleTime = (tick: number) => {
  const seconds = Math.floor(tick * FIXED_DT);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
export const whole = (value: number) => Math.round(value).toLocaleString('en-US');

/** Roster names, numbered where a fleet has several of one ship. */
export function shipTitles(debrief: BattleDebrief): Map<string, string> {
  const titles = new Map<string, string>();
  for (const ship of debrief.ships) {
    const same = debrief.ships.filter(other => other.team === ship.team && other.presetId === ship.presetId);
    const title = shipTitle({ id: ship.presetId, name: ship.name });
    titles.set(ship.id, same.length > 1 ? `${title} ${same.indexOf(ship) + 1}` : title);
  }
  return titles;
}

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
        ...hit.flooded.map(room => ({ name: plainName(room), effect: hit.kind === 'shell' && hit.position[1] > 1 ? 'Holed above the waterline' : 'Flooding' })),
      ],
      size: share >= .15 ? 'l' : share >= .04 ? 'm' : 's',
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
