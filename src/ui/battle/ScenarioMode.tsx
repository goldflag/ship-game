import { useState } from 'react';
import { oceanMap } from '../../maps/catalog';
import { WEATHER_PRESETS } from '../../maps/conditions';
import type { PlacedTerrain } from '../../maps/heightfield';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import type { ScenarioRequest } from '../../multiplayer/generated/ScenarioRequest';
import { resolveShip, shipTitle } from '../../ships/localShips';
import { Button } from '../components';
import { missionSeed } from './PveMode';
import { RailBlock } from './BattleRail';
import { DeploymentChart, type ChartSelection } from './DeploymentChart';
import { fitRadius, type Deployment } from './deploymentModel';
import { openingText, SCENARIOS, scenarioInfo, scenarioOrders, scenarioShipTitle, type ScenarioInfo } from './scenarios';
import './ScenarioMode.css';

export const defaultScenarioRequest = (): ScenarioRequest => ({ version: 1, scenarioId: SCENARIOS[0].id, seed: missionSeed(), difficulty: 'normal' });
const titleOf = (presetId: string) => shipTitle(resolveShip(presetId));
/** "BALTIMORE ×2 · GLEAVES ×2": the classes that stand in for a group's ships. */
const classCounts = (presetIds: string[]) => [...new Set(presetIds)].map(id => {
  const count = presetIds.filter(other => other === id).length, name = resolveShip(id).name;
  // "Hsienyang (Gleaves class)" is a Gleaves; "USS Baltimore" a Baltimore.
  const label = name.match(/\(([^)]+) class\)/)?.[1] ?? name.replace(/^(USS|HMS|HMAS|IJN|KMS)\s+/, '');
  return `${label.toUpperCase()}${count > 1 ? ` ×${count}` : ''}`;
}).join(' · ');
const weatherName = (id?: string) => WEATHER_PRESETS.find(preset => preset.id === id)?.name ?? id ?? '';

/** The owner's dispositions as the scenario sets them: every ship where history put it, nothing to move. */
export function scenarioDeployment(briefing: PveBriefing, terrain: PlacedTerrain | undefined): Deployment {
  const groups = briefing.groups.map(group => ({ id: group.id, name: group.name, side: 'friendly' as const, formation: group.formation ?? 'column' as const }));
  const units = briefing.setup.ships.flatMap(ship => {
    const unit = briefing.assignments.find(entry => entry.id === ship.id);
    const name = scenarioInfo(briefing.scenario?.id)?.shipNames[ship.id] ?? titleOf(ship.presetId);
    return unit && ship.spawn ? [{ id: ship.id, presetId: ship.presetId, name, side: 'friendly' as const, groupId: unit.groupId, spawn: ship.spawn }] : [];
  });
  return { units, groups, terrain, bearing: oceanMap(briefing.setup.mapId as Parameters<typeof oceanMap>[0]).bearing,
    bounds: { kind: 'circle', radius: briefing.setup.missionRules!.area.radiusM }, focus: { x: 0, z: 0 }, labels: {}, error: '' };
}

interface BoardProps {
  request: ScenarioRequest;
  onChange(request: ScenarioRequest): void;
  briefing?: PveBriefing;
  terrain?: PlacedTerrain;
  preparing: boolean;
  error: string;
  onRetry(): void;
  disabled: boolean;
}
/** Actions and the chosen one's briefing on the left, the owner's dispositions on the chart beside it. */
export function ScenarioBoard({ request, onChange, briefing, terrain, preparing, error, onRetry, disabled }: BoardProps) {
  const scenario = scenarioInfo(request.scenarioId) ?? SCENARIOS[0];
  const [selection, setSelection] = useState<ChartSelection>();
  const [hover, setHover] = useState<ChartSelection>();
  const deployment = briefing?.scenario?.id === scenario.id ? scenarioDeployment(briefing, terrain) : undefined;
  return <>
    <section className="scenario-side" aria-label="Actions">
      <h3 className="scenario-kicker">Actions</h3>
      <ul className="scenario-list" role="radiogroup" aria-label="Action">
        {SCENARIOS.map(entry => <li key={entry.id}>
          <button type="button" role="radio" aria-checked={entry.id === scenario.id} disabled={disabled} onClick={() => onChange({ ...request, scenarioId: entry.id })}>
            <strong>{entry.title}</strong>
            <span>{entry.date} · {oceanMap(entry.mapId).name}</span>
          </button>
        </li>)}
      </ul>
      <Brief scenario={scenario} selection={selection} onSelect={setSelection} onHover={setHover} />
    </section>
    <div className="scenario-chart deploy-chart-wrap">
      {deployment ? <>
        <DeploymentChart deployment={deployment} fit={fitRadius(deployment)} onChange={() => {}} onCommit={() => {}}
          selection={hover ?? selection} onSelect={setSelection} hover={hover} onHover={setHover} scope="group" onScopeChange={() => {}} disabled />
        <p className="scenario-chart-note">Your ships at the start. The raid's approach is unknown.</p>
      </> : <div className="battle-preparing" role="status">
        {error ? <><p>{error}</p><Button onClick={onRetry}>Retry</Button></> : preparing ? 'Plotting the dispositions…' : ''}
      </div>}
    </div>
  </>;
}

