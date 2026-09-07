import { oceanMap, DEFAULT_MAP } from '../maps/catalog';
import { shipPreset } from '../ships/presets';
import type { BattleSetup } from '../simulation/battle';
import { Icon } from './Icons';
import './BattleLoadingScreen.css';

export interface BattleLoadingState { label: string; progress: number; leaving: boolean; }
interface Props { setup: BattleSetup; state: BattleLoadingState; onLeft(): void; }

/** In-game capture of each ocean, sized to fill the viewport without tiling. */
export const backdropUrl = (mapId: string) => `/maps/${mapId}-backdrop.webp`;
const SEA_NAMES: Record<NonNullable<BattleSetup['sea']>, string> = { Fair: 'Fair seas', Atlantic: 'Moderate seas', Heavy: 'Heavy seas' };

/** Fleet action extension: the chart of the chosen waters fills the viewport while both fleets come aboard. */
export function BattleLoadingScreen({ setup, state, onLeft }: Props) {
  const map = oceanMap(setup.mapId ?? DEFAULT_MAP);
  const player = shipPreset(setup.playerShipId);
  const friendly = [setup.playerShipId, ...setup.friendlyBots];
  const percent = Math.round(Math.min(state.progress, 1) * 100);
  const roster = (ids: string[], team: 'Friendly' | 'Enemy') => <ol className="battle-loading-roster" aria-label={`${team} fleet`}>
    {ids.map((id, index) => <li key={`${team}-${index}`} className={team === 'Friendly' && index === 0 ? 'battle-loading-player' : undefined}>
      <img src={`/models/${id}-thumbnail.png`} width="120" height="36" alt=""/>
      <span>{shipPreset(id).name}</span>
      {team === 'Friendly' && index === 0 && <small>You</small>}
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
      <p className="battle-loading-kicker">Custom battle · {SEA_NAMES[setup.sea ?? 'Atlantic']} · {setup.spawnDistance / 1000} km</p>
      <h1>{map.name.toUpperCase()}</h1>
      <p className="loading-subtitle">{map.description}</p>
      <div className="battle-loading-fleets">
        <div><h2>Friendly fleet <span>{friendly.length}</span></h2>{roster(friendly, 'Friendly')}</div>
        <div className="battle-loading-versus" aria-hidden="true">VS</div>
        <div><h2>Enemy fleet <span>{setup.enemies.length}</span></h2>{roster(setup.enemies, 'Enemy')}</div>
      </div>
      <div className="battle-loading-status">
        <span role="status">{state.label}</span><span>{percent}%</span>
      </div>
      <div className="loading-progress" role="progressbar" aria-label="Preparing the battle" aria-valuetext={state.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }}/></div>
    </div>
    <div className="loading-bottom"><span>SINGLEPLAYER · {map.name.toUpperCase()}</span><span>{player.name.toUpperCase()} / {player.configuration.match(/19\d{2}/)?.[0]}</span></div>
  </section>;
}
