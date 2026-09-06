import type { Game } from '../game/Game';
import type { CombatTelemetry } from '../simulation/combat';
import './FlightControl.css';

export function FlightControl({ combat, game, followedAircraftId }: { combat: CombatTelemetry; game: Game | null; followedAircraftId?: string }) {
  const wing = combat.airWing;
  if (!wing) return null;
  const targetUnavailable = combat.targetSunk || combat.contacts.some(c => c.id === combat.targetId && c.combatLost) || (combat.targetDepthM ?? 0) > 8;
  const active = wing.squadrons.reduce((n, s) => n + s.airborne + s.queued, 0);
  return <section className="fleet-flight" aria-label="Carrier aircraft operations">
    <header><h2>Air group</h2><span>{active} deployed</span></header>
    <p className="fleet-flight-target">Strike target: {combat.targetName}</p>
    {targetUnavailable && <p className="fleet-flight-warning">Select an afloat surface target for a strike.</p>}
    {wing.squadrons.map(s => <div className="fleet-flight-squadron" key={s.id}>
      <div><strong>{s.name}</strong><span>{s.role === 'fighter' ? 'Intercept aircraft' : s.role === 'dive-bomber' ? 'Dive bomb' : 'Torpedo attack'}</span></div>
      <button disabled={!wing.available || !s.ready || s.role !== 'fighter' && targetUnavailable} onClick={e => { game?.launchAircraft(s.id); e.currentTarget.blur(); }} aria-label={`Launch ${Math.min(3, s.ready)} ${s.name}`}>Launch {Math.min(3, s.ready)}</button>
      <p>{s.ready} ready · {s.airborne} flying{s.queued > 0 ? ` · ${s.queued} queued` : ''}{s.rearming > 0 ? ` · ${s.rearming} rearming ${s.rearmSeconds}s` : ''}{s.lost > 0 ? ` · ${s.lost} lost` : ''}{s.kills > 0 ? ` · ${s.kills} air kills` : ''}</p>
    </div>)}
    <footer><span>Hold Ctrl to command</span><button disabled={!active || combat.playerSunk} onClick={e => { game?.recallAircraft(); e.currentTarget.blur(); }}>Recall all</button></footer>
    {!wing.available && <p className="fleet-flight-warning">{combat.result !== 'active' ? 'Battle ended' : combat.playerSunk ? 'Carrier lost' : 'Flight operations suspended · Check damage and ship attitude'}</p>}
    {!!wing.flights.length && <details><summary>Aircraft · select to follow</summary><ul>{wing.flights.map(p => <li key={p.id}><span>{p.id.split('/').slice(1).join(' / ')} · {p.phase}</span><span>{Math.ceil(p.hp)}% · {p.modelId.includes('wildcat') ? `${p.ammo} bursts` : p.payload ? 'Armed' : 'Released'}</span><button aria-pressed={followedAircraftId === p.id} aria-label={`Follow ${p.id.split('/').slice(1).join(' ')}`} onClick={e => { game?.followAircraft(p.id); e.currentTarget.blur(); }}>{followedAircraftId === p.id ? 'Following' : 'Follow'}</button></li>)}</ul></details>}
  </section>;
}
