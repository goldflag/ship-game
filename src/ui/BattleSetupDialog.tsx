import { assetUrl } from '../assetUrl';
import { OCEAN_MAPS, oceanMap, DEFAULT_MAP, mapIslands } from '../maps/catalog';
import { battleEnvironment, formatBattleTime } from '../maps/conditions';
import { useEffect, useRef, useState } from 'react';
import { shipPresets } from '../ships/presets';
import { botSelection, MIN_BATTLE_SPAWN_DISTANCE, MAX_BATTLE_SPAWN_DISTANCE, MAX_TEAM_SHIPS, setupSpawns, validateSpawns, type BattleSetup } from '../simulation/battle';
import { SHIP_AI_LEVELS, type ShipAiLevel } from '../simulation/aiLevels';
import { Icon } from './Icons';
import { backdropUrl } from './BattleLoadingScreen';
import { SpawnPlanner } from './SpawnPlanner';
import './BattleSetupDialog.css';

const ships = Object.values(shipPresets);
const shipName = (id: string) => ships.find(ship => ship.id === id)?.name ?? id;
type Team = 'friendlyBots' | 'enemies';
const teamLabel = (team: Team) => team === 'enemies' ? 'Enemy' : 'Friendly';
interface Props {
  setup: BattleSetup;
  onChange(setup: BattleSetup): void;
  onLaunch(): void;
  onClose(): void;
  error: string;
}

