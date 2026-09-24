import type { DragEvent } from 'react';
import { OCEAN_MAPS, oceanMap, DEFAULT_MAP } from '../../maps/catalog';
import { battleEnvironment, formatBattleTime } from '../../maps/conditions';
import { SHIP_AI_LEVELS, type ShipAiLevel } from '../../game/session/aiLevels';
import { Select, SelectOption } from '../components';
import { Icon } from '../Icons';
import { MapTiles, RailBlock, RailSlider } from './BattleRail';
import { FleetLane } from './FleetLane';
import { customTeamFull, customTransferShip, customUnitId, parseCustomUnit, removeCustomBot, transferCustomShip, type FleetTransfer } from './fleetTransfer';
import { openFleet, type FleetAccess, type FleetRule } from './fleetAccess';
import { ShipChip } from './ShipCard';
import type { Team } from '../../game/session/elements';
import {
  botSelection,
  MAX_BATTLE_SPAWN_DISTANCE,
  MAX_TEAM_SHIPS,
  MIN_BATTLE_SPAWN_DISTANCE,
  type BattleSetup,
  type SpawnFormation,
} from '../../game/session/battleSetup';

const teamKey = (team: Team) => (team === 'friendly' ? 'friendlyBots' : 'enemies');
const teamLabel = (team: Team) => (team === 'enemy' ? 'Enemy' : 'Friendly');
interface LanesProps {
  setup: BattleSetup;
  onChange(setup: BattleSetup): void;
  transfer?: FleetTransfer;
  onTransfer(transfer?: FleetTransfer): void;
  onError(message: string): void;
  disabled?: boolean;
  /** Which ships the command berth and the friendly lane take; the enemy lane takes any. */
  rule?: FleetRule;
}
/** Friendly and enemy lanes. The friendly lane's first berth is the ship you command. */
export function CustomLanes({ setup, onChange, transfer, onTransfer, onError, disabled, rule = openFleet }: LanesProps) {
  const place = (target: Team | 'player') => {
    if (!transfer) return;
    const result = transferCustomShip(setup, transfer, target, rule);
    if (result.error) onError(result.error);
    else onChange(result.setup);
    onTransfer(undefined);
  };
  const dragUnit = (event: DragEvent<HTMLElement>, id: string) => {
    event.stopPropagation();
    if (disabled) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    onTransfer({ kind: 'unit', id });
  };
  const setAll = (team: Team, level: string) =>
    onChange({
      ...setup,
      [teamKey(team)]: setup[teamKey(team)].map((entry) => ({ shipId: botSelection(entry).shipId, aiLevel: level as ShipAiLevel })),
    });
  const bots = (team: Team) =>
    setup[teamKey(team)].map((entry, index) => {
      const { shipId, aiLevel } = botSelection(entry),
        id = customUnitId(team, index + (team === 'friendly' ? 1 : 0));
      const access: FleetAccess = team === 'friendly' ? rule(shipId) : 'open';
      const who = `${teamLabel(team).toLocaleLowerCase()} bot ${index + 1}`,
        level = SHIP_AI_LEVELS.find((item) => item.id === aiLevel)!;
      return (
        <ShipChip
          key={id}
          presetId={shipId}
          restriction={access === 'open' ? undefined : access}
          picked={transfer?.kind === 'unit' && transfer.id === id}
          disabled={disabled}
          draggable
          onDragStart={(event) => dragUnit(event, id)}
          onDragEnd={() => onTransfer(undefined)}
          pickLabel={`Move ${who}, ${level.name}`}
          onPick={() => onTransfer(transfer?.kind === 'unit' && transfer.id === id ? undefined : { kind: 'unit', id })}
          removeLabel={`Remove ${who}`}
          onRemove={() => onChange(removeCustomBot(setup, team, index))}
        >
          <Select
            className="ship-chip-ai"
            aria-label={`AI level for ${who}`}
            title={level.description}
            value={aiLevel}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({
                ...setup,
                [teamKey(team)]: setup[teamKey(team)].map((selection, i) =>
                  i === index ? { shipId, aiLevel: value as ShipAiLevel } : selection,
                ),
              })
            }
          >
            {SHIP_AI_LEVELS.map((item) => (
              <SelectOption key={item.id} value={item.id}>
                {item.name}
              </SelectOption>
            ))}
          </Select>
        </ShipChip>
      );
    });
  const allBots = (team: Team) => {
    const levels = new Set(setup[teamKey(team)].map((entry) => botSelection(entry).aiLevel)),
      shared = levels.size === 1 ? [...levels][0] : '';
    return (
      setup[teamKey(team)].length > 0 && (
        <label className="fleet-lane-all">
          <span>All bots</span>
          <Select
            aria-label={`AI level for every ${teamLabel(team).toLocaleLowerCase()} bot`}
            value={shared}
            disabled={disabled}
            onValueChange={(value) => {
              if (value) setAll(team, value);
            }}
          >
            <SelectOption value="" disabled>
              {shared ? 'Set all…' : 'Mixed'}
            </SelectOption>
            {SHIP_AI_LEVELS.map((item) => (
              <SelectOption key={item.id} value={item.id}>
                {item.name}
              </SelectOption>
            ))}
          </Select>
        </label>
      )
    );
  };
  const count = (team: Team) => {
    const n = setup[teamKey(team)].length + (team === 'friendly' ? 1 : 0);
    return (
      <span className={customTeamFull(setup, team) ? 'is-full' : ''}>
        {n} / {MAX_TEAM_SHIPS} ships{customTeamFull(setup, team) && ' · full'}
      </span>
    );
  };
  const active = !!transfer;
  // The player's own berths refuse a ship research has not opened; a friendly bot may still move within its lane.
  const carried = transfer && customTransferShip(setup, transfer);
  const ownOpen = !carried || rule(carried) === 'open' || (transfer?.kind === 'unit' && parseCustomUnit(transfer.id)?.team === 'friendly');
  const commandAccess = rule(setup.playerShipId);
  return (
    <div className="battle-lanes" aria-label="Fleets">
      <FleetLane
        label="Friendly team"
        tone="friendly"
        title="Friendly"
        count={count('friendly')}
        extra={allBots('friendly')}
        active={active && ownOpen && !customTeamFull(setup, 'friendly')}
        disabled={disabled}
        onPlace={() => place('friendly')}
        hint={
          <>
            Drop a ship here to add a friendly bot.
            <br />
            Drop it on the command berth to take the helm.
          </>
        }
      >
        <p className="lane-slot-label">
          <Icon name="anchor" size={13} /> You command
        </p>
        <ul className="fleet-lane-chips">
          <ShipChip
            presetId={setup.playerShipId}
            commanded
            restriction={commandAccess === 'open' ? undefined : commandAccess}
            className={`command-berth ${active && ownOpen ? 'is-accepting' : ''}`}
            pickLabel={active && ownOpen ? `Take command of ${transfer.id}` : 'Your ship'}
            onPick={active && ownOpen ? () => place('player') : undefined}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <span className="ship-chip-mark" title="Your ship">
              <Icon name="anchor" size={16} />
              <span className="battle-sr-only">Your ship</span>
            </span>
            <span
              className="command-berth-drop"
              aria-hidden="true"
              onDragOver={(event) => {
                if (active && ownOpen && !disabled) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'move';
                  event.currentTarget.parentElement?.classList.add('is-drop-target');
                }
              }}
              onDragLeave={(event) => event.currentTarget.parentElement?.classList.remove('is-drop-target')}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.parentElement?.classList.remove('is-drop-target');
                place('player');
              }}
            />
          </ShipChip>
          {setup.friendlyBots.length > 0 && (
            <li className="lane-slot-label muted" aria-hidden="true">
              Bots
            </li>
          )}
          {bots('friendly')}
        </ul>
      </FleetLane>
      <FleetLane
        label="Enemy team"
        tone="enemy"
        title="Enemy"
        count={count('enemy')}
        extra={allBots('enemy')}
        active={active && !customTeamFull(setup, 'enemy')}
        disabled={disabled}
        onPlace={() => place('enemy')}
        hint={setup.enemies.length ? 'Drop a ship here to add an enemy bot.' : 'Add at least one enemy to start a battle.'}
      >
        <ul className="fleet-lane-chips">{bots('enemy')}</ul>
      </FleetLane>
    </div>
  );
}

