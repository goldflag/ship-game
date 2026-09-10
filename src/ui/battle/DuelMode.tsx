import type { DragEvent } from 'react';
import type { JoinMode, LobbyStatus } from '../../game/session/RemoteBattleSession';
import { BATTLE_RULES } from '../../simulation/battleRules';
import { Button, Input } from '../components';
import { Icon } from '../Icons';
import { MapTiles, RailBlock, RailLock } from './BattleRail';
import { BudgetStrip, FleetLane } from './FleetLane';
import { duelBudget, duelUnitId, transferDuelShip, type FleetTransfer } from './fleetTransfer';
import { Berth, ShipChip, tonnes } from './ShipCard';

interface LanesProps { fleet: string[]; onChange(fleet: string[]): void; transfer?: FleetTransfer; onTransfer(transfer?: FleetTransfer): void; onError(message: string): void; disabled?: boolean; }
/** One fleet lane with every berth visible; the first berth is the initial command ship. */
export function DuelLanes({ fleet, onChange, transfer, onTransfer, onError, disabled }: LanesProps) {
  const budget = duelBudget(fleet);
  const place = (target: 'fleet' | 'command') => {
    if (!transfer) return;
    const result = transferDuelShip(fleet, transfer, target);
    if (result.error) onError(result.error); else onChange(result.fleet);
    onTransfer(undefined);
  };
  const dragUnit = (event: DragEvent<HTMLElement>, id: string) => {
    event.stopPropagation();
    if (disabled) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); onTransfer({ kind: 'unit', id });
  };
  const active = !!transfer, full = fleet.length >= BATTLE_RULES.maxVessels;
  return <>
    <BudgetStrip label="Fleet allowances" items={[
      { label: 'Tonnage', reading: `${tonnes(budget.displacementKg)} / ${tonnes(BATTLE_RULES.maxFleetKg)} t`, used: budget.displacementKg, max: BATTLE_RULES.maxFleetKg },
      { label: 'Vessels', reading: `${budget.vessels} / ${BATTLE_RULES.maxVessels}`, used: budget.vessels, max: BATTLE_RULES.maxVessels },
      { label: 'Carriers', reading: `${budget.carriers} / ${BATTLE_RULES.maxCarriers}`, used: budget.carriers, max: BATTLE_RULES.maxCarriers },
    ]}/>
    <div className="battle-lanes" aria-label="Your fleet">
      <FleetLane label="Your fleet" title="Your fleet" count={`${fleet.length} / ${BATTLE_RULES.maxVessels} vessels`} extra={<span className="fleet-lane-note">After 30 minutes, the fleet with more tonnage afloat wins.</span>} active={active && !full} disabled={disabled} onPlace={() => place('fleet')}
        hint={full ? 'Every berth is filled.' : 'Drop a ship into an open berth. Drop it on the first berth to make it your initial command ship.'}>
        <p className="lane-slot-label"><Icon name="anchor" size={13}/> Initial command ship</p>
        <ul className="fleet-lane-chips">
          {fleet.map((id, index) => {
            const unitId = duelUnitId(index), picked = transfer?.kind === 'unit' && transfer.id === unitId, first = index === 0;
            return <ShipChip key={unitId} presetId={id} commanded={first} picked={picked} disabled={disabled} className={first ? `command-berth ${active ? 'is-accepting' : ''}` : ''} draggable={!first} onDragStart={event => dragUnit(event, unitId)} onDragEnd={() => onTransfer(undefined)}
              pickLabel={first ? (active ? `Make ${transfer.id} the command ship` : 'Your initial command ship') : `Move vessel ${index + 1} to the command berth`}
              onPick={first ? (active ? () => place('command') : undefined) : () => onTransfer(picked ? undefined : { kind: 'unit', id: unitId })}
              removeLabel={`Remove vessel ${index + 1}`} onRemove={fleet.length > 1 || !first ? () => onChange(fleet.filter((_, i) => i !== index)) : undefined}>
              {first && <span className="ship-chip-mark" title="Initial command ship"><Icon name="anchor" size={16}/></span>}
              {first && <span className="command-berth-drop" aria-hidden="true" onDragOver={event => { if (active && !disabled) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; event.currentTarget.parentElement?.classList.add('is-drop-target'); } }}
                onDragLeave={event => event.currentTarget.parentElement?.classList.remove('is-drop-target')}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.parentElement?.classList.remove('is-drop-target'); place('command'); }}/>}
            </ShipChip>;
          })}
          {Array.from({ length: Math.max(0, BATTLE_RULES.maxVessels - fleet.length) }, (_, i) => <Berth key={`berth-${fleet.length + i}`} label={`Berth ${fleet.length + i + 1}`}/>)}
        </ul>
      </FleetLane>
    </div>
  </>;
}
interface RailProps { fleet: string[]; busy: boolean; status: LobbyStatus; code: string; onCode(code: string): void; onJoin(mode: JoinMode): void; onResume?(): void; onCancel(): void; disabled?: boolean; }
/** Matchmaking lives in the rail; the waters are drawn when matched. */
export function DuelRail({ fleet, busy, status, code, onCode, onJoin, onResume, onCancel, disabled }: RailProps) {
  const error = duelBudget(fleet).error, ready = !error && !busy && !disabled;
  return <>
    <RailBlock title="Match" className="rail-match">
      {busy ? <div className="rail-waiting" role="status">
        <strong>{status.message}</strong>
        {status.inviteCode && <><p>Give this code to your opponent:</p><output className="rail-invite-code">{status.inviteCode}</output></>}
        <p className="rail-note">Your fleet is locked while waiting.</p>
        <Button onClick={onCancel}>Cancel</Button>
      </div> : <div className="rail-stack">
        {onResume && <Button variant="primary" onClick={onResume}>Reconnect to previous battle <Icon name="arrow" size={16}/></Button>}
        <Button variant="primary" disabled={!ready} onClick={() => onJoin('queue')}>Find opponent <Icon name="arrow" size={16}/></Button>
        <Button disabled={!ready} onClick={() => onJoin('create-invite')}>Create invite</Button>
        <div className="rail-row"><Input aria-label="Invite code" maxLength={12} value={code} disabled={busy || disabled} placeholder="Invite code" onChange={event => onCode(event.target.value)}/><Button disabled={!ready || !/^[a-f0-9]{12}$/i.test(code.trim())} onClick={() => onJoin('join-invite')}>Join</Button></div>
        {error && fleet.length > 0 && <p className="rail-note is-error" role="status">{error}</p>}
      </div>}
    </RailBlock>
    <RailBlock title="Waters"><RailLock>Map, weather and daylight are drawn when matched. Night battles occur less often.</RailLock><MapTiles name="duel-map" locked/></RailBlock>
  </>;
}
export function duelBrief(fleet: string[]): string[] {
  const budget = duelBudget(fleet);
  return ['1v1 online', `${budget.vessels} ${budget.vessels === 1 ? 'vessel' : 'vessels'} · ${tonnes(budget.displacementKg)} t · ${budget.carriers} ${budget.carriers === 1 ? 'carrier' : 'carriers'}`, 'Waters drawn at match'];
}
