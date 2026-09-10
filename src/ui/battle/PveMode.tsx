import type { DragEvent } from 'react';
import { OCEAN_MAPS, type OceanMapId } from '../../maps/catalog';
import { WEATHER_PRESETS } from '../../maps/conditions';
import type { PveOptions } from '../../game/session/PveDraft';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import type { GroupStation } from '../../multiplayer/generated/GroupStation';
import { shipPreset } from '../../ships/presets';
import { Button, Input, Select, SelectOption } from '../components';
import { Icon } from '../Icons';
import { budgetError, fleetTotals, unitName } from '../pveSetup';
import { transferFleetShip, type FleetTransfer } from '../pveFleetEditing';
import { MapTiles, RailBlock } from './BattleRail';
import { BudgetStrip, FleetLane } from './FleetLane';
import { ShipChip, tonnes } from './ShipCard';

export const MAX_TASK_GROUPS = 9;
export const missionSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
export const nextGroupName = (request: PveRequest) => `Group ${Math.max(0, ...request.groups.map(group => Number(group.name.match(/^Group (\d+)$/)?.[1]) || 0)) + 1}`;
interface LanesProps { request: PveRequest; options: PveOptions; onChange(request: PveRequest): void; transfer?: FleetTransfer; onTransfer(transfer?: FleetTransfer): void; onError(message: string): void; nextId(): string; disabled?: boolean; }
/** Task-group lanes with the fleet allowance above them. */
export function PveLanes({ request, options, onChange, transfer, onTransfer, onError, nextId, disabled }: LanesProps) {
  const budget = options.rules.budget, totals = fleetTotals(request.ships);
  const place = (groupId: string) => {
    if (!transfer) return;
    const result = transferFleetShip(request, transfer, groupId, nextId(), options.eligiblePresets, budget);
    if (result.error) onError(result.error); else onChange(result.request);
    onTransfer(undefined);
  };
  const newGroup = () => {
    if (!transfer || request.groups.length >= MAX_TASK_GROUPS) return;
    const id = `group-${nextId()}`, next = { ...request, groups: [...request.groups, { id, name: nextGroupName(request), station: 'front' as GroupStation }] };
    const result = transferFleetShip(next, transfer, id, nextId(), options.eligiblePresets, budget);
    if (result.error) onError(result.error); else onChange(result.request);
    onTransfer(undefined);
  };
  const dragUnit = (event: DragEvent<HTMLElement>, id: string) => {
    event.stopPropagation();
    if (disabled) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); onTransfer({ kind: 'unit', id });
  };
  const active = !!transfer;
  return <>
    <BudgetStrip label="Fleet allowances" items={[
      { label: 'Tonnage', reading: `${tonnes(totals.displacementKg)} / ${tonnes(budget.maxDisplacementKg)} t`, used: totals.displacementKg, max: budget.maxDisplacementKg },
      { label: 'Ships', reading: `${totals.ships} / ${budget.maxShips}`, used: totals.ships, max: budget.maxShips },
      { label: 'Aircraft', reading: `${totals.aircraft} / ${budget.maxAircraft}`, used: totals.aircraft, max: budget.maxAircraft },
    ]}/>
    <div className="battle-lanes" aria-label="Task groups">
      {request.groups.map(group => {
        const members = request.ships.filter(ship => ship.groupId === group.id);
        return <FleetLane key={group.id} label={group.name || 'Unnamed group'} active={active} disabled={disabled} onPlace={() => place(group.id)}
          title={<Input className="fleet-lane-name" aria-label={`Task group name: ${group.name}`} maxLength={32} value={group.name} disabled={disabled} onChange={event => onChange({ ...request, groups: request.groups.map(g => g.id === group.id ? { ...g, name: event.target.value } : g) })}/>}
          count={<>{members.length} {members.length === 1 ? 'ship' : 'ships'} · {tonnes(fleetTotals(members).displacementKg)} t</>}
          extra={<Select className="fleet-lane-station" aria-label={`Station for ${group.name}`} title="Front groups deploy ahead; rear groups deploy behind" value={group.station} disabled={disabled} onValueChange={value => onChange({ ...request, groups: request.groups.map(g => g.id === group.id ? { ...g, station: value as GroupStation } : g) })}>
            <SelectOption value="front">Front</SelectOption><SelectOption value="rear">Rear</SelectOption></Select>}
          hint={members.length ? 'Drop ships here.' : <>Drop ships here.{request.groups.length > 1 && <> <Button className="fleet-lane-action" disabled={disabled} onClick={() => onChange({ ...request, groups: request.groups.filter(g => g.id !== group.id) })}>Remove empty group</Button></>}</>}>
          <ul className="fleet-lane-chips">{members.map(unit => {
            const name = unitName(unit, request.ships), picked = transfer?.kind === 'unit' && transfer.id === unit.id;
            return <ShipChip key={unit.id} presetId={unit.presetId} name={name} picked={picked} disabled={disabled} draggable onDragStart={event => dragUnit(event, unit.id)} onDragEnd={() => onTransfer(undefined)}
              pickLabel={`Move ${name} to another group`} onPick={() => onTransfer(picked ? undefined : { kind: 'unit', id: unit.id })}
              removeLabel={`Remove ${name}`} onRemove={() => onChange({ ...request, ships: request.ships.filter(ship => ship.id !== unit.id) })}/>;
          })}</ul>
        </FleetLane>;
      })}
      {request.groups.length < MAX_TASK_GROUPS && <FleetLane label="New task group" tone="ghost" title={<><Icon name="plus" size={14}/> Group</>} active={active} disabled={disabled} onPlace={newGroup} hint={<span className="fleet-lane-vertical">Drop a ship to start {nextGroupName(request)}</span>}/>}
    </div>
  </>;
}
export const pveInvalid = (request: PveRequest, options?: PveOptions) => options ? budgetError(request.ships, options.rules.budget) || (request.groups.some(group => !group.name.trim()) ? 'Name every task group.' : '') : '';
/** Waters, weather, difficulty and the mission seed. */
export function PveRail({ request, onChange, disabled }: { request: PveRequest; onChange(request: PveRequest): void; disabled?: boolean }) {
  const map = OCEAN_MAPS.find(entry => entry.id === request.mapId);
  return <>
    <RailBlock title="Waters" aside={map?.region}><MapTiles name="pve-map" value={request.mapId} disabled={disabled} onChange={(mapId: OceanMapId) => onChange({ ...request, mapId })}/></RailBlock>
    <RailBlock title="Conditions">
      <label className="rail-field"><span>Weather</span><Select aria-label="Weather" value={request.weather} disabled={disabled} onValueChange={weather => onChange({ ...request, weather })}>{WEATHER_PRESETS.map(w => <SelectOption key={w.id} value={w.id}>{w.name}</SelectOption>)}</Select></label>
      <div className="rail-field"><span id="pve-difficulty-label">Difficulty</span><div className="battle-segmented" role="group" aria-labelledby="pve-difficulty-label">
        {(['easy', 'normal', 'hard'] as const).map(level => <button type="button" key={level} aria-pressed={request.difficulty === level} disabled={disabled} onClick={() => onChange({ ...request, difficulty: level })}>{level[0].toUpperCase() + level.slice(1)}</button>)}
      </div></div>
    </RailBlock>
    <RailBlock title="Mission seed">
      <div className="rail-row"><output className="rail-seed" aria-label="Mission seed">{request.seed.toString(16).toUpperCase().padStart(8, '0')}</output><Button disabled={disabled} onClick={() => onChange({ ...request, seed: missionSeed() })}>New opponent</Button></div>
      <p className="rail-note">The same seed brings the same enemy fleet and islands. The enemy stays hidden while you deploy.</p>
    </RailBlock>
  </>;
}
export function pveBrief(request: PveRequest): string[] {
  const map = OCEAN_MAPS.find(entry => entry.id === request.mapId), weather = WEATHER_PRESETS.find(entry => entry.id === request.weather), totals = fleetTotals(request.ships);
  return [map?.name ?? request.mapId, `${weather?.name ?? request.weather} · ${request.difficulty[0].toUpperCase()}${request.difficulty.slice(1)}`, `${totals.ships} ${totals.ships === 1 ? 'ship' : 'ships'} in ${request.groups.length} ${request.groups.length === 1 ? 'group' : 'groups'} · ${tonnes(totals.displacementKg)} t`];
}
export const pveShipName = (id: string) => shipPreset(id).name;
