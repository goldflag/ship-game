import type { AircraftRole } from '../ships/blueprint';
import { FIGHTER_AMMO_BURSTS } from '../simulation/aircraft';
import type { AirStrike, StrikeIntent } from './airIntent';
import { duration } from './airFormat';
import { aircraftTypeLabel } from './fleetStats';

/** Bursts per belt cell: sixteen bursts read as four cells. */
export const BELT_CELL_BURSTS = FIGHTER_AMMO_BURSTS / 4;
/** Brass once a fighter is down to its last cell. */
export const LOW_BURSTS = BELT_CELL_BURSTS;

/** Four cells off the starboard wing of an own fighter's marker, emptying from the
 * bottom as the guns are fired; brass on the last cell, hollow when empty. */
export function AmmoBelt({ bursts }: { bursts: number }) {
  const left = Math.max(0, Math.min(FIGHTER_AMMO_BURSTS, bursts));
  const cells = Math.ceil(left / BELT_CELL_BURSTS);
  return <g className={`fleet-command-belt ${left > 0 && left <= LOW_BURSTS ? 'low' : ''}`} transform="translate(8 -8)" role="meter" aria-label={`${left} of ${FIGHTER_AMMO_BURSTS} bursts`}
    aria-valuemin={0} aria-valuemax={FIGHTER_AMMO_BURSTS} aria-valuenow={left}>
    {[0, 1, 2, 3].map(i => <rect key={i} className={i >= 4 - cells ? 'on' : undefined} x="0" y={i * 4} width="3" height="3"/>)}
  </g>;
}

/** The weapon a bomber still carries, drawn inside its silhouette along the
 * fuselage: a torpedo as a stripe, a bomb as a dot. Nothing once it is released
 * (the silhouette itself goes hollow) or when the load has not been observed. */
export function OrdnanceMark({ role, carrying }: { role: AircraftRole | 'unknown'; carrying: boolean | undefined }) {
  if (!carrying || role === 'fighter') return null;
  return role === 'dive-bomber' ? <circle className="fleet-command-ordnance" cy="-.4" r="1.3"/>
    : <rect className="fleet-command-ordnance" x="-.8" y="-2.4" width="1.6" height="4.8"/>;
}

/** What a threatened ship's label says beneath its order line: each inbound
 * strike's count and type, a pip per plane (solid carrying, hollow released,
 * dashed unobserved) and the time to its release point. */
export function InboundBadge({ strikes, x, y }: { strikes: readonly (AirStrike & { intent: StrikeIntent })[]; x: number; y: number }) {
  if (!strikes.length) return null;
  return <g className="fleet-command-inbound" transform={`translate(${x} ${y})`} role="group" aria-label="Inbound strikes">
    {strikes.map((strike, row) => {
      const { cluster, carrying, released, intent } = strike;
      const type = aircraftTypeLabel(cluster.type, cluster.count).replace(/^\d+ /, '');
      const pips = Array.from({ length: cluster.count }, (_, i) => i < carrying ? 'on' : i < carrying + released ? 'released' : 'unobserved');
      return <g key={cluster.id} transform={`translate(0 ${row * 13})`} aria-label={`${cluster.count} ${type} inbound · ${carrying} carrying · release in ${duration(intent.releaseSeconds)}`}>
        {pips.map((state, i) => <rect key={i} className={state} x={i * 8} y="-3" width="6" height="2.5"/>)}
        <text x={cluster.count * 8 + 3} y="1.5">{cluster.count} {type} · {duration(intent.releaseSeconds)}</text>
      </g>;
    })}
  </g>;
}