function Brief({ scenario, selection, onSelect, onHover }: { scenario: ScenarioInfo; selection: ChartSelection; onSelect(selection: ChartSelection): void; onHover(hover: ChartSelection): void }) {
  return <article className="scenario-brief">
    <header>
      <h2>{scenario.title}</h2>
      <p>{scenario.date} · {scenario.place}</p>
    </header>
    {scenario.situation.map(line => <p key={line}>{line}</p>)}
    <h3>Orders</h3>
    <ul className="scenario-orders">{scenarioOrders(scenario).map(line => <li key={line}>{line}</li>)}</ul>
    <h3>Your forces</h3>
    <ul className="scenario-forces">
      {scenario.content.groups.map(group => {
        const picked = selection?.kind === 'group' && selection.id === group.id;
        return <li key={group.id}>
          <button type="button" aria-pressed={picked} onClick={() => onSelect(picked ? undefined : { kind: 'group', id: group.id })}
            onPointerEnter={() => onHover({ kind: 'group', id: group.id })} onPointerLeave={() => onHover(undefined)}>
            <span className="scenario-group"><strong>{group.name}</strong><small>{openingText(group.orders)}</small></span>
            <span className="scenario-ships">{group.ships.map(ship => scenarioShipTitle(scenario, ship.id) ?? titleOf(ship.presetId)).join(' · ')}</span>
            <span className="scenario-classes">{classCounts(group.ships.map(ship => ship.presetId))}</span>
          </button>
        </li>;
      })}
    </ul>
    <p className="scenario-note">{scenario.note}</p>
  </article>;
}

/** Conditions drawn for this night, difficulty, and the seed that fixes the raid. */
export function ScenarioRail({ request, onChange, briefing, disabled }: { request: ScenarioRequest; onChange(request: ScenarioRequest): void; briefing?: PveBriefing; disabled?: boolean }) {
  const scenario = scenarioInfo(request.scenarioId) ?? SCENARIOS[0];
  const weather = briefing?.scenario?.id === scenario.id ? briefing.scenario.weather : undefined;
  return <>
    <RailBlock title="Conditions" aside={oceanMap(scenario.mapId).name}>
      <dl className="scenario-conditions">
        <div><dt>Time</dt><dd>Night · {Math.round(scenario.content.mission.durationSeconds / 60)} min to dawn</dd></div>
        <div><dt>Weather</dt><dd>{weather ? weatherName(weather) : '…'}</dd></div>
        <div><dt>Lookouts</dt><dd>About 5 km for a cruiser<small>Gun flashes and fires carry 14 km</small></dd></div>
      </dl>
      <div className="rail-field">
        <span id="scenario-difficulty-label">Difficulty</span>
        <div className="battle-segmented" role="group" aria-labelledby="scenario-difficulty-label">
          {(['easy', 'normal', 'hard'] as const).map(level => <button type="button" key={level} aria-pressed={request.difficulty === level} disabled={disabled}
            onClick={() => onChange({ ...request, difficulty: level })}>{level[0].toUpperCase() + level.slice(1)}</button>)}
        </div>
        <p className="rail-note">Sets the raid's strength and its crews' skill.</p>
      </div>
    </RailBlock>
    <RailBlock title="Night">
      <div className="rail-row">
        <output className="rail-seed" aria-label="Scenario seed">{request.seed.toString(16).toUpperCase().padStart(8, '0')}</output>
        <Button disabled={disabled} onClick={() => onChange({ ...request, seed: missionSeed() })}>Another night</Button>
      </div>
      <p className="rail-note">The same seed brings the same raid: its route, its resolve and the weather.</p>
    </RailBlock>
  </>;
}

export function scenarioBrief(request: ScenarioRequest, briefing?: PveBriefing): string[] {
  const scenario = scenarioInfo(request.scenarioId) ?? SCENARIOS[0];
  const ships = scenario.content.groups.reduce((n, group) => n + group.ships.length, 0);
  const weather = briefing?.scenario?.id === scenario.id ? weatherName(briefing.scenario.weather) : undefined;
  return [
    `${scenario.title} · ${scenario.date}`,
    `Night${weather ? ` · ${weather}` : ''} · ${request.difficulty[0].toUpperCase()}${request.difficulty.slice(1)}`,
    `${ships} ships in ${scenario.content.groups.length} groups · ${scenario.summary}`,
  ];
}
