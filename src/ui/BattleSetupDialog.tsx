import { assetUrl } from '../assetUrl';
import { OCEAN_MAPS, oceanMap, DEFAULT_MAP } from '../maps/catalog';
import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '../maps/conditions';
import { useEffect, useRef, useState } from 'react';
import { shipPresets } from '../ships/presets';
import { botSelection, MIN_BATTLE_SPAWN_DISTANCE, MAX_BATTLE_SPAWN_DISTANCE, MAX_TEAM_SHIPS, type BattleSetup } from '../simulation/battle';
import { SHIP_AI_LEVELS, type ShipAiLevel } from '../simulation/aiLevels';
import { Icon } from './Icons';
import { backdropUrl } from './BattleLoadingScreen';
import './BattleSetupDialog.css';
import { SpawnPlanner } from './SpawnPlanner';
import { setupSpawns, validateSpawns } from '../simulation/battle';
import { mapIslands } from '../maps/catalog';

const ships = Object.values(shipPresets);
const shipName = (id: string) => ships.find(ship => ship.id === id)?.name ?? id;
interface Props {
  setup: BattleSetup;
  onChange(setup: BattleSetup): void;
  onLaunch(): void;
  onClose(): void;
  error: string;
}

/** Fleet harbor extension: a ship catalog feeds two rosters with one click per hull; the player slot stays protected. */
export function BattleSetupDialog({ setup, onChange, onLaunch, onClose, error }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [filter, setFilter] = useState('');
  const terms = filter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filteredShips = ships.filter(ship => terms.every(term => `${ship.name} ${ship.id}`.toLocaleLowerCase().includes(term)));
  const map = oceanMap(setup.mapId ?? DEFAULT_MAP);
  const time = TIME_OF_DAY_PRESETS.find(preset => preset.id === (setup.timeOfDay ?? 'map'))!;
  const weather = WEATHER_PRESETS.find(preset => preset.id === (setup.weather ?? 'map'))!;
  // Warm the loading screen's backdrop so it is on screen the moment the battle starts loading.
  useEffect(() => { new Image().src = backdropUrl(map.id); }, [map.id]);
  let placementError = '';
  try { validateSpawns(setupSpawns(setup), setup.friendlyBots.length + 1, setup.enemies.length, mapIslands(map.id, setup.spawnDistance, Math.max(setup.friendlyBots.length + 1, setup.enemies.length))); }
  catch (error) { placementError = (error as Error).message; }
  const addShip = (team: 'friendlyBots' | 'enemies', id: string) => {
    const next = { ...setup, [team]: [...setup[team], id] };
    if (setup.spawns) {
      const side = team === 'friendlyBots' ? 'friendly' : 'enemy';
      const poses = { friendly: [...setup.spawns.friendly], enemy: [...setup.spawns.enemy] };
      const base = setupSpawns({ ...next, spawns: undefined })[side].at(-1)!;
      const land = mapIslands(map.id, setup.spawnDistance, Math.max(next.friendlyBots.length + 1, next.enemies.length));
      for (let i = 0; i < 60; i++) {
        poses[side] = [...setup.spawns[side], { ...base, z: base.z + i * 650 * (side === 'friendly' ? 1 : -1) }];
        try { validateSpawns(poses, next.friendlyBots.length + 1, next.enemies.length, land); break; } catch { /* Try the next open berth. */ }
      }
      next.spawns = poses;
    }
    onChange(next);
  };
  const friendlyFull = setup.friendlyBots.length >= MAX_TEAM_SHIPS - 1;
  const enemyFull = setup.enemies.length >= MAX_TEAM_SHIPS;
  const bots = (team: 'friendlyBots' | 'enemies') => setup[team].map((entry, index) => {
    const { shipId: id, aiLevel } = botSelection(entry);
    const controlId = `battle-ai-${team}-${index}`;
    const description = SHIP_AI_LEVELS.find(level => level.id === aiLevel)!.description;
    return <li key={`${team}-${index}`}>
    <img src={assetUrl(`models/${id}-thumbnail.png`)} width="120" height="36" alt=""/>
    <span className="battle-roster-name"><span>{shipName(id)}</span><small>{team === 'enemies' ? 'Enemy' : 'Friendly'} bot {index + 1}</small></span>
    <button className="icon-button" aria-label={`Remove ${shipName(id)}, ${team === 'enemies' ? 'enemy' : 'friendly'} bot ${index + 1}`} onClick={() => onChange({ ...setup, [team]: setup[team].filter((_, i) => i !== index), spawns: setup.spawns ? { ...setup.spawns, [team === 'friendlyBots' ? 'friendly' : 'enemy']: setup.spawns[team === 'friendlyBots' ? 'friendly' : 'enemy'].filter((_, i) => i !== index + (team === 'friendlyBots' ? 1 : 0)) } : undefined })}><Icon name="close" size={16}/></button>
    <div className="battle-roster-ai">
      <label htmlFor={controlId}>AI level<span className="battle-sr-only"> for {shipName(id)}, {team === 'enemies' ? 'enemy' : 'friendly'} bot {index + 1}</span></label>
      <select id={controlId} value={aiLevel} aria-describedby={`${controlId}-description`} onChange={event => onChange({ ...setup,
        [team]: setup[team].map((selection, i) => i === index ? { shipId: id, aiLevel: event.target.value as ShipAiLevel } : selection),
      })}>
        {SHIP_AI_LEVELS.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
      </select>
      <p id={`${controlId}-description`}>{description}</p>
    </div>
  </li>;
  });
  return <dialog ref={dialog} className="battle-setup" aria-labelledby="battle-setup-title" aria-describedby="battle-setup-description" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="battle-setup-heading"><h2 id="battle-setup-title">Custom battle</h2><button className="icon-button" aria-label="Close battle setup" onClick={onClose}><Icon name="close"/></button></div>
    <p id="battle-setup-description">Pick ships from the catalog to build both fleets. You command one ship; bots command the rest.</p>
    <fieldset className="battle-map-picker">
      <legend>Battle waters</legend>
      <div className="battle-map-options">
        {OCEAN_MAPS.map(option => <label key={option.id} className="battle-map-option">
          <input type="radio" name="ocean-map" value={option.id} checked={map.id === option.id} onChange={() => onChange({ ...setup, mapId: option.id })}/>
          <img src={assetUrl(`maps/${option.id}.webp`)} alt="" width="320" height="180"/>
          <span>{option.name}</span><small>{option.region}</small>
        </label>)}
      </div>
      <p className="battle-map-detail" id="battle-map-description">{map.description}</p>
    </fieldset>
    <fieldset className="battle-conditions">
      <legend>Battle conditions</legend>
      <div className="battle-condition-options">
        <div><label htmlFor="battle-time">Time of day</label>
          <select id="battle-time" value={time.id} aria-describedby="battle-time-description" onChange={event => onChange({ ...setup, timeOfDay: event.target.value as BattleSetup['timeOfDay'] })}>
            {TIME_OF_DAY_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select><p id="battle-time-description">{time.description}</p>
        </div>
        <div><label htmlFor="battle-weather">Weather</label>
          <select id="battle-weather" value={weather.id} aria-describedby="battle-weather-description" onChange={event => onChange({ ...setup, weather: event.target.value as BattleSetup['weather'] })}>
            {WEATHER_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select><p id="battle-weather-description">{weather.description}</p>
        </div>
      </div>
    </fieldset>
    <fieldset className="battle-builder">
      <legend className="battle-sr-only">Fleet selection</legend>
      <section className="battle-catalog" aria-labelledby="catalog-title">
        <header><h3 id="catalog-title">Ships</h3><span role="status">{filteredShips.length} / {ships.length} hulls</span></header>
        <div className="battle-catalog-filter">
          <label htmlFor="battle-ship-filter">Filter ships</label>
          <div>
            <input id="battle-ship-filter" type="search" placeholder="Search ship names…" value={filter} onChange={event => setFilter(event.target.value)} aria-controls="battle-ship-results" />
            {filter && <button onClick={() => setFilter('')}>Clear</button>}
          </div>
        </div>
        <ul id="battle-ship-results" className="battle-catalog-list">
          {filteredShips.map(ship => <li key={ship.id} className={ship.id === setup.playerShipId ? 'battle-catalog-commanded' : undefined}>
            <img src={assetUrl(`models/${ship.id}-thumbnail.png`)} width="80" height="32" alt="" loading="lazy"/>
            <strong>{ship.name}</strong>
            <small>{Math.round(ship.hull.length)} m · {Math.round(ship.hull.massKg / 1000).toLocaleString()} t</small>
            <div className="battle-catalog-actions" role="group" aria-label={`Add ${ship.name}`}>
              <button aria-pressed={ship.id === setup.playerShipId} title="Command this ship yourself" onClick={() => onChange({ ...setup, playerShipId: ship.id })}><Icon name="anchor" size={14}/> You</button>
              <button disabled={friendlyFull} title="Add a friendly bot" onClick={() => addShip('friendlyBots', ship.id)}><Icon name="plus" size={14}/> Friendly</button>
              <button disabled={enemyFull} title="Add an enemy bot" onClick={() => addShip('enemies', ship.id)}><Icon name="plus" size={14}/> Enemy</button>
            </div>
          </li>)}
        </ul>
        {!filteredShips.length && <p className="battle-empty">No ships match “{filter}”. Clear or change the filter.</p>}
      </section>
      <div className="battle-rosters">
        <section aria-labelledby="friendly-title">
          <header><h3 id="friendly-title">Friendly team</h3><span>{setup.friendlyBots.length + 1} / {MAX_TEAM_SHIPS} ships</span></header>
          <ol className="battle-roster">
            <li className="battle-player"><img src={assetUrl(`models/${setup.playerShipId}-thumbnail.png`)} width="120" height="36" alt=""/><span className="battle-roster-name"><span>{shipName(setup.playerShipId)}</span><small>Your ship · You</small></span><Icon name="anchor" size={18}/></li>
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
      <input id="battle-spawn-distance" type="range" min={MIN_BATTLE_SPAWN_DISTANCE} max={MAX_BATTLE_SPAWN_DISTANCE} step={500} value={setup.spawnDistance}
        aria-valuetext={`${setup.spawnDistance / 1000} kilometers`} aria-describedby="battle-spawn-description"
        onChange={event => onChange({ ...setup, spawnDistance: Number(event.target.value), spawns: undefined })}/>
      <div className="battle-distance-limits" aria-hidden="true"><span>{MIN_BATTLE_SPAWN_DISTANCE / 1000} km</span><span>{MAX_BATTLE_SPAWN_DISTANCE / 1000} km</span></div>
      <p id="battle-spawn-description">Distance between the leading ships in each preset. Changing this resets custom positions.</p>
    </div>
    <SpawnPlanner setup={setup} onChange={onChange}/>
    {placementError && <p className="battle-error" role="alert">{placementError} Move ships or reset positions.</p>}
    <div className="battle-briefing"><Icon name="compass" size={21}/><p><strong>{map.name}</strong><span>{time.id === 'map' ? 'Map daylight' : time.name} · {weather.id === 'map' ? 'Map weather' : weather.name}</span><span>Defeat the opposing fleet to win.</span></p></div>
    {error && <p className="battle-error" role="alert">{error} Your fleet is kept here; try launching again.</p>}
    <footer><button className="secondary-button" onClick={onClose}>Back to port</button><button className="primary-button" disabled={!setup.enemies.length || !!placementError} onClick={onLaunch}>Start battle<Icon name="arrow" size={18}/></button></footer>
  </dialog>;
}
