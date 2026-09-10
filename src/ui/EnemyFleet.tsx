import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import { PLANE_GLYPHS } from './planeGlyphs';
import { conditionReport, observationAge, reportPosition, reportState } from './reconReports';
import type { AirCluster, BattleComparison } from './fleetStats';

export const bearingLabel = (dx: number, dz: number) => `${String(Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360) % 360).padStart(3, '0')}°`;
export const rangeLabel = (dx: number, dz: number) => `${(Math.hypot(dx, dz) / 1000).toFixed(1)} km`;
const tonnes = (kg: number) => `${Math.round(kg / 1000).toLocaleString()} t`;

export function EnemyFleet({ tracks, clusters, tick, origin, selectedId, onSelect, nameOf, comparison }: {
  tracks: readonly ContactTrack[]; clusters: readonly AirCluster[]; tick: number; origin: { x: number; z: number };
  selectedId?: string; onSelect(track: ContactTrack): void; nameOf(track: ContactTrack): string; comparison: BattleComparison;
}) {
  const surface = tracks.filter(t => t.kind === 'surface').map(t => ({ track: t, position: reportPosition(t, tick), state: reportState(t, tick) }))
    .sort((a, b) => Math.hypot(a.position[0] - origin.x, a.position[2] - origin.z) - Math.hypot(b.position[0] - origin.x, b.position[2] - origin.z));
  const sunk = surface.filter(s => s.state === 'confirmed-sinking').length;
  return <section className="fleet-command-enemy" aria-label="Enemy fleet">
    <h2>Enemy fleet<span>{surface.length - sunk} spotted{sunk ? ` · ${sunk} sunk` : ''} · total unknown</span></h2>
    {!surface.length && !clusters.length && <p>No contacts reported. Send ships or aircraft forward to search.</p>}
    {surface.map(({ track, position, state }) => <button key={track.id} className={`fleet-command-enemy-row ${state} ${track.id === selectedId ? 'selected' : ''}`} aria-pressed={track.id === selectedId} onClick={() => onSelect(track)}>
      <span className={`fleet-command-enemy-glyph ${state}`} aria-hidden="true"/>
      <span><strong>{nameOf(track)}</strong><small>{track.identifiedPresetId ? 'identified' : 'unidentified'} · {state.replaceAll('-', ' ')} · {observationAge(track.lastObservedTick, tick)}{state === 'confirmed-sinking' ? '' : ` · ${conditionReport(track, tick).split(' · ')[0].toLowerCase()}`}</small></span>
      <span className="fleet-command-enemy-range">{rangeLabel(position[0] - origin.x, position[2] - origin.z)}<small>{bearingLabel(position[0] - origin.x, position[2] - origin.z)}</small></span>
    </button>)}
    {clusters.map(cluster => { const first = tracks.find(t => t.id === cluster.trackIds[0])!; return <button key={cluster.id} className={`fleet-command-enemy-row air ${cluster.stale ? 'last-known' : 'current'} ${cluster.trackIds.includes(selectedId ?? '') ? 'selected' : ''}`} aria-pressed={cluster.trackIds.includes(selectedId ?? '')} onClick={() => onSelect(first)}>
      <svg className="fleet-command-enemy-plane" viewBox="-12 -12 24 24" aria-hidden="true"><path d={PLANE_GLYPHS[cluster.type]} transform="scale(1.25)"/></svg>
      <span><strong>{cluster.label}</strong><small>{cluster.model ? `${cluster.model} · ` : ''}{cluster.stale ? 'last known' : 'current'} · {observationAge(cluster.lastObservedTick, tick)}{cluster.smoking ? ` · ${cluster.smoking} smoking` : ''}</small></span>
      <span className="fleet-command-enemy-range">{rangeLabel(cluster.position[0] - origin.x, cluster.position[2] - origin.z)}<small>{bearingLabel(cluster.position[0] - origin.x, cluster.position[2] - origin.z)}</small></span>
    </button>; })}
    <table className="fleet-command-comparison" aria-label="Battle comparison"><thead><tr><th scope="col">Battle</th><th scope="col">Us</th><th scope="col">Them<small>spotted only</small></th></tr></thead><tbody>
      <tr><td>Damage dealt</td><td>{comparison.damageDealt[0].toLocaleString()}</td><td>{comparison.damageDealt[1].toLocaleString()}</td></tr>
      <tr><td>Tonnage afloat</td><td>{tonnes(comparison.tonnageAfloat[0])}</td><td>{comparison.tonnageAfloat[1] || comparison.unidentified ? `≥ ${tonnes(comparison.tonnageAfloat[1])}` : '—'}{comparison.unidentified > 0 && <small>+{comparison.unidentified} unidentified</small>}</td></tr>
      <tr><td>Aircraft</td><td>{comparison.aircraft.own[1] ? `${comparison.aircraft.own[0]} of ${comparison.aircraft.own[1]}` : '—'}</td><td>{comparison.aircraft.enemySeen} seen{comparison.aircraft.enemyLost > 0 && <small>{comparison.aircraft.enemyLost} seen lost</small>}</td></tr>
      <tr><td>Ships lost</td><td>{comparison.shipsLost[0]}</td><td>{comparison.shipsLost[1]}</td></tr>
    </tbody></table>
  </section>;
}
