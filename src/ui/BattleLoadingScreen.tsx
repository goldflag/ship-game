import { useEffect, useRef } from 'react';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import { assetUrl } from '../assetUrl';
import { oceanMap, DEFAULT_MAP } from '../maps/catalog';
import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS, formatBattleTime } from '../maps/conditions';
import { shipPreset } from '../ships/presets';
import { botSelection, type BattleSetup } from '../simulation/battle';
import { Icon } from './Icons';
import './BattleLoadingScreen.css';

export interface BattleLoadingState { label: string; progress: number; leaving: boolean; }
interface Props { briefing?: PveBriefing; multiplayer?: boolean; setup: BattleSetup; state: BattleLoadingState; onLeft(): void; }

/** In-game capture of each ocean, sized to fill the viewport without tiling. */
export const backdropUrl = (mapId: string) => assetUrl(`maps/${mapId}-backdrop.webp`);

/** Fleet action extension: the chart of the chosen waters fills the viewport while both fleets come aboard. */
export function BattleLoadingScreen({ setup, state, onLeft, multiplayer, briefing }: Props) {
  const left = useRef(onLeft); left.current = onLeft;
  useEffect(() => {
    if (!state.leaving) return;
    const timer = setTimeout(() => left.current(), 650);
    return () => clearTimeout(timer);
  }, [state.leaving]);
  const map = oceanMap((briefing?.setup.mapId as typeof setup.mapId) ?? setup.mapId ?? DEFAULT_MAP);
  const time = TIME_OF_DAY_PRESETS.find(preset => preset.id === setup.timeOfDay);
  const weather = WEATHER_PRESETS.find(preset => preset.id === setup.weather);
  const player = shipPreset(setup.playerShipId);
  const friendly = briefing ? briefing.setup.ships.map(s => s.presetId) : [setup.playerShipId, ...setup.friendlyBots.map(entry => botSelection(entry).shipId)];
  const percent = Math.round(Math.min(state.progress, 1) * 100);
  const roster = (ids: string[], team: 'Friendly' | 'Enemy') => <ol className="battle-loading-roster" aria-label={`${team} fleet`}>
    {ids.map((id, index) => <li key={`${team}-${index}`} className={!briefing && team === 'Friendly' && index === 0 ? 'battle-loading-player' : undefined}>
      <img src={assetUrl(`models/${id}-thumbnail.png`)} width="120" height="36" alt=""/>
      <span>{shipPreset(id).name}</span>
      {!briefing && team === 'Friendly' && index === 0 && <small>You</small>}
    </li>)}
  </ol>;
  return <section className={`loading-screen battle-loading ${state.leaving ? 'battle-loading-leaving' : ''}`} aria-live="polite" aria-busy={!state.leaving}
    onAnimationEnd={event => { if (state.leaving && event.target === event.currentTarget) onLeft(); }}>
    <img className="battle-loading-backdrop" src={backdropUrl(map.id)} alt="" width="1920" height="1080"/>
    <div className="battle-loading-top">
      <div className="loading-brand"><Icon name="anchor" size={36}/><span>FLEET COMMAND</span></div>
      <span className="battle-loading-region">{map.region.toUpperCase()}</span>
    </div>
    <div className="battle-loading-content">
      <p className="battle-loading-kicker">{briefing ? `PvE fleet command · ${briefing.setup.missionRules!.area.radiusM / 1000} km radius · No time limit` : <>{multiplayer ? '1v1 battle' : 'Custom battle'} · {setup.timeHours !== undefined ? formatBattleTime(setup.timeHours) : time && time.id !== 'map' ? time.name : 'Map daylight'} · {setup.cloudCover !== undefined ? `${setup.cloudCover}% clouds` : weather && weather.id !== 'map' ? weather.name : 'Map weather'}{setup.windSpeed !== undefined && ` · ${setup.windSpeed} m/s wind`} · {setup.spawnDistance / 1000} km</>}</p>
      <h1>{map.name.toUpperCase()}</h1>
      <p className="loading-subtitle">{map.description}</p>
      <div className="battle-loading-fleets">
        <div><h2>Friendly fleet <span>{friendly.length}</span></h2>{roster(friendly, 'Friendly')}</div>
        <div className="battle-loading-versus" aria-hidden="true">VS</div>
        <div><h2>Enemy fleet {briefing ? <span>Unknown</span> : <span>{setup.enemies.length}</span>}</h2>{briefing ? <p className="loading-subtitle">Enemy strength scales to your fleet. Establish contact to locate its ships.</p> : roster(setup.enemies.map(entry => botSelection(entry).shipId), 'Enemy')}</div>
      </div>
      <div className="battle-loading-status">
        <span role="status">{state.label}</span><span>{percent}%</span>
      </div>
      <div className="loading-progress" role="progressbar" aria-label="Preparing the battle" aria-valuetext={state.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }}/></div>
    </div>
    <div className="loading-bottom"><span>{multiplayer ? 'MULTIPLAYER' : 'SINGLEPLAYER'} · {map.name.toUpperCase()}</span><span>{briefing ? 'FLEET COMMAND · CAPTAINS AT THE HELM' : `${player.name.toUpperCase()} / ${player.configuration.match(/19\d{2}/)?.[0] ?? ''}`}</span></div>
  </section>;
}
