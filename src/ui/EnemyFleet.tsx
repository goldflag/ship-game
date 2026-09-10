import './FleetCards.css';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import { shipPreset } from '../ships/presets';
import { PLANE_GLYPHS } from './planeGlyphs';
import { SHIP_GLYPHS, shipClassFromReport, shipClassOf } from './shipGlyphs';
import { conditionReport, observationAge, reportPosition, reportState } from './reconReports';
import type { AirCluster, BattleComparison } from './fleetStats';

export const bearingLabel = (dx: number, dz: number) => `${String(Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360) % 360).padStart(3, '0')}°`;
export const rangeLabel = (dx: number, dz: number) => `${(Math.hypot(dx, dz) / 1000).toFixed(1)} km`;
const tonnes = (kg: number) => `${Math.round(kg / 1000).toLocaleString()} t`;

/** What observers have reported, in the same card shape as our own fleet: the
 * hulls they have seen, the aircraft they have counted, and the running battle
 * comparison whose enemy column is only ever what was actually spotted. */
export function EnemyFleet({ tracks, clusters, tick, origin, selectedId, onSelect, nameOf, comparison }: {
  tracks: readonly ContactTrack[]; clusters: readonly AirCluster[]; tick: number; origin: { x: number; z: number };
  selectedId?: string; onSelect(track: ContactTrack): void; nameOf(track: ContactTrack): string; comparison: BattleComparison;
}) {
  const surface = tracks.filter(t => t.kind === 'surface').map(t => ({ track: t, position: reportPosition(t, tick), state: reportState(t, tick) }))
    .sort((a, b) => Math.hypot(a.position[0] - origin.x, a.position[2] - origin.z) - Math.hypot(b.position[0] - origin.x, b.position[2] - origin.z));
  const sunk = surface.filter(s => s.state === 'confirmed-sinking').length;
  const current = surface.filter(s => s.state === 'current').length;
  const seen = clusters.reduce((n, c) => n + c.trackIds.length, 0);
  return <section className="fleet-card foe" aria-label="Enemy fleet">
    <h2>Enemy fleet<span>{surface.length - sunk} spotted{sunk ? ` · ${sunk} sunk` : ''} · total unknown</span></h2>
    {!surface.length && !clusters.length && <p>No contacts reported. Send ships or aircraft forward to search.</p>}
    {surface.length > 0 && <h4 className="fleet-card-head"><span>Ships</span><small>{current} current{surface.length - current ? ` · ${surface.length - current} stale` : ''}</small></h4>}
    {surface.map(({ track, position, state }) => {
      const glyph = SHIP_GLYPHS[track.identifiedPresetId ? shipClassOf(shipPreset(track.identifiedPresetId)) : shipClassFromReport(track.classification)];
      return <button key={track.id} className={`fleet-card-row ${state} ${track.id === selectedId ? 'selected' : ''}`} aria-pressed={track.id === selectedId} onClick={() => onSelect(track)}>
        <svg className={`fleet-card-glyph ${state === 'estimated' ? 'estimated' : ''} ${state === 'last-known' || state === 'confirmed-sinking' ? 'faded' : ''}`} viewBox="-13 -13 26 26" aria-hidden="true">
          <path className="fleet-card-hull" d={glyph.hull}/><path className="fleet-card-mark" d={glyph.mark}/></svg>
        <span className="fleet-card-name">{nameOf(track)}<small>{track.identifiedPresetId ? 'identified' : 'unidentified'} · {state.replaceAll('-', ' ')} · {observationAge(track.lastObservedTick, tick)}{state === 'confirmed-sinking' ? '' : ` · ${conditionReport(track, tick).split(' · ')[0].toLowerCase()}`}</small></span>
        <span className="fleet-card-value">{rangeLabel(position[0] - origin.x, position[2] - origin.z)}<small>{bearingLabel(position[0] - origin.x, position[2] - origin.z)}</small></span>
      </button>;
    })}
    {(clusters.length > 0 || comparison.aircraft.enemyLost > 0) && <h4 className="fleet-card-head"><span>Aircraft seen</span><small>{seen} seen{comparison.aircraft.enemyLost ? ` · ${comparison.aircraft.enemyLost} shot down` : ''}</small></h4>}
    {clusters.map(cluster => {
      const first = tracks.find(t => t.id === cluster.trackIds[0])!;
      const selected = cluster.trackIds.includes(selectedId ?? '');
      const bearing = `${rangeLabel(cluster.position[0] - origin.x, cluster.position[2] - origin.z)} ${bearingLabel(cluster.position[0] - origin.x, cluster.position[2] - origin.z)}`;
      return <button key={cluster.id} className={`fleet-card-row air ${cluster.stale ? 'last-known' : 'current'} ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(first)}>
        <svg className="fleet-card-plane" viewBox="-12 -12 24 24" aria-hidden="true"><path d={PLANE_GLYPHS[cluster.type]} transform="scale(1.25)"/></svg>
        <span className="fleet-card-name">{cluster.label}{cluster.model ? ` · ${cluster.model}` : ''}
          <small>{cluster.stale ? `last known · ${observationAge(cluster.lastObservedTick, tick)} · ${bearing}` : `current · ${bearing}`}{cluster.smoking ? ` · ${cluster.smoking} smoking` : ''}</small></span>
        <span className="fleet-card-value">{cluster.count} seen</span>
      </button>;
    })}
    <table className="fleet-card-comparison" aria-label="Battle comparison"><thead><tr><th scope="col">Battle</th><th scope="col">Us</th><th scope="col">Them<small>spotted only</small></th></tr></thead><tbody>
      <tr><td>Damage dealt</td><td>{comparison.damageDealt[0].toLocaleString()}</td><td>{comparison.damageDealt[1].toLocaleString()}</td></tr>
      <tr><td>Tonnage afloat</td><td>{tonnes(comparison.tonnageAfloat[0])}</td><td>{comparison.tonnageAfloat[1] || comparison.unidentified ? `≥ ${tonnes(comparison.tonnageAfloat[1])}` : '—'}{comparison.unidentified > 0 && <small>+{comparison.unidentified} unidentified</small>}</td></tr>
      <tr><td>Aircraft</td><td>{comparison.aircraft.own[1] ? `${comparison.aircraft.own[0]} of ${comparison.aircraft.own[1]}` : '—'}</td><td>{comparison.aircraft.enemySeen} seen{comparison.aircraft.enemyLost > 0 && <small>{comparison.aircraft.enemyLost} seen lost</small>}</td></tr>
      <tr><td>Ships lost</td><td>{comparison.shipsLost[0]}</td><td>{comparison.shipsLost[1]}</td></tr>
    </tbody></table>
  </section>;
}
