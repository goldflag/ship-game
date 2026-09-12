import { FleetOrders } from './FleetOrders';
import { Button, Select, SelectOption } from './components';
import { useState, type ReactNode } from 'react';
import { Icon } from './Icons';
import type { Game } from '../game/Game';
import type { CombatTelemetry } from '../simulation/combat';
import { bindingLabel, type Keybindings } from '../game/keybindings';

type Contact = CombatTelemetry['contacts'][number];
export const contactLabel = (contact: Contact) => contact.controller === 'player' && contact.team === 'friendly' ? `${contact.name} (You)` : `${contact.name} #${contact.id.split('-').at(-1)}`;
const lost = (contact: Contact) => contact.physicalLost;
const condition = (contact: Contact) => contact.status.replaceAll('-', ' ');

function TeamStatus({ team, combat, game, expanded, onToggle }: { team: Contact['team']; combat: CombatTelemetry; game: Game | null; expanded: boolean; onToggle(): void }) {
  const contacts = combat.contacts.filter(contact => contact.team === team);
  const active = contacts.filter(contact => !lost(contact));
  const damaged = active.filter(contact => contact.integrity < .995 || contact.status !== 'operational').length;
  const name = team === 'friendly' ? 'Friendly' : 'Enemy';
  if (team === 'enemy' && combat.afloatKg[1] === null) return <div className="fleet-team fleet-team-enemy"><span className="fleet-team-count">Enemy strength <strong>Unknown</strong></span><span className="fleet-team-state">{game?.simulation.observationTracks?.filter(c => c.kind === 'surface').length ?? 0} surface reports · Search on the fleet map</span></div>;
  return <div className={`fleet-team fleet-team-${team}`}>
    <button className="fleet-team-toggle" aria-expanded={expanded} aria-controls={`fleet-roster-${team}`} onClick={event => { onToggle(); event.currentTarget.blur(); }} aria-label={`${name} fleet: ${active.length} of ${contacts.length} afloat, ${damaged} damaged, ${contacts.length - active.length} lost. ${expanded ? 'Hide' : 'Show'} ships.`}>
      <span className="fleet-team-count">{name} <strong>{active.length}</strong><span>/{contacts.length}</span></span>
      <span className="fleet-team-state">{damaged} damaged · {contacts.length - active.length} lost</span>
    </button>
    <div className="fleet-roster" id={`fleet-roster-${team}`} hidden={!expanded}>
      <ul aria-label={`${name} ships`}>{contacts.map(contact => <li key={contact.id} className={lost(contact) ? 'fleet-roster-lost' : ''}>
        {team === 'enemy' ? <button title={condition(contact)} aria-pressed={combat.targetId === contact.id} onClick={event => { game?.selectTarget(contact.id); event.currentTarget.blur(); }}>{contactLabel(contact)}</button> : <strong title={condition(contact)}>{contactLabel(contact)}</strong>}
        <span className="fleet-roster-condition">{contact.status !== 'operational' && condition(contact)}</span>
        <span aria-label={`${contactLabel(contact)} hull ${Math.round(contact.integrity * 100)} percent`}>{Math.round(contact.integrity * 100)}%</span>
      </li>)}</ul>
    </div>
  </div>;
}

