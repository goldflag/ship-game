import { useEffect, useRef } from 'react';
import { shipPresets } from '../ships/presets';
import { MIN_BATTLE_SPAWN_DISTANCE, MAX_BATTLE_SPAWN_DISTANCE, MAX_TEAM_SHIPS, type BattleSetup } from '../simulation/battle';
import { Icon } from './Icons';
import './BattleSetupDialog.css';

const ships = Object.values(shipPresets);
const shipName = (id: string) => ships.find(ship => ship.id === id)?.name ?? id;
interface Props {
  setup: BattleSetup;
  onChange(setup: BattleSetup): void;
  onLaunch(): void;
  onClose(): void;
  loading: boolean;
  error: string;
}

/** Fleet harbor extension: a ship catalog feeds two rosters with one click per hull; the player slot stays protected. */
export function BattleSetupDialog({ setup, onChange, onLaunch, onClose, loading, error }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const friendlyFull = setup.friendlyBots.length >= MAX_TEAM_SHIPS - 1;
  const enemyFull = setup.enemies.length >= MAX_TEAM_SHIPS;
  const bots = (team: 'friendlyBots' | 'enemies') => setup[team].map((id, index) => <li key={`${team}-${index}`}>
    <img src={`/models/${id}-thumbnail.png`} width="120" height="36" alt=""/>
    <span className="battle-roster-name"><span>{shipName(id)}</span><small>{team === 'enemies' ? 'Enemy' : 'Friendly'} bot {index + 1}</small></span>
    <button className="icon-button" aria-label={`Remove ${shipName(id)}, ${team === 'enemies' ? 'enemy' : 'friendly'} bot ${index + 1}`} onClick={() => onChange({ ...setup, [team]: setup[team].filter((_, i) => i !== index) })}><Icon name="close" size={16}/></button>
  </li>);
  return <dialog ref={dialog} className="battle-setup" aria-labelledby="battle-setup-title" aria-describedby="battle-setup-description" onCancel={event => { event.preventDefault(); if (!loading) onClose(); }}>
    <div className="battle-setup-heading"><h2 id="battle-setup-title">Custom battle</h2><button className="icon-button" aria-label="Close battle setup" disabled={loading} onClick={onClose}><Icon name="close"/></button></div>
    <p id="battle-setup-description">Pick ships from the catalog to build both fleets. You command one ship; bots command the rest.</p>
    <fieldset disabled={loading} className="battle-builder">
      <legend className="battle-sr-only">Fleet selection</legend>
      <section className="battle-catalog" aria-labelledby="catalog-title">
        <header><h3 id="catalog-title">Ships</h3><span>{ships.length} hulls</span></header>
        <ul className="battle-catalog-list">
          {ships.map(ship => <li key={ship.id} className={ship.id === setup.playerShipId ? 'battle-catalog-commanded' : undefined}>
            <img src={`/models/${ship.id}-thumbnail.png`} width="240" height="72" alt=""/>
            <strong>{ship.name}</strong>
            <small>{Math.round(ship.hull.length)} m · {Math.round(ship.hull.massKg / 1000).toLocaleString()} t</small>
            <div className="battle-catalog-actions" role="group" aria-label={`Add ${ship.name}`}>
              <button aria-pressed={ship.id === setup.playerShipId} title="Command this ship yourself" onClick={() => onChange({ ...setup, playerShipId: ship.id })}><Icon name="anchor" size={14}/> You</button>
              <button disabled={friendlyFull} title="Add a friendly bot" onClick={() => onChange({ ...setup, friendlyBots: [...setup.friendlyBots, ship.id] })}><Icon name="plus" size={14}/> Friendly</button>
              <button disabled={enemyFull} title="Add an enemy bot" onClick={() => onChange({ ...setup, enemies: [...setup.enemies, ship.id] })}><Icon name="plus" size={14}/> Enemy</button>
            </div>
          </li>)}
        </ul>
      </section>
      <div className="battle-rosters">
        <section aria-labelledby="friendly-title">
          <header><h3 id="friendly-title">Friendly team</h3><span>{setup.friendlyBots.length + 1} / {MAX_TEAM_SHIPS} ships</span></header>
          <ol className="battle-roster">
            <li className="battle-player"><img src={`/models/${setup.playerShipId}-thumbnail.png`} width="120" height="36" alt=""/><span className="battle-roster-name"><span>{shipName(setup.playerShipId)}</span><small>Your ship · You</small></span><Icon name="anchor" size={18}/></li>
            {bots('friendlyBots')}
          </ol>
          {!setup.friendlyBots.length && <p className="battle-empty">Sail solo, or add friendly bots from the catalog.</p>}
          {friendlyFull && <p className="battle-empty">Friendly team is full.</p>}
        </section>
        <section aria-labelledby="enemy-title">
          <header><h3 id="enemy-title">Enemy team</h3><span>{setup.enemies.length} / {MAX_TEAM_SHIPS} ships</span></header>
          <ol className="battle-roster">{bots('enemies')}</ol>
          {!setup.enemies.length && <p className="battle-empty">Add at least one enemy from the catalog to start a battle.</p>}
          {enemyFull && <p className="battle-empty">Enemy team is full.</p>}
        </section>
      </div>
    </fieldset>
    <div className="battle-deployment">
      <label htmlFor="battle-spawn-distance">Spawn distance</label>
      <output htmlFor="battle-spawn-distance">{setup.spawnDistance / 1000} km</output>
      <input id="battle-spawn-distance" type="range" min={MIN_BATTLE_SPAWN_DISTANCE} max={MAX_BATTLE_SPAWN_DISTANCE} step={500} value={setup.spawnDistance} disabled={loading}
        aria-valuetext={`${setup.spawnDistance / 1000} kilometers`} aria-describedby="battle-spawn-description"
        onChange={event => onChange({ ...setup, spawnDistance: Number(event.target.value) })}/>
      <div className="battle-distance-limits" aria-hidden="true"><span>{MIN_BATTLE_SPAWN_DISTANCE / 1000} km</span><span>{MAX_BATTLE_SPAWN_DISTANCE / 1000} km</span></div>
      <p id="battle-spawn-description">Distance between the two formations. Both teams start facing each other.</p>
    </div>
    <div className="battle-briefing"><Icon name="compass" size={21}/><p><strong>Open ocean</strong><span>Sink the opposing fleet to win.</span></p></div>
    {error && <p className="battle-error" role="alert">{error} Your fleet is kept here; try launching again.</p>}
    <footer><button className="secondary-button" disabled={loading} onClick={onClose}>Back to port</button><button className="primary-button" aria-busy={loading} disabled={loading || !setup.enemies.length} onClick={onLaunch}>{loading ? 'Preparing fleets…' : 'Start battle'}<Icon name="arrow" size={18}/></button></footer>
  </dialog>;
}
