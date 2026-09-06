import { useState } from 'react';
import type { Game } from '../game/Game';
import type { CombatTelemetry } from '../simulation/combat';

type Contact = CombatTelemetry['contacts'][number];
export const contactLabel = (contact: Contact) => contact.controller === 'player' ? `${contact.name} (You)` : `${contact.name} #${contact.id.split('-').at(-1)}`;
const lost = (contact: Contact) => contact.sunk || contact.combatLost;
const condition = (contact: Contact) => `${contact.combatLost && !contact.sunk ? 'Lost · ' : ''}${contact.status.replaceAll('-', ' ')}`;

function TeamStatus({ team, combat, game, expanded, onToggle }: { team: Contact['team']; combat: CombatTelemetry; game: Game | null; expanded: boolean; onToggle(): void }) {
  const contacts = combat.contacts.filter(contact => contact.team === team);
  const active = contacts.filter(contact => !lost(contact));
  const damaged = active.filter(contact => contact.integrity < .995 || contact.status !== 'operational').length;
  const name = team === 'friendly' ? 'Friendly' : 'Enemy';
  return <div className={`fleet-team fleet-team-${team}`}>
    <button className="fleet-team-toggle" aria-expanded={expanded} aria-controls={`fleet-roster-${team}`} onClick={event => { onToggle(); event.currentTarget.blur(); }} aria-label={`${name} fleet: ${active.length} of ${contacts.length} in action, ${damaged} damaged, ${contacts.length - active.length} lost. ${expanded ? 'Hide' : 'Show'} ships.`}>
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

export function BattleStatus({ combat, game }: { combat: CombatTelemetry; game: Game | null }) {
  const [expandedTeam, setExpandedTeam] = useState<Contact['team'] | null>(null);
  return <section className="fleet-battle" aria-label="Battle status">
    {combat.result !== 'active' && <h2>{combat.result === 'victory' ? 'Victory' : combat.result === 'defeat' ? 'Defeat' : 'Draw'}</h2>}
    <div className="fleet-teams" aria-label="Team status">{(['friendly', 'enemy'] as const).map(team => <TeamStatus key={team} team={team} combat={combat} game={game} expanded={expandedTeam === team} onToggle={() => setExpandedTeam(expandedTeam === team ? null : team)}/>)}</div>
    {expandedTeam === null && <div className="fleet-target"><select aria-label="Enemy target" title="Hold Ctrl to select a target" value={combat.targetId} onChange={event => game?.selectTarget(event.target.value)}>{combat.contacts.filter(contact => contact.team === 'enemy').map(contact => <option key={contact.id} value={contact.id}>{contactLabel(contact)} · {Math.round(contact.integrity * 100)}%</option>)}</select><span>{(combat.targetRange / 1000).toFixed(1)} km</span></div>}
    {combat.result !== 'active' && <small>Esc to return to port</small>}
    {combat.result === 'active' && combat.playerSunk && <small>Your ship is sinking · Allies still fighting</small>}
  </section>;
}
