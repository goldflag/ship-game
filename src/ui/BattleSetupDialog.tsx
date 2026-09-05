import { useEffect, useRef } from 'react';
import { shipPresets } from '../ships/presets';
import { BATTLE_SPAWN_DISTANCE, MAX_TEAM_SHIPS, type BattleSetup } from '../simulation/battle';
import { Icon } from './Icons';
import './BattleSetupDialog.css';

const ships = Object.values(shipPresets);
interface Props {
  setup: BattleSetup;
  onChange(setup: BattleSetup): void;
  onLaunch(): void;
  onClose(): void;
  loading: boolean;
  error: string;
}

/** Fleet harbor extension: paired rosters, a protected player slot, one launch command. */
export function BattleSetupDialog({ setup, onChange, onLaunch, onClose, loading, error }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const shipSelect = (id: string, label: string, change: (value: string) => void) => <label className="battle-ship-select">
    <span>{label}</span><select value={id} onChange={event => change(event.target.value)}>
      {ships.map(ship => <option key={ship.id} value={ship.id}>{ship.name}</option>)}
    </select>
  </label>;
  const bots = (team: 'friendlyBots' | 'enemies') => setup[team].map((id, index) => <li key={`${team}-${index}`}>
    <img src={`/models/${id}-thumbnail.png`} width="120" height="36" alt=""/>
    {shipSelect(id, `${team === 'enemies' ? 'Enemy' : 'Friendly'} bot ${index + 1}`, value => onChange({ ...setup, [team]: setup[team].map((ship, i) => i === index ? value : ship) }))}
    <button className="icon-button" aria-label={`Remove ${team === 'enemies' ? 'enemy' : 'friendly'} bot ${index + 1}`} onClick={() => onChange({ ...setup, [team]: setup[team].filter((_, i) => i !== index) })}><Icon name="close" size={16}/></button>
  </li>);
  return <dialog ref={dialog} className="battle-setup" aria-labelledby="battle-setup-title" aria-describedby="battle-setup-description" onCancel={event => { event.preventDefault(); if (!loading) onClose(); }}>
    <div className="battle-setup-heading"><h2 id="battle-setup-title">Custom battle</h2><button className="icon-button" aria-label="Close battle setup" disabled={loading} onClick={onClose}><Icon name="close"/></button></div>
    <p id="battle-setup-description">Choose both fleets. You command one ship; bots command the rest.</p>
    <fieldset disabled={loading} className="battle-rosters">
      <legend className="battle-sr-only">Fleet selection</legend>
      <section aria-labelledby="friendly-title">
        <header><h3 id="friendly-title">Friendly team</h3><span>{setup.friendlyBots.length + 1} / {MAX_TEAM_SHIPS} ships</span></header>
        <ol className="battle-roster">
          <li className="battle-player"><img src={`/models/${setup.playerShipId}-thumbnail.png`} width="120" height="36" alt=""/>{shipSelect(setup.playerShipId, 'Your ship · You', value => onChange({ ...setup, playerShipId: value }))}<Icon name="anchor" size={18}/></li>
          {bots('friendlyBots')}
        </ol>
        {!setup.friendlyBots.length && <p className="battle-empty">Sail solo, or add bots to support you.</p>}
        <button className="secondary-button battle-add" disabled={setup.friendlyBots.length >= MAX_TEAM_SHIPS - 1} onClick={() => onChange({ ...setup, friendlyBots: [...setup.friendlyBots, setup.playerShipId] })}><Icon name="plus" size={16}/> Add friendly bot</button>
      </section>
      <section aria-labelledby="enemy-title">
        <header><h3 id="enemy-title">Enemy team</h3><span>{setup.enemies.length} / {MAX_TEAM_SHIPS} ships</span></header>
        <ol className="battle-roster">{bots('enemies')}</ol>
        {!setup.enemies.length && <p className="battle-empty">Add at least one enemy to start a battle.</p>}
        <button className="secondary-button battle-add" disabled={setup.enemies.length >= MAX_TEAM_SHIPS} onClick={() => onChange({ ...setup, enemies: [...setup.enemies, 'bismarck'] })}><Icon name="plus" size={16}/> Add enemy bot</button>
      </section>
    </fieldset>
    <div className="battle-briefing"><Icon name="compass" size={21}/><p><strong>{BATTLE_SPAWN_DISTANCE / 1000} km starting separation</strong><span>Open ocean · Sink the opposing fleet to win.</span></p></div>
    {error && <p className="battle-error" role="alert">{error} Your fleet is kept here; try launching again.</p>}
    <footer><button className="secondary-button" disabled={loading} onClick={onClose}>Back to port</button><button className="primary-button" aria-busy={loading} disabled={loading || !setup.enemies.length} onClick={onLaunch}>{loading ? 'Preparing fleets…' : 'Start battle'}<Icon name="arrow" size={18}/></button></footer>
  </dialog>;
}