/** Harbor board: catalog, both rosters and the battle settings share one page, so thirty-ship teams get the full dialog height. */
export function BattleSetupDialog({ setup, onChange, onLaunch, onClose, error }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [filter, setFilter] = useState('');
  const terms = filter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filteredShips = ships.filter(ship => terms.every(term => `${ship.name} ${ship.id}`.toLocaleLowerCase().includes(term)));
  const map = oceanMap(setup.mapId ?? DEFAULT_MAP);
  const environment = battleEnvironment(map, setup.timeOfDay, setup.weather, setup);
  const timeHours = setup.timeHours ?? 12;
  const cloudCover = setup.cloudCover ?? Math.round(environment.sky.coverage * 100);
  const windSpeed = setup.windSpeed ?? environment.waves.windSpeed;
  // Warm the loading screen's backdrop so it is on screen the moment the battle starts loading.
  useEffect(() => { new Image().src = backdropUrl(map.id); }, [map.id]);
  let placementError = '';
  try { validateSpawns(setupSpawns(setup), setup.friendlyBots.length + 1, setup.enemies.length, mapIslands(map.id, setup.spawnDistance, Math.max(setup.friendlyBots.length + 1, setup.enemies.length))); }
  catch (error) { placementError = (error as Error).message; }
  const addShip = (team: Team, id: string) => {
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
  const removeShip = (team: Team, index: number) => {
    const side = team === 'friendlyBots' ? 'friendly' : 'enemy';
    const slot = index + (team === 'friendlyBots' ? 1 : 0);
    onChange({ ...setup, [team]: setup[team].filter((_, i) => i !== index),
      spawns: setup.spawns ? { ...setup.spawns, [side]: setup.spawns[side].filter((_, i) => i !== slot) } : undefined });
  };
  const teamFull = (team: Team) => setup[team].length >= MAX_TEAM_SHIPS - (team === 'friendlyBots' ? 1 : 0);
  const bots = (team: Team) => setup[team].map((entry, index) => {
    const { shipId: id, aiLevel } = botSelection(entry);
    const controlId = `battle-ai-${team}-${index}`;
    const description = SHIP_AI_LEVELS.find(level => level.id === aiLevel)!.description;
    const who = `${shipName(id)}, ${teamLabel(team).toLocaleLowerCase()} bot ${index + 1}`;
    return <li key={`${team}-${index}`}>
      <img src={assetUrl(`models/${id}-thumbnail.png`)} width="120" height="36" alt=""/>
      <span className="battle-roster-name"><span>{shipName(id)}</span><small>{teamLabel(team)} bot {index + 1}</small></span>
      <select id={controlId} className="battle-roster-ai" aria-label={`AI level for ${who}`} title={description} value={aiLevel} aria-describedby={`${controlId}-description`} onChange={event => onChange({ ...setup,
        [team]: setup[team].map((selection, i) => i === index ? { shipId: id, aiLevel: event.target.value as ShipAiLevel } : selection),
      })}>
        {SHIP_AI_LEVELS.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
      </select>
      <span className="battle-sr-only" id={`${controlId}-description`}>{description}</span>
      <button className="icon-button" title="Remove" aria-label={`Remove ${who}`} onClick={() => removeShip(team, index)}><Icon name="close" size={16}/></button>
    </li>;
  });
  const team = (team: Team) => {
    const count = setup[team].length + (team === 'friendlyBots' ? 1 : 0);
    const full = count >= MAX_TEAM_SHIPS;
    const levels = new Set(setup[team].map(entry => botSelection(entry).aiLevel));
    const shared = levels.size === 1 ? [...levels][0] : '';
    const titleId = team === 'enemies' ? 'enemy-title' : 'friendly-title';
    return <section className="battle-team" aria-labelledby={titleId}>
      <header>
        <h3 id={titleId}>{teamLabel(team)} team</h3>
        <span className={full ? 'battle-team-full' : undefined}>{count} / {MAX_TEAM_SHIPS} ships{full && ' · full'}</span>
        {setup[team].length > 0 && <div className="battle-roster-all">
          <label htmlFor={`battle-ai-all-${team}`}>All bots</label>
          <select id={`battle-ai-all-${team}`} value={shared} title={`Set every ${teamLabel(team).toLocaleLowerCase()} bot to one AI level`} onChange={event => {
            if (event.target.value) onChange({ ...setup, [team]: setup[team].map(entry => ({ shipId: botSelection(entry).shipId, aiLevel: event.target.value as ShipAiLevel })) });
          }}>
            <option value="" disabled>{shared ? 'Set all…' : 'Mixed'}</option>
            {SHIP_AI_LEVELS.map(level => <option key={level.id} value={level.id}>{level.name}</option>)}
          </select>
        </div>}
      </header>
      <ol className="battle-roster">
        {team === 'friendlyBots' && <li className="battle-player"><img src={assetUrl(`models/${setup.playerShipId}-thumbnail.png`)} width="120" height="36" alt=""/><span className="battle-roster-name"><span>{shipName(setup.playerShipId)}</span><small>Your ship · You</small></span><Icon name="anchor" size={18}/></li>}
        {bots(team)}
        {!setup[team].length && <li className="battle-empty">{team === 'friendlyBots' ? 'Sail solo, or add friendly bots from the catalog.' : 'Add at least one enemy from the catalog to start a battle.'}</li>}
      </ol>
    </section>;
  };
  const catalog = (<section className="battle-catalog" aria-labelledby="catalog-title">
      <header><h3 id="catalog-title">Ships</h3><span role="status">{filteredShips.length} / {ships.length} hulls</span></header>
      <div className="battle-catalog-filter">
        <label htmlFor="battle-ship-filter" className="battle-sr-only">Filter ships</label>
        <input id="battle-ship-filter" type="search" placeholder="Search hulls…" value={filter} onChange={event => setFilter(event.target.value)} aria-controls="battle-ship-results" />
        {filter && <button onClick={() => setFilter('')}>Clear</button>}
      </div>
      <ul id="battle-ship-results" className="battle-catalog-list">
        {filteredShips.map(ship => <li key={ship.id} className={ship.id === setup.playerShipId ? 'battle-catalog-commanded' : undefined}>
          <img src={assetUrl(`models/${ship.id}-thumbnail.png`)} width="84" height="28" alt="" loading="lazy"/>
          <strong>{ship.name}</strong>
          <small>{Math.round(ship.hull.length)} m · {Math.round(ship.hull.massKg / 1000).toLocaleString()} t</small>
          <div className="battle-catalog-actions" role="group" aria-label={`Add ${ship.name}`}>
            <button aria-pressed={ship.id === setup.playerShipId} title="Command this ship yourself" onClick={() => onChange({ ...setup, playerShipId: ship.id })}><Icon name="anchor" size={14}/> You</button>
            <button disabled={teamFull('friendlyBots')} title="Add a friendly bot" onClick={() => addShip('friendlyBots', ship.id)}><Icon name="plus" size={14}/> Friendly</button>
            <button disabled={teamFull('enemies')} title="Add an enemy bot" onClick={() => addShip('enemies', ship.id)}><Icon name="plus" size={14}/> Enemy</button>
          </div>
        </li>)}
        {!filteredShips.length && <li className="battle-empty">No ships match “{filter}”. Clear or change the filter.</li>}
      </ul>
    </section>);
  const waters = (<fieldset className="battle-map-picker">
      <legend>Battle waters</legend>
      <div className="battle-map-options">
        {OCEAN_MAPS.map(option => <label key={option.id} className="battle-map-option" title={option.description}>
          <input type="radio" name="ocean-map" value={option.id} checked={map.id === option.id} onChange={() => onChange({ ...setup, mapId: option.id })}/>
          <img src={assetUrl(`maps/${option.id}.webp`)} alt="" width="320" height="180"/>
          <span>{option.name}</span><small>{option.region}</small>
        </label>)}
      </div>
      <p className="battle-map-detail" id="battle-map-description">{map.description}</p>
    </fieldset>);
  const conditions = (<fieldset className="battle-conditions">
      <legend>Conditions</legend>
      <div className="battle-condition-options">
        {[
          { key: 'timeHours', id: 'battle-time', label: 'Time of day', value: timeHours, max: 24, step: 0.25, reading: formatBattleTime(timeHours), ends: ['Midnight', 'Midnight'], description: 'Set the sun and moon position.' },
          { key: 'cloudCover', id: 'battle-cloud-cover', label: 'Cloud cover', value: cloudCover, max: 100, step: 1, reading: `${cloudCover}%`, ends: ['Clear', 'Overcast'], description: 'Set cloud coverage independently of wind.' },
          { key: 'windSpeed', id: 'battle-wind-speed', label: 'Wind speed', value: windSpeed, max: 30, step: 0.5, reading: `${windSpeed} m/s`, ends: ['Calm', '30 m/s'], description: 'Stronger wind raises waves and moves smoke faster.' },
        ].map(control => <div className="battle-condition-slider" key={control.key}>
          <label htmlFor={control.id}>{control.label}</label>
          <output htmlFor={control.id}>{control.reading}</output>
          <input id={control.id} type="range" min={0} max={control.max} step={control.step} value={control.value}
            aria-valuetext={control.reading} aria-describedby={`${control.id}-description`}
            onChange={event => onChange({ ...setup, [control.key]: Number(event.target.value) })}/>
          <div className="battle-slider-scale" aria-hidden="true"><span>{control.ends[0]}</span><span>{control.ends[1]}</span></div>
          <p id={`${control.id}-description`}>{control.description}</p>
        </div>)}
      </div>
    </fieldset>);
  const distance = (<div className="battle-deployment">
      <label htmlFor="battle-spawn-distance">Spawn distance</label>
      <output htmlFor="battle-spawn-distance">{setup.spawnDistance / 1000} km</output>
      <input id="battle-spawn-distance" type="range" min={MIN_BATTLE_SPAWN_DISTANCE} max={MAX_BATTLE_SPAWN_DISTANCE} step={500} value={setup.spawnDistance}
        aria-valuetext={`${setup.spawnDistance / 1000} kilometers`} aria-describedby="battle-spawn-description"
        onChange={event => onChange({ ...setup, spawnDistance: Number(event.target.value), spawns: undefined })}/>
      <div className="battle-distance-limits" aria-hidden="true"><span>{MIN_BATTLE_SPAWN_DISTANCE / 1000} km</span><span>{MAX_BATTLE_SPAWN_DISTANCE / 1000} km</span></div>
      <p id="battle-spawn-description">Distance between the leading ships in each formation. Changing this resets custom positions.</p>
    </div>);
  return <dialog ref={dialog} className="battle-setup" aria-labelledby="battle-setup-title" aria-describedby="battle-setup-description" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="battle-setup-heading"><h2 id="battle-setup-title">Custom battle</h2><button className="icon-button" aria-label="Close battle setup" onClick={onClose}><Icon name="close"/></button></div>
    <p id="battle-setup-description">Pick ships from the catalog to build both fleets. You command one ship; bots command the rest.</p>
    <div className="battle-board">
      {catalog}
      {team('friendlyBots')}
      {team('enemies')}
      <aside className="battle-settings" aria-label="Battle settings">{waters}{conditions}{distance}<SpawnPlanner setup={setup} onChange={onChange}/></aside>
    </div>
    {placementError && <p className="battle-error" role="alert">{placementError} Move ships or reset positions.</p>}
    {error && <p className="battle-error" role="alert">{error} Your fleet is kept here; try launching again.</p>}
    <footer>
      <div className="battle-briefing"><Icon name="compass" size={21}/><p><strong>{map.name}</strong><span>{formatBattleTime(timeHours)} · {cloudCover}% clouds · {windSpeed} m/s wind</span><span>{setup.friendlyBots.length + 1} v {setup.enemies.length} ships · {setup.spawnDistance / 1000} km apart</span><span>Defeat the opposing fleet to win.</span></p></div>
      <button className="secondary-button" onClick={onClose}>Back to port</button><button className="primary-button" disabled={!setup.enemies.length || !!placementError} onClick={onLaunch}>Start battle<Icon name="arrow" size={18}/></button>
    </footer>
  </dialog>;
}