export function BattleStatus({ combat, game, children, spectatedShipId, bindings }: { combat: CombatTelemetry; game: Game | null; children?: ReactNode; spectatedShipId?: string; bindings?: Keybindings }) {
  const [expandedTeam, setExpandedTeam] = useState<Contact['team'] | null>(null);
  const teammates = combat.contacts.filter(contact => contact.team === 'friendly' && contact.controller !== 'player' && !lost(contact));
  return <section className="fleet-battle" aria-label="Battle status">
    {combat.result !== 'active' && <h2>{combat.outcome?.reason === 'infrastructure' ? 'Battle interrupted' : combat.outcome?.reason === 'abandoned' ? 'Battle abandoned' : combat.result === 'victory' ? 'Victory' : combat.result === 'defeat' ? 'Defeat' : 'Draw'}</h2>}
    <div className="fleet-battle-clock" aria-label="Battle time and afloat tonnage">
      <span>{combat.result === 'active' ? combat.remainingSeconds === null ? 'No time limit · Elapsed' : 'Time remaining' : combat.outcome?.reason === 'time-limit' ? 'Time limit reached' : combat.outcome?.reason === 'forfeit' ? 'Battle forfeited' : combat.outcome?.reason === 'abandoned' ? 'Battle abandoned' : combat.outcome?.reason === 'infrastructure' ? 'Battle interrupted' : 'Fleet destroyed'}</span>
      <strong>{String(Math.floor((combat.remainingSeconds ?? (game?.simulation.tick ?? 0) / 60) / 60)).padStart(2, '0')}:{String(Math.floor((combat.remainingSeconds ?? (game?.simulation.tick ?? 0) / 60) % 60)).padStart(2, '0')}</strong>
    </div>
    <p className="fleet-tonnage">Afloat · Friendly {combat.afloatKg[0] === null ? 'Unknown' : (combat.afloatKg[0]! / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' t'} · Enemy {combat.afloatKg[1] === null ? 'Unknown' : (combat.afloatKg[1]! / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' t'}</p>
    {(game?.simulation.networked || game?.simulation.connectionStatus || game?.simulation.phase === 'cancelled') && <p className="fleet-network-status" role="status">{game.simulation.connectionStatus || (game.simulation.phase === 'loading' ? 'Waiting for both fleets to load' : game.simulation.phase === 'countdown' ? 'Both fleets ready — battle starting' : game.simulation.phase === 'cancelled' ? 'Battle cancelled before starting' : '')}</p>}
    <FleetOrders game={game} combat={combat}/>
    <div className="fleet-teams" aria-label="Team status">{(['friendly', 'enemy'] as const).map(team => <TeamStatus key={team} team={team} combat={combat} game={game} expanded={expandedTeam === team} onToggle={() => setExpandedTeam(expandedTeam === team ? null : team)}/>)}</div>
    {combat.result !== 'active' && <small>Esc to return to port</small>}
    {combat.result === 'active' && combat.playerSunk && <small>Your ship is sinking · Allies still fighting</small>}
    {combat.playerSunk && <div className="fleet-spectator" aria-label="Teammate spectating">
      {teammates.length ? <>
        <label htmlFor="spectated-ship">Spectating teammate</label>
        <div className="fleet-spectator-controls">
          <Button variant="icon" disabled={teammates.length < 2} onClick={event => { game?.cycleSpectator(-1); event.currentTarget.blur(); }} aria-label="Spectate previous teammate" title="Previous teammate · Left arrow" aria-keyshortcuts="ArrowLeft"><Icon name="chevron" size={16} style={{ transform: 'rotate(90deg)' }}/></Button>
          <Select id="spectated-ship" value={spectatedShipId ?? ''} onValueChange={value => game?.spectateTeammate(value)}>
            {!spectatedShipId && <SelectOption value="" disabled>Choose teammate</SelectOption>}
            {teammates.map(contact => <SelectOption key={contact.id} value={contact.id}>{contactLabel(contact)}</SelectOption>)}
          </Select>
          <Button variant="icon" disabled={teammates.length < 2} onClick={event => { game?.cycleSpectator(1); event.currentTarget.blur(); }} aria-label="Spectate next teammate" title="Next teammate · Right arrow" aria-keyshortcuts="ArrowRight"><Icon name="chevron" size={16} style={{ transform: 'rotate(-90deg)' }}/></Button>
        </div>
        {game?.simulation.selectShip && <Button onClick={event => { game.openHelmWheel('sunk'); event.currentTarget.blur(); }} aria-keyshortcuts={bindings?.helmWheel[0] ?? undefined}>Take a helm{bindings && <kbd>{bindingLabel(bindings, 'helmWheel')}</kbd>}</Button>}
        <small>← / → switch teammates · Hold Ctrl for cursor</small>
        <small>Click sea to look around · Scroll to zoom</small>
      </> : <small role="status">No teammates remaining to spectate</small>}
    </div>}
    {children}
  </section>;
}
