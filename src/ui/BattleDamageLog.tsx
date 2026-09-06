import type { CombatTelemetry } from '../simulation/combat';
import { FIXED_DT } from '../simulation/ship';
import { contactLabel } from './BattleStatus';

function battleTime(tick: number): string {
  const seconds = Math.floor(tick * FIXED_DT);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function BattleDamageLog({ combat, obscured }: { combat: CombatTelemetry; obscured: boolean }) {
  const entries = combat.damageLog;
  const name = (id: string) => {
    const contact = combat.contacts.find(contact => contact.id === id);
    return contact ? contactLabel(contact) : 'Unknown ship';
  };
  return <section className="fleet-combat-report" aria-label="Your battle report">
    <dl className="fleet-score" aria-label="Your battle score">
      <div><dt>Damage</dt><dd>{Math.round(combat.playerDamageDealt).toLocaleString()}</dd></div>
      <div><dt>Frags</dt><dd>{combat.playerFrags}</dd></div>
    </dl>
    {!obscured && entries.length > 0 && <ol className="fleet-damage-log" aria-label="Damage log: damage dealt (+) and taken (−). Latest first. Hold Ctrl to scroll." tabIndex={0}>{entries.map(entry => {
      const outgoing = entry.sourceId === 'player';
      const amount = Math.max(1, Math.round(entry.damage)).toLocaleString();
      const otherShip = name(outgoing ? entry.targetId : entry.sourceId);
      const detail = `${battleTime(entry.tick)} · ${outgoing ? 'Dealt' : 'Taken'} ${amount} HP · ${entry.weapon} · ${outgoing ? 'To' : 'From'} ${otherShip} · ${entry.hits} ${entry.hits === 1 ? 'hit' : 'hits'}`;
      return <li key={entry.id} className={outgoing ? 'fleet-damage-dealt' : 'fleet-damage-taken'} title={detail} aria-label={detail}>
        <span className="fleet-log-weapon">{entry.weapon}</span>
        <span className="fleet-log-target">{otherShip}</span>
        <strong>{outgoing ? '+' : '−'}{amount}</strong>
      </li>;
    })}</ol>}
  </section>;
}