/** A map's default wind is the weather's wind scaled by the map, so it can carry float noise (0.65 × 9). */
const roundWind = (speed: number) => Math.round(speed * 10) / 10;
/** Waters, conditions and the opening deployment. */
export function CustomRail({ setup, onChange, disabled }: { setup: BattleSetup; onChange(setup: BattleSetup): void; disabled?: boolean }) {
  const map = oceanMap(setup.mapId ?? DEFAULT_MAP),
    environment = battleEnvironment(map, setup.timeOfDay, setup.weather, setup);
  const timeHours = setup.timeHours ?? 12,
    cloudCover = setup.cloudCover ?? Math.round(environment.sky.coverage * 100),
    windSpeed = setup.windSpeed ?? roundWind(environment.waves.windSpeed);
  return (
    <>
      <RailBlock title="Waters" aside={map.region}>
        <MapTiles name="battle-map" value={map.id} disabled={disabled} onChange={(mapId) => onChange({ ...setup, mapId })} />
        <p className="rail-note">{map.description}</p>
      </RailBlock>
      <RailBlock title="Conditions">
        <RailSlider
          id="battle-time"
          label="Time of day"
          value={timeHours}
          max={24}
          step={0.25}
          reading={formatBattleTime(timeHours)}
          ends={['Midnight', 'Midnight']}
          disabled={disabled}
          onChange={(value) => onChange({ ...setup, timeHours: value })}
        />
        <RailSlider
          id="battle-cloud-cover"
          label="Cloud cover"
          value={cloudCover}
          max={100}
          step={1}
          reading={`${cloudCover}%`}
          ends={['Clear', 'Overcast']}
          disabled={disabled}
          onChange={(value) => onChange({ ...setup, cloudCover: value })}
        />
        <RailSlider
          id="battle-wind-speed"
          label="Wind"
          value={windSpeed}
          max={30}
          step={0.5}
          reading={`${windSpeed} m/s`}
          ends={['Calm', '30 m/s']}
          description="Stronger wind raises waves and moves smoke faster."
          disabled={disabled}
          onChange={(value) => onChange({ ...setup, windSpeed: value })}
        />
      </RailBlock>
      <RailBlock title="Deployment">
        <RailSlider
          id="battle-spawn-distance"
          label="Spawn distance"
          value={setup.spawnDistance}
          min={MIN_BATTLE_SPAWN_DISTANCE}
          max={MAX_BATTLE_SPAWN_DISTANCE}
          step={500}
          reading={`${setup.spawnDistance / 1000} km`}
          ends={[`${MIN_BATTLE_SPAWN_DISTANCE / 1000} km`, `${MAX_BATTLE_SPAWN_DISTANCE / 1000} km`]}
          description="Distance between the leading ships. Changing it rearranges both formations."
          disabled={disabled}
          onChange={(value) => onChange({ ...setup, spawnDistance: value, spawns: undefined })}
        />
        <FormationSelect setup={setup} onChange={onChange} disabled={disabled} />
      </RailBlock>
    </>
  );
}
export function FormationSelect({
  setup,
  onChange,
  disabled,
  compact,
}: {
  setup: BattleSetup;
  onChange(setup: BattleSetup): void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <label className={`rail-field ${compact ? 'is-compact' : ''}`}>
      <span>Formation</span>
      <Select
        aria-label="Formation"
        value={setup.spawns ? 'custom' : (setup.formation ?? 'line')}
        disabled={disabled}
        onValueChange={(value) => onChange({ ...setup, formation: value as SpawnFormation, spawns: undefined })}
      >
        {setup.spawns && (
          <SelectOption value="custom" disabled>
            Custom positions
          </SelectOption>
        )}
        <SelectOption value="line">Line abreast</SelectOption>
        <SelectOption value="column">Column</SelectOption>
        <SelectOption value="wedge">Wedge</SelectOption>
      </Select>
    </label>
  );
}
export function customBrief(setup: BattleSetup): string[] {
  const map = oceanMap(setup.mapId ?? DEFAULT_MAP),
    environment = battleEnvironment(map, setup.timeOfDay, setup.weather, setup);
  const cloud = setup.cloudCover ?? Math.round(environment.sky.coverage * 100),
    wind = setup.windSpeed ?? roundWind(environment.waves.windSpeed);
  return [
    map.name,
    `${formatBattleTime(setup.timeHours ?? 12)} · ${cloud}% clouds · ${wind} m/s wind`,
    `${setup.friendlyBots.length + 1} v ${setup.enemies.length} ships · ${setup.spawnDistance / 1000} km apart`,
  ];
}
export const CUSTOM_MAPS = OCEAN_MAPS;
